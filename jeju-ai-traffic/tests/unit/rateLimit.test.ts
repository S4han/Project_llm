import { describe, expect, it } from "vitest";
import { RateLimiter } from "../../api/_lib/policies/rateLimit";

describe("RateLimiter", () => {
  it("창 안에서 한도까지 허용하고 다음 요청은 창 끝 시각을 돌려준다", () => {
    let now = 1_000;
    const limiter = new RateLimiter(20, 60_000, () => now);
    for (let i = 0; i < 20; i++) expect(limiter.tryAcquire("a")).toBeNull();
    expect(limiter.tryAcquire("a")).toBe(61_000);
    now = 60_999;
    expect(limiter.tryAcquire("a")).toBe(61_000);
    now = 61_000;
    expect(limiter.tryAcquire("a")).toBeNull();
  });

  it("키별로 따로 센다", () => {
    const limiter = new RateLimiter(1, 60_000, () => 0);
    expect(limiter.tryAcquire("a")).toBeNull();
    expect(limiter.tryAcquire("a")).not.toBeNull();
    expect(limiter.tryAcquire("b")).toBeNull();
  });
});
