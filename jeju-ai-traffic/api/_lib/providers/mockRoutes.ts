import type { Coordinate, RouteCompareRequest } from "../../../shared/contracts/route.js";
import type { TrafficSegment, TrafficStatus } from "../../../shared/contracts/traffic.js";
import { distanceMeters } from "../../../shared/rules/geo.js";
import type { RouteQuery, RouteResult } from "../../../shared/rules/route.js";
import { dominantStatus } from "../../../shared/rules/traffic.js";
import type { RouteProvider } from "./types.js";

/** 호출 종류별 합성 계수: 직선거리 대비 도로 거리 배율, 평균 속도(km/h). 실제 교통이 아니다. */
const FACTORS: Record<RouteQuery["kind"], { detour: number; kmh: number }> = {
  recommend: { detour: 1.3, kmh: 48 },
  distance: { detour: 1.15, kmh: 38 },
  via1100: { detour: 1.25, kmh: 36 },
  via516: { detour: 1.2, kmh: 40 },
};

/** 호출 종류별 합성 혼잡(구간 순서대로 반복). 실제 교통이 아니다. */
const STATUS_PATTERN: Record<RouteQuery["kind"], TrafficStatus[]> = {
  recommend: ["smooth", "slow", "smooth"],
  distance: ["slow", "congested", "smooth"],
  via1100: ["unknown"],
  via516: ["smooth", "unknown"],
};

/** 직선 구간마다 중간점을 넣어 3등분하고 합성 혼잡을 붙인다. */
function mockGeometry(points: Coordinate[], kind: RouteQuery["kind"], totalMeters: number) {
  const geometry: Coordinate[] = [points[0]!];
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1]!;
    const b = points[i]!;
    for (const t of [1 / 3, 2 / 3, 1]) geometry.push({ lat: a.lat + (b.lat - a.lat) * t, lng: a.lng + (b.lng - a.lng) * t });
  }
  const pattern = STATUS_PATTERN[kind];
  const count = geometry.length - 1;
  const segments: TrafficSegment[] = Array.from({ length: count }, (_, i) => ({
    startIndex: i,
    endIndex: i + 1,
    status: pattern[i % pattern.length]!,
    distanceMeters: Math.round(totalMeters / count),
  }));
  return { geometry, segments };
}

/** 개발용 모의 경로(외부 호출 없음). 직선거리에서 합성한 값이며 provider: "mock"으로 표시된다. */
export function createMockRouteProvider(now: () => Date = () => new Date()): RouteProvider & { calls: number } {
  return {
    id: "kakao",
    calls: 0,
    async fetchRoute(request: RouteCompareRequest, query: RouteQuery): Promise<RouteResult> {
      this.calls += 1;
      const f = FACTORS[query.kind];
      const meters = Math.round(distanceMeters(request.origin, request.destination) * f.detour);
      const { geometry, segments } = mockGeometry(
        [request.origin, ...(query.via ? [query.via] : []), request.destination],
        query.kind,
        meters,
      );
      return {
        ok: true,
        route: {
          id: query.kind,
          provider: "mock",
          label: query.label,
          durationSeconds: Math.max(60, Math.round(meters / ((f.kmh * 1000) / 3600))),
          distanceMeters: meters,
          geometry,
          observedAt: now().toISOString(),
          trafficStatus: dominantStatus(segments),
          segments,
          incidentIds: [],
        },
      };
    },
  };
}
