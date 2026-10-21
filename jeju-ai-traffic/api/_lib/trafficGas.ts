import type { TrafficGasResponse } from "../../shared/contracts/traffic.js";
import { AppError, toErrorResponse } from "./errors.js";
import { guardedCall } from "./policies/guardedCall.js";
import { quotaGuard, type QuotaGuard } from "./policies/quota.js";
import { RateLimiter } from "./policies/rateLimit.js";
import { TtlCache } from "./policies/ttlCache.js";
import { createJejuItsGasProvider, createMockGasProvider, type GasProvider, type GasSnapshot } from "./providers/jejuItsGas.js";

/** 서버 메모리·CDN 보관 1시간. 제주 ITS는 제주 전체를 2건으로 주고 일일 한도(6,000)를 사건·소통과 함께 쓴다(TASK-018 범위 변경). */
export const GAS_CACHE_TTL_MS = 60 * 60_000;
export const GAS_CDN_SECONDS = 60 * 60;
export const TRAFFIC_GAS_PER_MINUTE = 10;

export interface TrafficGasDeps {
  gas: GasProvider;
  cache: TtlCache<GasSnapshot>;
  guard: QuotaGuard;
  limiter: RateLimiter;
  now?: () => Date;
}

/** TRAFFIC_PROVIDER=jejuIts와 JEJU_ITS_API_KEY(제주 ITS 돌발 키, 주유소 API가 함께 열림)가 있을 때만 실제 호출, 그 외에는 모의. */
export function selectGasProvider(env: Record<string, string | undefined>): GasProvider {
  const key = env.JEJU_ITS_API_KEY;
  if (env.TRAFFIC_PROVIDER === "jejuIts" && key) return createJejuItsGasProvider(key);
  return createMockGasProvider();
}

function clientKey(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return request.headers.get("x-real-ip") ?? (forwarded || "unknown");
}

/** GET /api/traffic/gas: 제주 주유소·가격. 실패하면 오류(보관하지 않음). 내 위치는 받지 않는다. */
export async function handleTrafficGas(request: Request, deps: TrafficGasDeps): Promise<Response> {
  const now = deps.now ?? (() => new Date());
  try {
    const retryAt = deps.limiter.tryAcquire(clientKey(request));
    if (retryAt !== null) throw new AppError("QUOTA_BLOCKED", "교통 현황 요청이 너무 잦습니다. 잠시 후 다시 시도하세요.", new Date(retryAt).toISOString());
    const snap = await deps.cache.getOrLoad("gas", () => guardedCall(deps.guard, "jejuIts", () => deps.gas.fetchStations(), { cost: deps.gas.calls }));
    const body: TrafficGasResponse = { stations: snap.stations, builtAt: now().toISOString(), source: snap.source };
    return Response.json(body, { headers: { "Cache-Control": `public, max-age=600, s-maxage=${GAS_CDN_SECONDS}, stale-while-revalidate=600` } });
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
