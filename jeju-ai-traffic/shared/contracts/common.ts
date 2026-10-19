/** ISO 8601 UTC 시각 문자열 (예: 2026-10-19T00:00:00.000Z). */
export type IsoDateTime = string;

/** 외부 호출 공급자. 사용량 한도는 이 단위로 관리한다. */
export type ProviderId = "kakao" | "jejuIts" | "ai";

/** 공통 오류 코드. HTTP 상태 대응은 api/_lib/errors.ts. */
export const ERROR_CODES = [
  "INVALID_INPUT",
  "LOCATION_UNAVAILABLE",
  "QUOTA_BLOCKED",
  "PROVIDER_UNAVAILABLE",
  "STALE_DATA",
] as const;
export type ErrorCode = (typeof ERROR_CODES)[number];

export interface ApiError {
  code: ErrorCode;
  message: string;
  /** QUOTA_BLOCKED일 때 호출이 다시 허용되는 시각. */
  retryAfter?: IsoDateTime;
}

export interface ApiErrorBody {
  error: ApiError;
}

/** 외부 데이터가 담긴 응답의 공통 필드. */
export interface Freshness {
  /** 원천 데이터 기준 시각. */
  observedAt: IsoDateTime;
  /** 오래된 데이터 여부(STALE_DATA). 판단 임계값은 미결정(PRD NFR-007). */
  stale: boolean;
}
