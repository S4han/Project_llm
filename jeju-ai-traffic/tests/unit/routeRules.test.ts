import { describe, expect, it } from "vitest";
import type { RouteOption } from "../../shared/contracts/route";
import {
  dedupeRoutes,
  durationDiffSeconds,
  isSameRoute,
  pickRecommended,
  planRouteQueries,
} from "../../shared/rules/route";


function route(id: string, durationSeconds: number, distanceMeters: number): RouteOption {
  return {
    id,
    provider: "kakao",
    label: id,
    durationSeconds,
    distanceMeters,
    geometry: [],
    observedAt: "2026-10-19T00:00:00.000Z",
    trafficStatus: "unknown",
    segments: [],
    incidentIds: [],
  };
}

describe("경로 구성", () => {
  it("카카오 추천 1회만 호출한다(TASK-011 경로방식 (a), 경유 호출 없음)", () => {
    expect(planRouteQueries()).toEqual([{ kind: "recommend", label: "카카오 추천" }]);
  });
});

describe("같은 경로 합치기", () => {
  it("거리 1% 이내 + 시간 120초 이내만 같은 경로", () => {
    expect(isSameRoute(route("a", 4000, 50000), route("b", 4120, 50500))).toBe(true);
    expect(isSameRoute(route("a", 4000, 50000), route("b", 4121, 50000))).toBe(false);
    expect(isSameRoute(route("a", 4000, 50000), route("b", 4000, 50506))).toBe(false);
  });

  it("앞 순서를 남긴다", () => {
    const kept = dedupeRoutes([route("recommend", 4166, 52300), route("distance", 4770, 43000), route("x", 4200, 52400)]);
    expect(kept.map((r) => r.id)).toEqual(["recommend", "distance"]);
  });

  it("실호출 요약값(TASK-005)에서 서로 다른 경로는 합치지 않는다", () => {
    // 공항→서귀포시청: distance 43.0km/4770s, via516 43.5km/4601s → 거리 1.2% 차이
    expect(isSameRoute(route("distance", 4770, 43000), route("via516", 4601, 43500))).toBe(false);
  });
});

describe("최단 추천과 동률 규칙", () => {
  it("예상시간 최솟값을 추천하고 동률이 없으면 tied는 빈 배열", () => {
    expect(pickRecommended([route("a", 4770, 43000), route("b", 4166, 52300)])).toEqual({
      recommendedRouteId: "b",
      tiedRouteIds: [],
    });
  });

  it("동률이면 거리가 짧은 경로, 동률 경로는 모두 표시", () => {
    expect(pickRecommended([route("a", 4000, 50000), route("b", 4000, 45000), route("c", 4500, 40000)])).toEqual({
      recommendedRouteId: "b",
      tiedRouteIds: ["a", "b"],
    });
  });

  it("시간·거리 모두 같으면 입력(호출) 순서", () => {
    expect(pickRecommended([route("recommend", 4000, 50000), route("distance", 4000, 50000)]).recommendedRouteId).toBe(
      "recommend",
    );
  });

  it("1초 차이는 동률이 아니다(초 단위 판단)", () => {
    expect(pickRecommended([route("a", 4000, 40000), route("b", 4001, 30000)])).toEqual({
      recommendedRouteId: "a",
      tiedRouteIds: [],
    });
  });

  it("경로 하나 / 없음", () => {
    expect(pickRecommended([route("a", 1, 1)])).toEqual({ recommendedRouteId: "a", tiedRouteIds: [] });
    expect(pickRecommended([])).toEqual({ recommendedRouteId: null, tiedRouteIds: [] });
  });

  it("차이는 원천 초 단위 그대로", () => {
    expect(durationDiffSeconds(route("a", 4770, 0), route("b", 4166, 0))).toBe(604);
  });
});
