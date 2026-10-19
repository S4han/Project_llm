import type { RouteCompareRequest, RouteCompareResponse, RouteOption } from "../../shared/contracts/route.js";
import type { IncidentsStatus, TrafficIncident } from "../../shared/contracts/traffic.js";
import { checkTrip, type TripProblem } from "../../shared/rules/geo.js";
import { dedupeRoutes, pickRecommended, planRouteQueries, type NoRouteReason } from "../../shared/rules/route.js";
import { dedupeIncidents, matchIncidents } from "../../shared/rules/traffic.js";
import { AppError, ProviderError, toErrorResponse } from "./errors.js";
import { guardedCall } from "./policies/guardedCall.js";
import { quotaGuard, type QuotaGuard } from "./policies/quota.js";
import { RateLimiter } from "./policies/rateLimit.js";
import { JEJU_ITS_CACHE_TTL_MS, TtlCache } from "./policies/ttlCache.js";
import { createJejuItsProvider, ITS_CALLS_PER_LOAD } from "./providers/jejuIts.js";
import { createKakaoMobilityProvider } from "./providers/kakaoMobility.js";
import { createMockRouteProvider } from "./providers/mockRoutes.js";
import { createMockTrafficProvider } from "./providers/mockTraffic.js";
import type { RouteProvider, TrafficProvider } from "./providers/types.js";

/** 경로 조회 빈도 제한: IP별 분당 10회 (DECISIONS 2026-10-19 TASK-005 "3. 승인"). */
export const ROUTE_COMPARE_PER_MINUTE = 10;

interface IncidentSnapshot {
  incidents: TrafficIncident[];
  observedAt: string;
}

export interface RoutesDeps {
  provider: RouteProvider;
  traffic: TrafficProvider;
  /** 제주 ITS 결과 60초 공유 캐시(TASK-003 승인). */
  incidentCache: TtlCache<IncidentSnapshot>;
  guard: QuotaGuard;
  limiter: RateLimiter;
  now?: () => Date;
}

/** ROUTES_PROVIDER=kakao와 KAKAO_REST_API_KEY가 모두 있을 때만 실제 카카오, 그 외에는 모의(외부 호출 없음). */
export function selectRouteProvider(env: Record<string, string | undefined>): RouteProvider {
  const key = env.KAKAO_REST_API_KEY;
  if (env.ROUTES_PROVIDER === "kakao" && key) return createKakaoMobilityProvider(key);
  return createMockRouteProvider();
}

/** TRAFFIC_PROVIDER=jejuIts와 JEJU_ITS_API_KEY가 모두 있을 때만 실제 제주 ITS, 그 외에는 모의(외부 호출 없음). */
export function selectTrafficProvider(env: Record<string, string | undefined>): TrafficProvider {
  const key = env.JEJU_ITS_API_KEY;
  if (env.TRAFFIC_PROVIDER === "jejuIts" && key) return createJejuItsProvider(key);
  return createMockTrafficProvider();
}

const INPUT_MESSAGES: Record<TripProblem, string> = {
  originMissing: "출발지를 정하세요.",
  originInvalid: "출발지가 제주 범위를 벗어났거나 올바르지 않습니다.",
  destinationMissing: "목적지를 정하세요.",
  destinationInvalid: "목적지가 제주 범위를 벗어났거나 올바르지 않습니다.",
  samePlace: "출발지와 목적지가 같습니다.",
};

const NO_ROUTE_MESSAGES: Record<NoRouteReason, string> = {
  originUnreachable: "출발지 근처에서 도로를 찾을 수 없습니다. 도로와 가까운 다른 출발지를 선택하세요.",
  destinationUnreachable: "목적지 근처에서 도로를 찾을 수 없습니다. 주차장·입구 등 도로와 가까운 장소를 선택하세요.",
  notFound: "이 출발지·목적지로는 경로를 찾을 수 없습니다. 다른 위치를 선택하세요.",
};

function parseRequest(body: unknown): RouteCompareRequest {
  const b = body as { origin?: { lat?: unknown; lng?: unknown }; destination?: { lat?: unknown; lng?: unknown } } | null;
  const coord = (c: { lat?: unknown; lng?: unknown } | undefined) =>
    c && typeof c.lat === "number" && typeof c.lng === "number" ? { lat: c.lat, lng: c.lng } : null;
  const origin = coord(b?.origin);
  const destination = coord(b?.destination);
  const problem = checkTrip(origin, destination);
  if (problem || !origin || !destination) throw new AppError("INVALID_INPUT", INPUT_MESSAGES[problem ?? "originMissing"]);
  return { origin, destination };
}

function clientKey(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return request.headers.get("x-real-ip") ?? (forwarded || "unknown");
}

/**
 * 계획한 호출을 모두 실행하고 결과를 모은다. 일부만 실패하면 성공분을 돌려준다.
 * 모두 실패하면: 429가 있으면 rate_limited, 장애가 있으면 unavailable, 모두 경로 없음이면 INVALID_INPUT.
 */
async function fetchAll(deps: RoutesDeps, request: RouteCompareRequest) {
  const queries = planRouteQueries(request.origin, request.destination);
  const run = async () => {
    const settled = await Promise.allSettled(queries.map((q) => deps.provider.fetchRoute(request, q)));
    const routes: RouteOption[] = [];
    const reasons: NoRouteReason[] = [];
    let rateLimited = false;
    let unavailable = false;
    for (const s of settled) {
      if (s.status === "rejected") {
        if (s.reason instanceof ProviderError && s.reason.kind === "rate_limited") rateLimited = true;
        else unavailable = true;
      } else if (s.value.ok) routes.push(s.value.route);
      else reasons.push(s.value.reason);
    }
    if (routes.length === 0) {
      if (rateLimited) throw new ProviderError("rate_limited", "kakao 429");
      if (unavailable) throw new ProviderError("unavailable", "kakao 장애");
      const reason = reasons.find((r) => r !== "notFound") ?? "notFound";
      throw new AppError("INVALID_INPUT", NO_ROUTE_MESSAGES[reason]);
    }
    return { routes, rateLimited };
  };
  return guardedCall(deps.guard, "kakao", run, { cost: queries.length });
}

/** 교통 사건 조회. 실패·한도여도 경로 비교를 막지 않도록 오류를 던지지 않고 상태로 돌려준다(AC-005-04). */
async function loadIncidents(
  deps: RoutesDeps,
): Promise<{ status: IncidentsStatus; snapshot: IncidentSnapshot | null }> {
  const now = deps.now ?? (() => new Date());
  try {
    const snapshot = await deps.incidentCache.getOrLoad("jejuIts", async () => {
      const incidents = await guardedCall(deps.guard, "jejuIts", () => deps.traffic.fetchIncidents(), {
        cost: ITS_CALLS_PER_LOAD,
      });
      return { incidents: dedupeIncidents(incidents), observedAt: now().toISOString() };
    });
    return { status: "ok", snapshot };
  } catch (err) {
    return { status: err instanceof AppError && err.code === "QUOTA_BLOCKED" ? "quotaBlocked" : "unavailable", snapshot: null };
  }
}

/** POST /api/routes/compare: 입력 검사 → 빈도 제한 → 사용량 예약 → 다회 호출 → 중복 합치기 → 최단 추천. 결과는 저장·캐시하지 않는다. */
export async function handleRouteCompare(request: Request, deps: RoutesDeps): Promise<Response> {
  const now = deps.now ?? (() => new Date());
  try {
    const body = await request.json().catch(() => null);
    const input = parseRequest(body);

    const retryAt = deps.limiter.tryAcquire(clientKey(request));
    if (retryAt !== null) {
      throw new AppError("QUOTA_BLOCKED", "경로 조회 요청이 너무 잦습니다. 잠시 후 다시 시도하세요.", new Date(retryAt).toISOString());
    }

    // 경로와 교통 사건을 함께 조회한다. 사건 조회는 실패해도 오류를 던지지 않는다.
    const incidentsPromise = loadIncidents(deps);
    const { routes, rateLimited } = await fetchAll(deps, input);
    // 일부 호출이 429면 성공분은 보여 주되, 이후 호출은 다음 KST 0시까지 막는다.
    if (rateLimited) await deps.guard.blockForToday("kakao");
    const { status, snapshot } = await incidentsPromise;

    const all = snapshot?.incidents ?? [];
    const kept = dedupeRoutes(routes).map((r) => ({ ...r, incidentIds: matchIncidents(all, r.geometry) }));
    const linked = new Set(kept.flatMap((r) => r.incidentIds));
    const response: RouteCompareResponse = {
      routes: kept,
      ...pickRecommended(kept),
      observedAt: now().toISOString(),
      stale: false,
      incidents: all.filter((i) => linked.has(i.id)),
      incidentsStatus: status,
      incidentsObservedAt: snapshot?.observedAt ?? null,
    };
    return Response.json(response, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    return toErrorResponse(err, now());
  }
}

export const defaultRoutesDeps: RoutesDeps = {
  provider: selectRouteProvider(process.env),
  traffic: selectTrafficProvider(process.env),
  incidentCache: new TtlCache<IncidentSnapshot>(JEJU_ITS_CACHE_TTL_MS),
  guard: quotaGuard,
  limiter: new RateLimiter(ROUTE_COMPARE_PER_MINUTE, 60_000),
};
