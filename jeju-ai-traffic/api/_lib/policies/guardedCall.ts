import type { ProviderId } from "../../../shared/contracts/common.js";
import { AppError, ProviderError } from "../errors.js";
import type { QuotaGuard, ReserveOptions } from "./quota.js";

/**
 * 모든 외부 호출이 지나가는 관문: 사용량 예약 → 호출 → 오류 정규화.
 * 예약이 거절되면 call은 실행되지 않는다(외부 호출 0회). 실패한 호출도 사용량에서 되돌리지 않는다.
 */
export async function guardedCall<T>(
  guard: QuotaGuard,
  provider: ProviderId,
  call: () => Promise<T>,
  options: ReserveOptions = {},
): Promise<T> {
  await guard.reserve(provider, options);
  try {
    return await call();
  } catch (err) {
    if (err instanceof AppError) throw err;
    if (err instanceof ProviderError && err.kind === "rate_limited") {
      const until = await guard.blockForToday(provider);
      throw new AppError("QUOTA_BLOCKED", "공급자 호출 한도에 도달해 조회를 중단했습니다.", until.toISOString());
    }
    throw new AppError("PROVIDER_UNAVAILABLE", "일시적으로 정보를 가져올 수 없습니다.");
  }
}
