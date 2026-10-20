import type { TrafficFacilitiesResponse } from "../../shared/contracts/traffic.js";
import { AppError, toErrorResponse } from "./errors.js";
import { guardedCall } from "./policies/guardedCall.js";
import { quotaGuard, type QuotaGuard } from "./policies/quota.js";
import { RateLimiter } from "./policies/rateLimit.js";
import { TtlCache } from "./policies/ttlCache.js";
import { createJejuItsFacilityProvider, createMockFacilityProvider, FACILITY_TYPES, type FacilityProvider, type FacilitySnapshot } from "./providers/jejuItsFacilities.js";

/** 서버 메모리 보관(하루)과 CDN 보관(7일). 시설물은 거의 바뀌지 않는다(TASK-013 "3. 승인"). */
export const FACILITIES_CACHE_TTL_MS = 24 * 60 * 60_000;
export const FACILITIES_CDN_SECONDS = 7 * 24 * 60 * 60;
/** 일부 유형을 받지 못했을 때는 1시간만 보관해 곧 다시 받는다. */
export const FACILITIES_PARTIAL_CDN_SECONDS = 60 * 60;
export const TRAFFIC_FACILITIES_PER_MINUTE = 10;

export interface TrafficFacilitiesDeps {
  facilities: FacilityProvider;
  cache: TtlCache<FacilitySnapshot>;
  guard: QuotaGuard;
  limiter: RateLimiter;
  now?: () => Date;
}

/**
 * 교통시설물 전용 키(JEJU_ITS_FACILITY_API_KEY)가 있으면 그것을, 없으면 실시간 교통정보 키(이 API가 함께 등록됨, TASK-013 시험 확인).
 * TRAFFIC_PROVIDER=jejuIts일 때만 실제 호출, 그 외에는 모의.
 */
export function selectFacilityProvider(env: Record<string, string | undefined>): FacilityProvider {
  const key = env.JEJU_ITS_FACILITY_API_KEY || env.JEJU_ITS_TRAFFIC_API_KEY;
  if (env.TRAFFIC_PROVIDER === "jejuIts" && key) return createJejuItsFacilityProvider(key);
  return createMockFacilityProvider();
}

function clientKey(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return request.headers.get("x-real-ip") ?? (forwarded || "unknown");
}

/** GET /api/traffic/facilities: 7개 유형 시설물. 모두 실패하면 오류(보관하지 않음). */
export async function handleTrafficFacilities(request: Request, deps: TrafficFacilitiesDeps): Promise<Response> {
  const now = deps.now ?? (() => new Date());
  try {
    const retryAt = deps.limiter.tryAcquire(clientKey(request));
    if (retryAt !== null) throw new AppError("QUOTA_BLOCKED", "교통 현황 요청이 너무 잦습니다. 잠시 후 다시 시도하세요.", new Date(retryAt).toISOString());
    const snap = await deps.cache.getOrLoad("facilities", () =>
      guardedCall(deps.guard, "jejuIts", () => deps.facilities.fetchFacilities(), { cost: FACILITY_TYPES.length }),
    );
    const body: TrafficFacilitiesResponse = { facilities: snap.facilities, failedTypes: snap.failedTypes, builtAt: now().toISOString(), source: snap.source };
    const cdn = snap.failedTypes.length ? FACILITIES_PARTIAL_CDN_SECONDS : FACILITIES_CDN_SECONDS;
    return Response.json(body, { headers: { "Cache-Control": `public, max-age=3600, s-maxage=${cdn}, stale-while-revalidate=86400` } });
  } catch (err) {
    return toErrorResponse(err, now());
  }
}

export const defaultTrafficFacilitiesDeps: TrafficFacilitiesDeps = {
  facilities: selectFacilityProvider(process.env),
  cache: new TtlCache<FacilitySnapshot>(FACILITIES_CACHE_TTL_MS),
  guard: quotaGuard,
  limiter: new RateLimiter(TRAFFIC_FACILITIES_PER_MINUTE, 60_000),
};
