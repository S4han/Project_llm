import type { IncidentsStatus, TrafficIncident, TrafficIncidentsResponse } from "../../shared/contracts/traffic.js";
import { dedupeIncidents } from "../../shared/rules/traffic.js";
import { AppError, toErrorResponse } from "./errors.js";
import { guardedCall } from "./policies/guardedCall.js";
import { quotaGuard, type QuotaGuard } from "./policies/quota.js";
import { RateLimiter } from "./policies/rateLimit.js";
import { JEJU_ITS_CACHE_TTL_MS, TtlCache } from "./policies/ttlCache.js";
import { createJejuItsProvider, ITS_CALLS_PER_LOAD } from "./providers/jejuIts.js";
import { createMockTrafficProvider } from "./providers/mockTraffic.js";
import type { TrafficProvider } from "./providers/types.js";

export interface IncidentSnapshot {
  incidents: TrafficIncident[];
  observedAt: string;
}

export interface IncidentDeps {
  traffic: TrafficProvider;
  /** 제주 ITS 결과 60초 공유 캐시(TASK-003 승인). */
  incidentCache: TtlCache<IncidentSnapshot>;
  guard: QuotaGuard;
  now?: () => Date;
}

/** TRAFFIC_PROVIDER=jejuIts와 JEJU_ITS_API_KEY가 모두 있을 때만 실제 제주 ITS, 그 외에는 모의(외부 호출 없음). */
export function selectTrafficProvider(env: Record<string, string | undefined>): TrafficProvider {
  const key = env.JEJU_ITS_API_KEY;
  if (env.TRAFFIC_PROVIDER === "jejuIts" && key) return createJejuItsProvider(key);
  return createMockTrafficProvider();
}

export interface IncidentLoad {
  status: IncidentsStatus;
  snapshot: IncidentSnapshot | null;
  /** 한도로 막혔을 때 다시 쓸 수 있는 시각. */
  retryAfter?: string;
}

/** 교통 사건 조회. 실패·한도여도 오류를 던지지 않고 상태로 돌려준다(AC-005-04). 60초 캐시·일일 한도를 쓴다. */
export async function loadIncidents(deps: IncidentDeps): Promise<IncidentLoad> {
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
    if (err instanceof AppError && err.code === "QUOTA_BLOCKED") return { status: "quotaBlocked", snapshot: null, retryAfter: err.retryAfter };
    return { status: "unavailable", snapshot: null };
  }
}

/** 대시보드 요청 빈도 제한: IP별 분당 20회(1분 자동 갱신 + 수동 새로고침 여유, TASK-012). */
export const TRAFFIC_INCIDENTS_PER_MINUTE = 20;

export interface TrafficIncidentsDeps extends IncidentDeps {
  limiter: RateLimiter;
}

function clientKey(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return request.headers.get("x-real-ip") ?? (forwarded || "unknown");
}

/**
 * GET /api/traffic/incidents: 제주 전체 돌발·통제·공사(TASK-012 대시보드).
 * 조회 실패·한도는 200 + status로 알린다. 빈도 제한만 429.
 */
export async function handleTrafficIncidents(request: Request, deps: TrafficIncidentsDeps): Promise<Response> {
  const now = deps.now ?? (() => new Date());
  try {
    const retryAt = deps.limiter.tryAcquire(clientKey(request));
    if (retryAt !== null) {
      throw new AppError("QUOTA_BLOCKED", "교통 현황 요청이 너무 잦습니다. 잠시 후 다시 시도하세요.", new Date(retryAt).toISOString());
    }
    const { status, snapshot, retryAfter } = await loadIncidents(deps);
    const body: TrafficIncidentsResponse = {
      incidents: snapshot?.incidents ?? [],
      status,
      observedAt: snapshot?.observedAt ?? null,
      retryAfter: retryAfter ?? null,
    };
    return Response.json(body, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    return toErrorResponse(err, now());
  }
}

export const defaultTrafficIncidentsDeps: TrafficIncidentsDeps = {
  traffic: selectTrafficProvider(process.env),
  incidentCache: new TtlCache<IncidentSnapshot>(JEJU_ITS_CACHE_TTL_MS),
  guard: quotaGuard,
  limiter: new RateLimiter(TRAFFIC_INCIDENTS_PER_MINUTE, 60_000),
};
