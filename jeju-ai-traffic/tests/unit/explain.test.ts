import { describe, expect, it } from "vitest";
import { buildRulesExplanation, explain } from "../../api/_lib/explanations/explain";
import { DEFAULT_BUDGETS, MemoryQuotaStore, QuotaGuard } from "../../api/_lib/policies/quota";
import { MockExplanationProvider } from "../../api/_lib/providers/mock";
import { INCIDENTS, ROUTES } from "../fixtures/routes";

const NOW = new Date("2026-10-19T03:00:00.000Z");
const INPUT = { routes: ROUTES, recommendedRouteId: "recommend", incidents: INCIDENTS };
const openAiBudget = { ...DEFAULT_BUDGETS, ai: { dailyLimit: 10 } };

describe("규칙 기반 설명", () => {
  it("입력의 예상시간만으로 비교하고 근거에 기준 시각을 담는다", () => {
    const e = buildRulesExplanation(INPUT, NOW);
    expect(e.source).toBe("rules");
    expect(e.text).toBe(
      "평화로 경로의 예상 소요시간은 68분입니다. 다음으로 빠른 516도로 경로보다 약 8분 빠릅니다. 경로 주변에서 확인된 교통 사건이 1건 있습니다.",
    );
    expect(e.evidence).toHaveLength(4);
    expect(e.evidence.every((line) => line.includes("2026-10-19T00:00:00.000Z"))).toBe(true);
  });

  it("경로가 하나면 대체 경로 없음을 알리고, 사건이 없으면 언급하지 않는다", () => {
    const e = buildRulesExplanation({ routes: [ROUTES[0]!], recommendedRouteId: "recommend", incidents: [] }, NOW);
    expect(e.text).toBe("평화로 경로의 예상 소요시간은 68분입니다. 비교할 대체 경로가 없습니다.");
  });

  it("추천 경로가 더 느리면 그 사실대로 설명한다", () => {
    const e = buildRulesExplanation({ ...INPUT, recommendedRouteId: "via1100" }, NOW);
    expect(e.text).toContain("평화로 경로가 약 22분 더 빠릅니다.");
  });
});

describe("AI 대체 계약", () => {
  it("기본 예산(AI 0건)에서는 AI를 호출하지 않고 규칙 설명을 쓴다", async () => {
    const ai = new MockExplanationProvider("AI 문장");
    const guard = new QuotaGuard(new MemoryQuotaStore(), DEFAULT_BUDGETS, () => NOW);
    const e = await explain(INPUT, { guard, ai, verify: () => true, now: () => NOW });
    expect(e.source).toBe("rules");
    expect(ai.calls).toBe(0);
  });

  it("AI 공급자가 없으면 규칙 설명", async () => {
    const guard = new QuotaGuard(new MemoryQuotaStore(), openAiBudget, () => NOW);
    expect((await explain(INPUT, { guard, now: () => NOW })).source).toBe("rules");
  });

  it("AI 실패·429면 규칙 설명으로 대체한다", async () => {
    for (const behavior of ["unavailable", "rate_limited"] as const) {
      const ai = new MockExplanationProvider("AI 문장");
      ai.behavior = behavior;
      const guard = new QuotaGuard(new MemoryQuotaStore(), openAiBudget, () => NOW);
      const e = await explain(INPUT, { guard, ai, verify: () => true, now: () => NOW });
      expect(e.source).toBe("rules");
      expect(ai.calls).toBe(1);
    }
  });

  it("검증 함수가 없으면(기본 거부) AI 문장을 쓰지 않는다", async () => {
    const ai = new MockExplanationProvider("AI 문장");
    const guard = new QuotaGuard(new MemoryQuotaStore(), openAiBudget, () => NOW);
    const e = await explain(INPUT, { guard, ai, now: () => NOW });
    expect(e.source).toBe("rules");
  });

  it("검증을 통과한 AI 문장만 source ai로 쓰고 근거는 규칙 근거를 유지한다", async () => {
    const ai = new MockExplanationProvider("AI 문장");
    const guard = new QuotaGuard(new MemoryQuotaStore(), openAiBudget, () => NOW);
    const e = await explain(INPUT, { guard, ai, verify: () => true, now: () => NOW });
    expect(e).toEqual({
      text: "AI 문장",
      source: "ai",
      evidence: buildRulesExplanation(INPUT, NOW).evidence,
      generatedAt: NOW.toISOString(),
    });
  });
});
