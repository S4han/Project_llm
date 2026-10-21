import type { TrafficParkingResponse } from "../../shared/contracts/traffic.js";
import { AppError, toErrorResponse } from "./errors.js";
import { guardedCall } from "./policies/guardedCall.js";
import { quotaGuard, type QuotaGuard } from "./policies/quota.js";
import { RateLimiter } from "./policies/rateLimit.js";
import { TtlCache } from "./policies/ttlCache.js";
import { createMockParkingProvider, createParkingStandardProvider, PARKING_INSTITUTIONS, type ParkingProvider, type ParkingSnapshot } from "./providers/parkingStandard.js";

/** 서버 메모리 보관(하루)과 CDN 보관(7일). 표준데이터는 자주 바뀌지 않는다(TASK-017 계획). */
export const PARKING_CACHE_TTL_MS = 24 * 60 * 60_000;
export const PARKING_CDN_SECONDS = 7 * 24 * 60 * 60;
export const TRAFFIC_PARKING_PER_MINUTE = 10;

export interface TrafficParkingDeps {
  parking: ParkingProvider;
  cache: TtlCache<ParkingSnapshot>;
  guard: QuotaGuard;
  limiter: RateLimiter;
  now?: () => Date;
}

/** DATA_GO_KR_API_KEY(전국주차장정보표준데이터 활용 승인, TASK-017)가 있을 때만 실제 호출, 그 외에는 모의. */
export function selectParkingProvider(env: Record<string, string | undefined>): ParkingProvider {
  const key = env.DATA_GO_KR_API_KEY;
  if (key) return createParkingStandardProvider(key);
  return createMockParkingProvider();
}

function clientKey(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return request.headers.get("x-real-ip") ?? (forwarded || "unknown");
}

/** GET /api/traffic/parking: 제주시·서귀포시 주차장(표준데이터). 실패하면 오류(보관하지 않음). */
export async function handleTrafficParking(request: Request, deps: TrafficParkingDeps): Promise<Response> {
  const now = deps.now ?? (() => new Date());
  try {
    const retryAt = deps.limiter.tryAcquire(clientKey(request));
    if (retryAt !== null) throw new AppError("QUOTA_BLOCKED", "교통 현황 요청이 너무 잦습니다. 잠시 후 다시 시도하세요.", new Date(retryAt).toISOString());
    const snap = await deps.cache.getOrLoad("parking", () =>
      guardedCall(
        deps.guard,
        "dataGoKr",
        () =>
          deps.parking.fetchLots(async (calls) => {
            await deps.guard.reserve("dataGoKr", { cost: calls });
          }),
        { cost: PARKING_INSTITUTIONS.length },
      ),
    );
    const body: TrafficParkingResponse = { lots: snap.lots, builtAt: now().toISOString(), source: snap.source };
    return Response.json(body, { headers: { "Cache-Control": `public, max-age=3600, s-maxage=${PARKING_CDN_SECONDS}, stale-while-revalidate=86400` } });
  } catch (err) {
    return toErrorResponse(err, now());
  }
}

export const defaultTrafficParkingDeps: TrafficParkingDeps = {
  parking: selectParkingProvider(process.env),
  cache: new TtlCache<ParkingSnapshot>(PARKING_CACHE_TTL_MS),
  guard: quotaGuard,
  limiter: new RateLimiter(TRAFFIC_PARKING_PER_MINUTE, 60_000),
};
