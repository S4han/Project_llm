import type { TrafficEvResponse } from "../../shared/contracts/traffic.js";
import { AppError, toErrorResponse } from "./errors.js";
import { guardedCall } from "./policies/guardedCall.js";
import { quotaGuard, type QuotaGuard } from "./policies/quota.js";
import { RateLimiter } from "./policies/rateLimit.js";
import { TtlCache } from "./policies/ttlCache.js";
import { createJejuItsEvProvider, createMockEvProvider, joinEv, type EvProvider, type EvStation, type EvStatus } from "./providers/jejuItsEv.js";

/** 충전소 기본정보(약 3MB)는 하루, 충전 가능 정보는 30분 보관(TASK-019 1.(a) "30분 갱신"). */
export const EV_STATIONS_TTL_MS = 24 * 60 * 60_000;
export const EV_STATUS_TTL_MS = 30 * 60_000;
export const EV_CDN_SECONDS = 30 * 60;
export const TRAFFIC_EV_PER_MINUTE = 10;

export interface TrafficEvDeps {
  ev: EvProvider;
  stationCache: TtlCache<EvStation[]>;
  statusCache: TtlCache<{ status: EvStatus; at: string }>;
  guard: QuotaGuard;
  limiter: RateLimiter;
  now?: () => Date;
}

/** TRAFFIC_PROVIDER=jejuIts와 JEJU_ITS_API_KEY(돌발 키, 충전소 API가 함께 열림)가 있을 때만 실제 호출, 그 외에는 모의. */
export function selectEvProvider(env: Record<string, string | undefined>): EvProvider {
  const key = env.JEJU_ITS_API_KEY;
  if (env.TRAFFIC_PROVIDER === "jejuIts" && key) return createJejuItsEvProvider(key);
  return createMockEvProvider();
}

function clientKey(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return request.headers.get("x-real-ip") ?? (forwarded || "unknown");
}

/**
 * GET /api/traffic/ev: 제주 전기차 충전소(충전소 단위)와 충전 가능 수. 내 위치는 받지 않는다.
 * 기본정보를 받지 못하면 오류(보관하지 않음). 충전 가능 정보만 실패하면 수를 null로 주고 짧게 보관한다.
 */
export async function handleTrafficEv(request: Request, deps: TrafficEvDeps): Promise<Response> {
  const now = deps.now ?? (() => new Date());
  try {
    const retryAt = deps.limiter.tryAcquire(clientKey(request));
    if (retryAt !== null) throw new AppError("QUOTA_BLOCKED", "교통 현황 요청이 너무 잦습니다. 잠시 후 다시 시도하세요.", new Date(retryAt).toISOString());
    const stations = await deps.stationCache.getOrLoad("ev", () => guardedCall(deps.guard, "jejuIts", () => deps.ev.fetchStations()));
    let status: { status: EvStatus; at: string } | null = null;
    try {
      status = await deps.statusCache.getOrLoad("ev-status", async () => ({ status: await guardedCall(deps.guard, "jejuIts", () => deps.ev.fetchStatus()), at: now().toISOString() }));
    } catch {
      status = null;
    }
    const body: TrafficEvResponse = { stations: joinEv(stations, status?.status ?? null), statusAt: status?.at ?? null, builtAt: now().toISOString(), source: deps.ev.source };
    const cdn = status ? EV_CDN_SECONDS : 120;
    return Response.json(body, { headers: { "Cache-Control": `public, max-age=300, s-maxage=${cdn}, stale-while-revalidate=300` } });
  } catch (err) {
    return toErrorResponse(err, now());
  }
}

export const defaultTrafficEvDeps: TrafficEvDeps = {
  ev: selectEvProvider(process.env),
  stationCache: new TtlCache<EvStation[]>(EV_STATIONS_TTL_MS),
  statusCache: new TtlCache<{ status: EvStatus; at: string }>(EV_STATUS_TTL_MS),
  guard: quotaGuard,
  limiter: new RateLimiter(TRAFFIC_EV_PER_MINUTE, 60_000),
};
