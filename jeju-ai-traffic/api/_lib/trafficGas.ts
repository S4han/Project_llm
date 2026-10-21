import type { TrafficGasResponse } from "../../shared/contracts/traffic.js";
import { AppError, toErrorResponse } from "./errors.js";
import { guardedCall } from "./policies/guardedCall.js";
import { quotaGuard, type QuotaGuard } from "./policies/quota.js";
import { RateLimiter } from "./policies/rateLimit.js";
import { TtlCache } from "./policies/ttlCache.js";
import { createMockGasProvider, createOpinetGasProvider, type GasProvider, type GasSnapshot } from "./providers/opinetGas.js";

/** 서버 메모리·CDN 보관 6시간(가격은 하루 몇 번 바뀐다, TASK-018 계획). */
export const GAS_CACHE_TTL_MS = 6 * 60 * 60_000;
export const GAS_CDN_SECONDS = 6 * 60 * 60;
export const TRAFFIC_GAS_PER_MINUTE = 10;

export interface TrafficGasDeps {
  gas: GasProvider;
  cache: TtlCache<GasSnapshot>;
  guard: QuotaGuard;
  limiter: RateLimiter;
  now?: () => Date;
}

/** OPINET_API_KEY(오피넷 무료 API 키)가 있을 때만 실제 호출, 그 외에는 모의. */
export function selectGasProvider(env: Record<string, string | undefined>): GasProvider {
  const key = env.OPINET_API_KEY;
  if (key) return createOpinetGasProvider(key);
  return createMockGasProvider();
}

function clientKey(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return request.headers.get("x-real-ip") ?? (forwarded || "unknown");
}

/** GET /api/traffic/gas: 제주 주유소·휘발유·경유 가격. 실패하면 오류(보관하지 않음). 내 위치는 받지 않는다. */
export async function handleTrafficGas(request: Request, deps: TrafficGasDeps): Promise<Response> {
  const now = deps.now ?? (() => new Date());
  try {
    const retryAt = deps.limiter.tryAcquire(clientKey(request));
    if (retryAt !== null) throw new AppError("QUOTA_BLOCKED", "교통 현황 요청이 너무 잦습니다. 잠시 후 다시 시도하세요.", new Date(retryAt).toISOString());
    const snap = await deps.cache.getOrLoad("gas", () => guardedCall(deps.guard, "opinet", () => deps.gas.fetchStations(), { cost: deps.gas.calls }));
    const body: TrafficGasResponse = { ...(snap.meta ? { meta: snap.meta } : {}), stations: snap.stations, builtAt: now().toISOString(), source: snap.source };
    return Response.json(body, { headers: { "Cache-Control": `public, max-age=1800, s-maxage=${GAS_CDN_SECONDS}, stale-while-revalidate=3600` } });
  } catch (err) {
    return toErrorResponse(err, now());
  }
}

export const defaultTrafficGasDeps: TrafficGasDeps = {
  gas: selectGasProvider(process.env),
  cache: new TtlCache<GasSnapshot>(GAS_CACHE_TTL_MS),
  guard: quotaGuard,
  limiter: new RateLimiter(TRAFFIC_GAS_PER_MINUTE, 60_000),
};
