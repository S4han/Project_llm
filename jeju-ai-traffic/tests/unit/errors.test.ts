import { describe, expect, it } from "vitest";
import { AppError, HTTP_STATUS, toErrorResponse } from "../../api/_lib/errors";
import { ERROR_CODES } from "../../shared/contracts/common";

describe("오류 ↔ HTTP 상태", () => {
  it("승인된 대응표와 같다", () => {
    expect(HTTP_STATUS).toEqual({
      INVALID_INPUT: 400,
      LOCATION_UNAVAILABLE: 422,
      QUOTA_BLOCKED: 429,
      PROVIDER_UNAVAILABLE: 503,
      STALE_DATA: 200,
    });
    expect(Object.keys(HTTP_STATUS).sort()).toEqual([...ERROR_CODES].sort());
  });

  it.each(ERROR_CODES.filter((c) => c !== "STALE_DATA"))("%s 응답은 대응 상태와 같은 코드를 담는다", async (code) => {
    const res = toErrorResponse(new AppError(code, "msg"));
    expect(res.status).toBe(HTTP_STATUS[code]);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(await res.json()).toEqual({ error: { code, message: "msg" } });
  });

  it("QUOTA_BLOCKED는 retryAfter와 Retry-After(초)를 싣는다", async () => {
    const now = new Date("2026-10-19T14:00:00.000Z");
    const res = toErrorResponse(new AppError("QUOTA_BLOCKED", "msg", "2026-10-19T15:00:00.000Z"), now);
    expect(res.status).toBe(429);
    expect(res.headers.get("retry-after")).toBe("3600");
    expect((await res.json()).error.retryAfter).toBe("2026-10-19T15:00:00.000Z");
  });

  it("알 수 없는 오류는 내부 메시지 없이 503 PROVIDER_UNAVAILABLE", async () => {
    const res = toErrorResponse(new Error("secret internal detail"));
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.error.code).toBe("PROVIDER_UNAVAILABLE");
    expect(JSON.stringify(body)).not.toContain("secret");
  });
});
