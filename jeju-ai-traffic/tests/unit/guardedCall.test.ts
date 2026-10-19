import { describe, expect, it } from "vitest";
import { AppError } from "../../api/_lib/errors";
import { guardedCall } from "../../api/_lib/policies/guardedCall";
import { DEFAULT_BUDGETS, MemoryQuotaStore, QuotaGuard } from "../../api/_lib/policies/quota";
import { MockRouteProvider } from "../../api/_lib/providers/mock";
import { REQUEST, ROUTES } from "../fixtures/routes";

function setup(start = "2026-10-19T03:00:00.000Z") {
  let now = new Date(start);
  const guard = new QuotaGuard(new MemoryQuotaStore(), DEFAULT_BUDGETS, () => now);
  const provider = new MockRouteProvider(ROUTES);
  const call = (purpose: "user" | "reevaluation" = "user") =>
    guardedCall(guard, "kakao", () => provider.fetchRoute(REQUEST, { kind: "recommend", label: "카카오 추천" }), {
      cost: 3,
      purpose,
    });
  return { guard, provider, call, setNow: (iso: string) => (now = new Date(iso)) };
}

async function codeOf(p: Promise<unknown>): Promise<string | undefined> {
  return p.then(
    () => undefined,
    (e: unknown) => (e instanceof AppError ? e.code : "NOT_APP_ERROR"),
  );
}

describe("guardedCall", () => {
  it("허용되면 공급자 결과를 그대로 돌려주고 원천 시각을 유지한다", async () => {
    const { call, provider } = setup();
    const result = await call();
    expect(result).toEqual({ ok: true, route: ROUTES[0] });
    expect(result.ok && Number.isNaN(Date.parse(result.route.observedAt))).toBe(false);
    expect(provider.calls).toBe(1);
  });

  it("한도에 도달하면 외부 호출 0회로 QUOTA_BLOCKED", async () => {
    const { guard, call, provider } = setup();
    await guard.reserve("kakao", { cost: 7998 });
    expect(await codeOf(call())).toBe("QUOTA_BLOCKED");
    expect(provider.calls).toBe(0);
  });

  it("남은 예산이 요청 1건분일 때 동시 요청 10건 중 1건만 외부 호출한다", async () => {
    const { guard, call, provider } = setup();
    await guard.reserve("kakao", { cost: 7997 });
    const results = await Promise.allSettled(Array.from({ length: 10 }, () => call()));
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(provider.calls).toBe(1);
    expect((await guard.status("kakao")).used).toBe(8000);
  });

  it("공급자 429 → QUOTA_BLOCKED, 다음 KST 0시까지 외부 호출 0회, 이후 재개", async () => {
    const { call, provider, setNow } = setup();
    provider.behavior = "rate_limited";
    const err = (await call().then(
      () => undefined,
      (e: unknown) => e,
    )) as AppError;
    expect(err.code).toBe("QUOTA_BLOCKED");
    expect(err.retryAfter).toBe("2026-10-19T15:00:00.000Z");
    expect(provider.calls).toBe(1);

    provider.behavior = "ok";
    setNow("2026-10-19T14:59:59.000Z");
    expect(await codeOf(call())).toBe("QUOTA_BLOCKED");
    expect(provider.calls).toBe(1);

    setNow("2026-10-19T15:00:00.000Z");
    await call();
    expect(provider.calls).toBe(2);
  });

  it("공급자 장애는 PROVIDER_UNAVAILABLE이며 차단하지 않고, 사용량은 되돌리지 않는다", async () => {
    const { guard, call, provider } = setup();
    provider.behavior = "unavailable";
    expect(await codeOf(call())).toBe("PROVIDER_UNAVAILABLE");
    expect((await guard.status("kakao")).used).toBe(3);
    provider.behavior = "ok";
    await call();
    expect(provider.calls).toBe(2);
  });

  it("예상하지 못한 오류도 PROVIDER_UNAVAILABLE로 감싼다", async () => {
    const { guard } = setup();
    const result = guardedCall(guard, "kakao", async () => {
      throw new TypeError("boom");
    });
    expect(await codeOf(result)).toBe("PROVIDER_UNAVAILABLE");
  });
});
