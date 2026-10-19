import { describe, expect, it } from "vitest";
import { AppError } from "../../api/_lib/errors";
import { DEFAULT_BUDGETS, MemoryQuotaStore, QuotaGuard } from "../../api/_lib/policies/quota";

function setup(start = "2026-10-19T03:00:00.000Z") {
  let now = new Date(start);
  const guard = new QuotaGuard(new MemoryQuotaStore(), DEFAULT_BUDGETS, () => now);
  return { guard, setNow: (iso: string) => (now = new Date(iso)) };
}

async function blocked(p: Promise<unknown>): Promise<AppError> {
  const err = await p.then(
    () => undefined,
    (e: unknown) => e,
  );
  expect(err).toBeInstanceOf(AppError);
  expect((err as AppError).code).toBe("QUOTA_BLOCKED");
  return err as AppError;
}

describe("승인된 기본 예산", () => {
  it("카카오 8,000 / 재평가 6,000, 장소 검색 3,000, ITS 2,000, AI 0", () => {
    expect(DEFAULT_BUDGETS).toEqual({
      kakao: { dailyLimit: 8000, reevaluationCutoff: 6000 },
      kakaoLocal: { dailyLimit: 3000 },
      jejuIts: { dailyLimit: 2000 },
      ai: { dailyLimit: 0 },
    });
  });
});

describe("QuotaGuard", () => {
  it("한도 직전까지 허용하고 한도에서 QUOTA_BLOCKED, retryAfter는 다음 KST 0시", async () => {
    const { guard } = setup();
    await guard.reserve("kakao", { cost: 7999 });
    await guard.reserve("kakao");
    const err = await blocked(guard.reserve("kakao"));
    expect(err.retryAfter).toBe("2026-10-19T15:00:00.000Z");
    expect((await guard.status("kakao")).used).toBe(8000);
  });

  it("비용이 남은 한도를 넘으면 거절하고 사용량을 늘리지 않는다", async () => {
    const { guard } = setup();
    await guard.reserve("kakao", { cost: 7998 });
    await blocked(guard.reserve("kakao", { cost: 3 }));
    expect((await guard.status("kakao")).used).toBe(7998);
    await guard.reserve("kakao", { cost: 2 });
  });

  it("사용량 6,000 이상이면 재평가는 막고 직접 조회는 허용한다", async () => {
    const { guard } = setup();
    await guard.reserve("kakao", { cost: 5999, purpose: "reevaluation" });
    await guard.reserve("kakao", { purpose: "reevaluation" });
    const err = await blocked(guard.reserve("kakao", { purpose: "reevaluation" }));
    expect(err.message).toContain("자동 재평가");
    await guard.reserve("kakao", { cost: 2000, purpose: "user" });
    await blocked(guard.reserve("kakao"));
  });

  it("AI는 기본 한도 0이라 첫 호출부터 차단된다", async () => {
    const { guard } = setup();
    await blocked(guard.reserve("ai"));
  });

  it("공급자별로 따로 센다", async () => {
    const { guard } = setup();
    await guard.reserve("jejuIts", { cost: 2000 });
    await blocked(guard.reserve("jejuIts"));
    await guard.reserve("kakao");
  });

  it("KST 0시에 사용량이 초기화된다", async () => {
    const { guard, setNow } = setup("2026-10-19T14:59:00.000Z");
    await guard.reserve("kakao", { cost: 8000 });
    await blocked(guard.reserve("kakao"));
    setNow("2026-10-19T15:00:00.000Z");
    await guard.reserve("kakao");
    expect((await guard.status("kakao")).used).toBe(1);
  });

  it("blockForToday는 다음 KST 0시까지 막고 이후 풀린다", async () => {
    const { guard, setNow } = setup();
    const until = await guard.blockForToday("kakao");
    expect(until.toISOString()).toBe("2026-10-19T15:00:00.000Z");
    const err = await blocked(guard.reserve("kakao"));
    expect(err.retryAfter).toBe(until.toISOString());
    expect((await guard.status("kakao")).used).toBe(0);
    setNow("2026-10-19T15:00:00.000Z");
    await guard.reserve("kakao");
    expect((await guard.status("kakao")).blockedUntil).toBeUndefined();
  });
});
