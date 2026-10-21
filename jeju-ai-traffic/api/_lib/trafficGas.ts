import type { TrafficGasResponse } from "../../shared/contracts/traffic.js";
import { AppError, toErrorResponse } from "./errors.js";
import { guardedCall } from "./policies/guardedCall.js";
import { quotaGuard, type QuotaGuard } from "./policies/quota.js";
import { RateLimiter } from "./policies/rateLimit.js";
import { TtlCache } from "./policies/ttlCache.js";
import { createMockGasProvider, createOpinetGasProvider, type GasProvider, type GasSnapshot } from "./providers/opinetGas.js";

/**
 * 서버 메모리·CDN 보관 하루. 오피넷 무료 키 하루 한도 300건(사용자 확인)이라 1회 약 90건을 하루 1번만 부른다
 * (계획의 6시간에서 변경, DECISIONS 2026-10-21). CDN은 보관이 끝나도 하루 더 옛 응답을 주면서 뒤에서 새로 받는다.
 */
export const GAS_CACHE_TTL_MS = 24 * 60 * 60_000;
export const GAS_CDN_SECONDS = 24 * 60 * 60;
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

/** 마지막으로 받은 목록(인스턴스 메모리). 다시 받다가 실패하거나 한도에 걸리면 이것을 짧게 보관하며 준다. */
let lastGood: { snap: GasSnapshot; builtAt: string } | null = null;
/** 테스트용: 마지막 목록을 비운다. */
export function resetGasLastGood() {
  lastGood = null;
}

/** GET /api/traffic/gas: 제주 주유소·휘발유·경유 가격. 실패하면 마지막 목록, 그것도 없으면 오류(보관하지 않음). 내 위치는 받지 않는다. */
export async function handleTrafficGas(request: Request, deps: TrafficGasDeps): Promise<Response> {
  const now = deps.now ?? (() => new Date());
  try {
    const retryAt = deps.limiter.tryAcquire(clientKey(request));
    if (retryAt !== null) throw new AppError("QUOTA_BLOCKED", "교통 현황 요청이 너무 잦습니다. 잠시 후 다시 시도하세요.", new Date(retryAt).toISOString());
    let snap: GasSnapshot;
    let builtAt: string;
    let stale = false;
    try {
      snap = await deps.cache.getOrLoad("gas", () => guardedCall(deps.guard, "opinet", () => deps.gas.fetchStations(), { cost: deps.gas.calls }));
      if (lastGood?.snap !== snap) lastGood = { snap, builtAt: now().toISOString() };
      builtAt = lastGood.builtAt;
    } catch (err) {
      if (!lastGood) throw err;
      ({ snap, builtAt } = lastGood);
      stale = true;
    }
    const body: TrafficGasResponse = { ...(snap.meta ? { meta: snap.meta } : {}), stations: snap.stations, builtAt, source: snap.source };
    const cache = stale ? "public, max-age=600, s-maxage=600" : `public, max-age=3600, s-maxage=${GAS_CDN_SECONDS}, stale-while-revalidate=86400`;
    return Response.json(body, { headers: { "Cache-Control": cache } });
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
