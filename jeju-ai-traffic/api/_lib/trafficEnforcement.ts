import type { TrafficEnforcementResponse } from "../../shared/contracts/traffic.js";
import { AppError, toErrorResponse } from "./errors.js";
import { guardedCall } from "./policies/guardedCall.js";
import { quotaGuard, type QuotaGuard } from "./policies/quota.js";
import { RateLimiter } from "./policies/rateLimit.js";
import { TtlCache } from "./policies/ttlCache.js";
import { createJejuCityEnforcementProvider, createMockEnforcementProvider, type EnforcementProvider, type EnforcementSnapshot } from "./providers/jejuCityEnforcement.js";

/** 서버 메모리 보관(하루)과 CDN 보관(7일). 단속 CCTV 위치는 거의 바뀌지 않는다(TASK-016 계획). */
export const ENFORCEMENT_CACHE_TTL_MS = 24 * 60 * 60_000;
export const ENFORCEMENT_CDN_SECONDS = 7 * 24 * 60 * 60;
export const TRAFFIC_ENFORCEMENT_PER_MINUTE = 10;

export interface TrafficEnforcementDeps {
  cameras: EnforcementProvider;
  cache: TtlCache<EnforcementSnapshot>;
  guard: QuotaGuard;
  limiter: RateLimiter;
  now?: () => Date;
}

/** DATA_GO_KR_API_KEY(공공데이터포털 인증키, 인코딩·일반 모두 가능)가 있을 때만 실제 호출, 그 외에는 모의. */
export function selectEnforcementProvider(env: Record<string, string | undefined>): EnforcementProvider {
  const key = env.DATA_GO_KR_API_KEY;
  if (key) return createJejuCityEnforcementProvider(key);
  return createMockEnforcementProvider();
}

function clientKey(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return request.headers.get("x-real-ip") ?? (forwarded || "unknown");
}

/** GET /api/traffic/enforcement: 제주시 주정차 단속 CCTV. 실패하면 오류(보관하지 않음). */
export async function handleTrafficEnforcement(request: Request, deps: TrafficEnforcementDeps): Promise<Response> {
  const now = deps.now ?? (() => new Date());
  try {
    const retryAt = deps.limiter.tryAcquire(clientKey(request));
    if (retryAt !== null) throw new AppError("QUOTA_BLOCKED", "교통 현황 요청이 너무 잦습니다. 잠시 후 다시 시도하세요.", new Date(retryAt).toISOString());
    const snap = await deps.cache.getOrLoad("enforcement", () => guardedCall(deps.guard, "dataGoKr", () => deps.cameras.fetchCameras()));
    const body: TrafficEnforcementResponse = { cameras: snap.cameras, builtAt: now().toISOString(), source: snap.source };
    return Response.json(body, { headers: { "Cache-Control": `public, max-age=3600, s-maxage=${ENFORCEMENT_CDN_SECONDS}, stale-while-revalidate=86400` } });
  } catch (err) {
    return toErrorResponse(err, now());
  }
}

export const defaultTrafficEnforcementDeps: TrafficEnforcementDeps = {
  cameras: selectEnforcementProvider(process.env),
  cache: new TtlCache<EnforcementSnapshot>(ENFORCEMENT_CACHE_TTL_MS),
  guard: quotaGuard,
  limiter: new RateLimiter(TRAFFIC_ENFORCEMENT_PER_MINUTE, 60_000),
};
