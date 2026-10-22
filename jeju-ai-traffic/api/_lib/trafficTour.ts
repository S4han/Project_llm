import type { TrafficTourDetailResponse, TrafficTourResponse } from "../../shared/contracts/traffic.js";
import { AppError, toErrorResponse } from "./errors.js";
import { guardedCall } from "./policies/guardedCall.js";
import { quotaGuard, type QuotaGuard } from "./policies/quota.js";
import { RateLimiter } from "./policies/rateLimit.js";
import { TtlCache } from "./policies/ttlCache.js";
import { createKtoTourProvider, createMockTourProvider, type TourDetail, type TourProvider, type TourSnapshot } from "./providers/ktoTour.js";

/** 목록: 서버 하루·CDN 7일. 상세: 관광지마다 서버·CDN 30일(TASK-026 1.(a)). */
export const TOUR_CACHE_TTL_MS = 24 * 60 * 60_000;
export const TOUR_CDN_SECONDS = 7 * 24 * 60 * 60;
export const TOUR_DETAIL_TTL_MS = 30 * 24 * 60 * 60_000;
export const TOUR_DETAIL_CDN_SECONDS = 30 * 24 * 60 * 60;
/** 목록·상세 합쳐 IP별 분당 요청 수(상세는 관광지를 누를 때마다 한 번). */
export const TRAFFIC_TOUR_PER_MINUTE = 30;

export interface TrafficTourDeps {
  tour: TourProvider;
  cache: TtlCache<TourSnapshot>;
  detailCache: TtlCache<TourDetail>;
  guard: QuotaGuard;
  limiter: RateLimiter;
  now?: () => Date;
}

/** DATA_GO_KR_API_KEY(한국관광공사 국문 관광정보 활용 승인, TASK-026)가 있을 때만 실제 호출, 그 외에는 모의. */
export function selectTourProvider(env: Record<string, string | undefined>): TourProvider {
  const key = env.DATA_GO_KR_API_KEY;
  if (key) return createKtoTourProvider(key);
  return createMockTourProvider();
}

function clientKey(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return request.headers.get("x-real-ip") ?? (forwarded || "unknown");
}

/** GET /api/traffic/tour: 제주 관광지 목록. ?id=콘텐츠 ID면 그 관광지의 이용시간·쉬는날·주차·문의. 실패하면 오류(보관하지 않음). */
export async function handleTrafficTour(request: Request, deps: TrafficTourDeps): Promise<Response> {
  const now = deps.now ?? (() => new Date());
  try {
    const id = new URL(request.url).searchParams.get("id");
    if (id !== null && !/^(?:\d{1,12}|MOCK-T\d{1,3})$/.test(id)) throw new AppError("INVALID_INPUT", "관광지 번호가 올바르지 않습니다.");
    const retryAt = deps.limiter.tryAcquire(clientKey(request));
    if (retryAt !== null) throw new AppError("QUOTA_BLOCKED", "교통 현황 요청이 너무 잦습니다. 잠시 후 다시 시도하세요.", new Date(retryAt).toISOString());
    if (id !== null) {
      const d = await deps.detailCache.getOrLoad(id, () => guardedCall(deps.guard, "kto", () => deps.tour.fetchDetail(id)));
      const body: TrafficTourDetailResponse = { ...d, builtAt: now().toISOString() };
      return Response.json(body, { headers: { "Cache-Control": `public, max-age=86400, s-maxage=${TOUR_DETAIL_CDN_SECONDS}, stale-while-revalidate=86400` } });
    }
    const snap = await deps.cache.getOrLoad("tour", () => guardedCall(deps.guard, "kto", () => deps.tour.fetchSpots()));
    const body: TrafficTourResponse = { spots: snap.spots, builtAt: now().toISOString(), source: snap.source };
    return Response.json(body, { headers: { "Cache-Control": `public, max-age=3600, s-maxage=${TOUR_CDN_SECONDS}, stale-while-revalidate=86400` } });
  } catch (err) {
    return toErrorResponse(err, now());
  }
}

export const defaultTrafficTourDeps: TrafficTourDeps = {
  tour: selectTourProvider(process.env),
  cache: new TtlCache<TourSnapshot>(TOUR_CACHE_TTL_MS),
  detailCache: new TtlCache<TourDetail>(TOUR_DETAIL_TTL_MS),
  guard: quotaGuard,
  limiter: new RateLimiter(TRAFFIC_TOUR_PER_MINUTE, 60_000),
};
