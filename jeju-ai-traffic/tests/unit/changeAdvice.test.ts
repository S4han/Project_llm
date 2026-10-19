import { describe, expect, it } from "vitest";
import type { RouteCompareResponse, RouteOption } from "../../shared/contracts/route";
import { adviceReducer, findChange, initialAdvice, type AdviceState } from "../../shared/rules/changeAdvice";

const r = (id: string, sec: number): RouteOption => ({
  id, provider: "kakao", label: `${id}-label`, durationSeconds: sec, distanceMeters: 1, geometry: [], observedAt: "x", trafficStatus: "unknown", segments: [], incidentIds: [],
});
const data = (...routes: RouteOption[]): RouteCompareResponse => ({
  routes, recommendedRouteId: routes[0]?.id ?? null, tiedRouteIds: [], observedAt: "x", stale: false, incidents: [], incidentsStatus: "ok", incidentsObservedAt: null,
});
/** 따라가는 경로(via1100) 3600초, 대체(recommend)는 3600 − savings초. */
const withSavings = (savings: number, to = "recommend") => data(r("via1100", 3600), r(to, 3600 - savings));

describe("변경 판정 (FR-010 경계값)", () => {
  it.each([
    [180, false, "AC-010-01 3분"],
    [299, false, "AC-010-02 4분 59초"],
    [300, true, "AC-010-03 정확히 5분"],
    [480, true, "AC-010-04 8분"],
    [-120, false, "AC-010-05 대체 경로가 더 느림"],
    [0, false, "같음"],
  ])("단축 %i초 → 안내 %s (%s)", (savings, expected) => {
    expect(findChange(withSavings(savings), "via1100") !== null).toBe(expected);
  });

  it("대체 경로 중 가장 빠른 것과 비교한다", () => {
    const c = findChange(data(r("via1100", 3600), r("distance", 3400), r("recommend", 3200)), "via1100");
    expect(c).toEqual({ from: "via1100", to: "recommend", toLabel: "recommend-label", savingsSeconds: 400 });
  });

  it("따라가는 방식의 경로가 없거나 대체 경로가 없으면 안내하지 않는다 (비교 불가)", () => {
    expect(findChange(data(r("recommend", 1000)), "via1100")).toBeNull();
    expect(findChange(data(r("via1100", 3600)), "via1100")).toBeNull();
  });
});

describe("안내 상태 (변경/유지, 중복 억제)", () => {
  const run = (events: Parameters<typeof adviceReducer>[1][], start: AdviceState = initialAdvice("via1100")) => events.reduce(adviceReducer, start);

  it("5분 이상이면 안내, '변경'하면 따라가는 경로가 바뀐다", () => {
    const shown = run([{ type: "data", data: withSavings(360) }]);
    expect(shown.pending?.savingsSeconds).toBe(360);
    const accepted = adviceReducer(shown, { type: "accept" });
    expect(accepted.followed).toBe("recommend");
    expect(accepted.pending).toBeNull();
    expect(accepted.notice).toEqual({ kind: "accepted", label: "recommend-label" });
  });

  it("'유지'하면 현재 경로를 유지한다 (AC-010-06)", () => {
    const s = run([{ type: "data", data: withSavings(360) }, { type: "decline" }]);
    expect(s.followed).toBe("via1100");
    expect(s.pending).toBeNull();
    expect(s.notice).toEqual({ kind: "declined" });
  });

  it("유지한 같은 조합은 다시 안내하지 않는다, 단 거부 당시보다 5분 이상 더 단축되면 재안내 (AC-010-07, 규칙 (a))", () => {
    const declined = run([{ type: "data", data: withSavings(360) }, { type: "decline" }]);
    expect(run([{ type: "data", data: withSavings(400) }], declined).pending).toBeNull();
    expect(run([{ type: "data", data: withSavings(659) }], declined).pending).toBeNull();
    expect(run([{ type: "data", data: withSavings(660) }], declined).pending?.savingsSeconds).toBe(660);
  });

  it("대체 경로가 바뀌면 새 상황으로 안내한다", () => {
    const declined = run([{ type: "data", data: withSavings(360, "recommend") }, { type: "decline" }]);
    const s = run([{ type: "data", data: withSavings(360, "distance") }], declined);
    expect(s.pending?.to).toBe("distance");
  });

  it("답하지 않은 안내는 같은 조합이면 숫자만 갱신하고 새 안내를 만들지 않는다", () => {
    const s = run([{ type: "data", data: withSavings(360) }, { type: "data", data: withSavings(420) }]);
    expect(s.pending).toEqual({ from: "via1100", to: "recommend", toLabel: "recommend-label", savingsSeconds: 420 });
  });

  it("다음 재평가에서 5분 미만이면 안내를 닫고 알린다 — '유지'로 보지 않는다", () => {
    const withdrawn = run([{ type: "data", data: withSavings(360) }, { type: "data", data: withSavings(200) }]);
    expect(withdrawn.pending).toBeNull();
    expect(withdrawn.notice).toEqual({ kind: "withdrawn" });
    expect(withdrawn.declined).toEqual({});
    expect(run([{ type: "data", data: withSavings(360) }], withdrawn).pending?.savingsSeconds).toBe(360);
  });

  it("모니터링이 멈추면 안내를 닫고, 다시 시작하면 기록을 초기화한다", () => {
    const s = run([{ type: "data", data: withSavings(360) }, { type: "stop" }]);
    expect(s.pending).toBeNull();
    const reset = adviceReducer({ ...s, declined: { "a->b": 1 } }, { type: "reset", followed: "distance" });
    expect(reset).toEqual(initialAdvice("distance"));
  });

  it("변경 후에는 새 경로 기준으로 비교한다", () => {
    const s = run([{ type: "data", data: withSavings(360) }, { type: "accept" }, { type: "data", data: withSavings(360) }]);
    // 새 기준 recommend(3240) vs via1100(3600): 대체가 더 느려 안내 없음
    expect(s.followed).toBe("recommend");
    expect(s.pending).toBeNull();
  });
});
