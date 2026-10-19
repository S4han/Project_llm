import type { RouteCompareRequest } from "../../../shared/contracts/route.js";
import { distanceMeters } from "../../../shared/rules/geo.js";
import type { RouteQuery, RouteResult } from "../../../shared/rules/route.js";
import type { RouteProvider } from "./types.js";

/** 호출 종류별 합성 계수: 직선거리 대비 도로 거리 배율, 평균 속도(km/h). 실제 교통이 아니다. */
const FACTORS: Record<RouteQuery["kind"], { detour: number; kmh: number }> = {
  recommend: { detour: 1.3, kmh: 48 },
  distance: { detour: 1.15, kmh: 38 },
  via1100: { detour: 1.25, kmh: 36 },
  via516: { detour: 1.2, kmh: 40 },
};

/** 개발용 모의 경로(외부 호출 없음). 직선거리에서 합성한 값이며 provider: "mock"으로 표시된다. */
export function createMockRouteProvider(now: () => Date = () => new Date()): RouteProvider & { calls: number } {
  return {
    id: "kakao",
    calls: 0,
    async fetchRoute(request: RouteCompareRequest, query: RouteQuery): Promise<RouteResult> {
      this.calls += 1;
      const f = FACTORS[query.kind];
      const meters = Math.round(distanceMeters(request.origin, request.destination) * f.detour);
      return {
        ok: true,
        route: {
          id: query.kind,
          provider: "mock",
          label: query.label,
          durationSeconds: Math.max(60, Math.round(meters / ((f.kmh * 1000) / 3600))),
          distanceMeters: meters,
          geometry: [request.origin, ...(query.via ? [query.via] : []), request.destination],
          observedAt: now().toISOString(),
          trafficStatus: "unknown",
        },
      };
    },
  };
}
