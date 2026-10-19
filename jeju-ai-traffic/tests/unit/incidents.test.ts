import { describe, expect, it } from "vitest";
import type { TrafficIncident } from "../../shared/contracts/traffic";
import { groupIncidents } from "../../web/src/features/routes/incidents";

const AT = "2026-10-19T07:00:00.000Z";
const inc = (id: string, over: Partial<TrafficIncident> = {}): TrafficIncident => ({
  id,
  kind: "event",
  description: "정지차량",
  location: { lat: 33.4, lng: 126.5 },
  observedAt: AT,
  sourceTime: null,
  source: "jejuIts",
  ...over,
});

describe("groupIncidents", () => {
  it("같은 종류·내용은 한 줄로 묶고 건수를 센다", () => {
    const groups = groupIncidents([inc("a"), inc("b"), inc("c", { kind: "roadwork", description: "도로 공사" }), inc("d")]);
    expect(groups.map((g) => [g.label, g.count])).toEqual([
      ["정지차량 감지", 3],
      ["공사 도로 공사", 1],
    ]);
    expect(groups[0]?.latestSourceTime).toBeNull();
  });

  it("원천 시각이 있으면 가장 늦은 시각, 모의 데이터면 표시", () => {
    const [g] = groupIncidents([
      inc("a", { sourceTime: "2026-10-19T06:00:00.000Z" }),
      inc("b", { sourceTime: "2026-10-19T06:30:00.000Z", source: "mock" }),
    ]);
    expect(g?.latestSourceTime).toBe("2026-10-19T06:30:00.000Z");
    expect(g?.mock).toBe(true);
  });
});
