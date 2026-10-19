// 합성 모의 데이터. 실제 공급자 응답 원문이 아니다(TASK-001 저장 금지 조건).
import type { RouteOption } from "../../shared/contracts/route";
import type { TrafficIncident } from "../../shared/contracts/traffic";

export const OBSERVED_AT = "2026-10-19T00:00:00.000Z";

const AIRPORT = { lat: 33.5066, lng: 126.4929 };
const SEOGWIPO = { lat: 33.2541, lng: 126.5601 };

export const ROUTES: RouteOption[] = [
  {
    id: "recommend",
    provider: "kakao",
    label: "평화로",
    durationSeconds: 4080,
    distanceMeters: 52400,
    geometry: [AIRPORT, SEOGWIPO],
    observedAt: OBSERVED_AT,
    trafficStatus: "smooth",
  },
  {
    id: "via516",
    provider: "kakao",
    label: "516도로",
    durationSeconds: 4560,
    distanceMeters: 43300,
    geometry: [AIRPORT, SEOGWIPO],
    observedAt: OBSERVED_AT,
    trafficStatus: "unknown",
  },
  {
    id: "via1100",
    provider: "kakao",
    label: "1100도로",
    durationSeconds: 5400,
    distanceMeters: 48300,
    geometry: [AIRPORT, SEOGWIPO],
    observedAt: OBSERVED_AT,
    trafficStatus: "slow",
  },
];

export const INCIDENTS: TrafficIncident[] = [
  {
    id: "evt-1",
    kind: "event",
    description: "정지차량",
    location: { lat: 33.43, lng: 126.45 },
    observedAt: OBSERVED_AT,
    source: "jejuIts",
  },
];

export const REQUEST = { origin: AIRPORT, destination: SEOGWIPO };
