import type { ApiError } from "../../../../shared/contracts/common";

const timeFormat = new Intl.DateTimeFormat("ko-KR", {
  timeZone: "Asia/Seoul",
  month: "long",
  day: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

/** 오류 안내 문구. 조회 제한이면 다시 쓸 수 있는 시각을 붙인다(COST-005). */
export function errorMessage(error: ApiError): string {
  if (error.code === "QUOTA_BLOCKED" && error.retryAfter) {
    return `${error.message} (${timeFormat.format(new Date(error.retryAfter))} 이후 다시 사용 가능)`;
  }
  return error.message;
}
