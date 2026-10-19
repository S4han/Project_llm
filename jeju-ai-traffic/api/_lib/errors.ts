import type { ApiErrorBody, ErrorCode, IsoDateTime } from "../../shared/contracts/common.js";

/** 오류 코드 ↔ HTTP 상태 (DECISIONS 2026-10-19 TASK-003 "3. 승인"). STALE_DATA는 데이터와 함께 200으로 응답한다. */
export const HTTP_STATUS: Record<ErrorCode, number> = {
  INVALID_INPUT: 400,
  LOCATION_UNAVAILABLE: 422,
  QUOTA_BLOCKED: 429,
  PROVIDER_UNAVAILABLE: 503,
  STALE_DATA: 200,
};

export class AppError extends Error {
  readonly code: ErrorCode;
  readonly retryAfter?: IsoDateTime;

  constructor(code: ErrorCode, message: string, retryAfter?: IsoDateTime) {
    super(message);
    this.name = "AppError";
    this.code = code;
    this.retryAfter = retryAfter;
  }
}

/** 외부 공급자 어댑터가 던지는 오류. 호출 관문이 AppError로 바꾼다. */
export class ProviderError extends Error {
  readonly kind: "rate_limited" | "unavailable";

  constructor(kind: "rate_limited" | "unavailable", message: string) {
    super(message);
    this.name = "ProviderError";
    this.kind = kind;
  }
}

/** 오류를 공통 JSON 응답으로 바꾼다. 내부 오류 상세는 응답에 싣지 않는다. */
export function toErrorResponse(err: unknown, now: Date = new Date()): Response {
  const appError =
    err instanceof AppError ? err : new AppError("PROVIDER_UNAVAILABLE", "일시적으로 정보를 가져올 수 없습니다.");
  const body: ApiErrorBody = {
    error: { code: appError.code, message: appError.message },
  };
  const headers = new Headers({ "Cache-Control": "no-store" });
  if (appError.retryAfter) {
    body.error.retryAfter = appError.retryAfter;
    const seconds = Math.max(0, Math.ceil((Date.parse(appError.retryAfter) - now.getTime()) / 1000));
    headers.set("Retry-After", String(seconds));
  }
  return Response.json(body, { status: HTTP_STATUS[appError.code], headers });
}
