import type { TrafficStayResponse } from "../../shared/contracts/traffic.js";
import { AppError, toErrorResponse } from "./errors.js";
import { guardedCall } from "./policies/guardedCall.js";
import { quotaGuard, type QuotaGuard } from "./policies/quota.js";
import { RateLimiter } from "./policies/rateLimit.js";
import { TtlCache } from "./policies/ttlCache.js";
import { createMockStayProvider, createVisitJejuStayProvider, type StayProvider, type StaySnapshot } from "./providers/visitJejuStay.js";

/** 서버 하루·CDN 7일 보관(TASK-028 1.(a)). 숙소 목록은 자주 바뀌지 않는다. */
export const STAY_CACHE_TTL_MS = 24 * 60 * 60_000;
export const STAY_CDN_SECONDS = 7 * 24 * 60 * 60;
export const TRAFFIC_STAY_PER_MINUTE = 10;

export interface TrafficStayDeps {
  stay: StayProvider;
  cache: TtlCache<StaySnapshot>;
  guard: QuotaGuard;
  limiter: RateLimiter;
  now?: () => Date;
}

/** VISITJEJU_API_KEY(비짓제주에서 따로 받는 키, TASK-028)가 있을 때만 실제 호출, 그 외에는 모의. */
export function selectStayProvider(env: Record<string, string | undefined>): StayProvider {
  const key = env.VISITJEJU_API_KEY?.trim();
  if (key) return createVisitJejuStayProvider(key);
  return createMockStayProvider();
}

function clientKey(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return request.headers.get("x-real-ip") ?? (forwarded || "unknown");
}

/** GET /api/traffic/stay: 제주 숙소(비짓제주 숙박). 실패하면 오류(보관하지 않음). */
export async function handleTrafficStay(request: Request, deps: TrafficStayDeps): Promise<Response> {
  const now = deps.now ?? (() => new Date());
  try {
    const retryAt = deps.limiter.tryAcquire(clientKey(request));
    if (retryAt !== null) throw new AppError("QUOTA_BLOCKED", "교통 현황 요청이 너무 잦습니다. 잠시 후 다시 시도하세요.", new Date(retryAt).toISOString());
    const snap = await deps.cache.getOrLoad("stay", () =>
      guardedCall(deps.guard, "visitJeju", () =>
        deps.stay.fetchStays(async (calls) => {
          await deps.guard.reserve("visitJeju", { cost: calls });
        }),
      ),
    );
    const body: TrafficStayResponse = { stays: snap.stays, builtAt: now().toISOString(), source: snap.source };
    return Response.json(body, { headers: { "Cache-Control": `public, max-age=3600, s-maxage=${STAY_CDN_SECONDS}, stale-while-revalidate=86400` } });
  } catch (err) {
    return toErrorResponse(err, now());
  }
}

export const defaultTrafficStayDeps: TrafficStayDeps = {
  stay: selectStayProvider(process.env),
  cache: new TtlCache<StaySnapshot>(STAY_CACHE_TTL_MS),
  guard: quotaGuard,
  limiter: new RateLimiter(TRAFFIC_STAY_PER_MINUTE, 60_000),
};
