import { PLACE_QUERY_MAX_LENGTH, type PlaceSearchResponse } from "../../shared/contracts/place.js";
import { isInJeju, isJejuAddress } from "../../shared/rules/geo.js";
import { AppError, toErrorResponse } from "./errors.js";
import { guardedCall } from "./policies/guardedCall.js";
import { quotaGuard, type QuotaGuard } from "./policies/quota.js";
import { PLACE_SEARCH_PER_MINUTE, RateLimiter } from "./policies/rateLimit.js";
import { createKakaoLocalProvider } from "./providers/kakaoLocal.js";
import { createMockPlaceProvider } from "./providers/mockPlaces.js";
import type { PlaceProvider } from "./providers/types.js";

export interface PlacesDeps {
  provider: PlaceProvider;
  guard: QuotaGuard;
  limiter: RateLimiter;
  now?: () => Date;
}

/**
 * 공급자 선택. PLACES_PROVIDER=kakao와 KAKAO_REST_API_KEY가 모두 있을 때만 실제 카카오를 쓴다.
 * 그 외에는 모의 공급자(외부 호출 없음). 실호출은 별도 승인 후 환경 변수로 켠다.
 */
export function selectPlaceProvider(env: Record<string, string | undefined>): PlaceProvider {
  const key = env.KAKAO_REST_API_KEY;
  if (env.PLACES_PROVIDER === "kakao" && key) return createKakaoLocalProvider(key);
  return createMockPlaceProvider();
}

function clientKey(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return request.headers.get("x-real-ip") ?? (forwarded || "unknown");
}

/** GET /api/places?q= 처리: 입력 검사 → 빈도 제한 → 사용량 예약 → 공급자 → 제주 결과만. */
export async function handlePlaces(request: Request, deps: PlacesDeps): Promise<Response> {
  const now = deps.now ?? (() => new Date());
  try {
    const query = (new URL(request.url).searchParams.get("q") ?? "").trim();
    if (!query || query.length > PLACE_QUERY_MAX_LENGTH) {
      throw new AppError("INVALID_INPUT", `검색어를 1~${PLACE_QUERY_MAX_LENGTH}자로 입력하세요.`);
    }

    const retryAt = deps.limiter.tryAcquire(clientKey(request));
    if (retryAt !== null) {
      throw new AppError("QUOTA_BLOCKED", "검색 요청이 너무 잦습니다. 잠시 후 다시 시도하세요.", new Date(retryAt).toISOString());
    }

    const places = await guardedCall(deps.guard, "kakaoLocal", () => deps.provider.search(query));
    const body: PlaceSearchResponse = {
      query,
      places: places.filter((p) => isInJeju(p.location) && isJejuAddress(p.address)),
      observedAt: now().toISOString(),
    };
    return Response.json(body, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    return toErrorResponse(err, now());
  }
}

/** 함수 인스턴스 공용 의존성. */
export const defaultPlacesDeps: PlacesDeps = {
  provider: selectPlaceProvider(process.env),
  guard: quotaGuard,
  limiter: new RateLimiter(PLACE_SEARCH_PER_MINUTE, 60_000),
};
