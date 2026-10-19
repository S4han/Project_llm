import type { TrafficIncident } from "../../../shared/contracts/traffic.js";
import type { TrafficProvider } from "./types.js";

/** 합성 모의 사건(실제 교통이 아니다). 좌표는 모의 추천 경로(공항 → 서귀포시청 직선) 위. */
const MOCK_INCIDENTS: Omit<TrafficIncident, "observedAt">[] = [
  {
    id: "mock-event-1",
    kind: "event",
    description: "정지차량",
    location: { lat: 33.4308, lng: 126.5131 },
    sourceTime: null,
    source: "mock",
  },
  {
    id: "mock-roadwork-1",
    kind: "roadwork",
    description: "도로 공사",
    location: { lat: 33.3551, lng: 126.5332 },
    sourceTime: null,
    source: "mock",
  },
];

export function createMockTrafficProvider(now: () => Date = () => new Date()): TrafficProvider & { calls: number } {
  return {
    id: "jejuIts",
    calls: 0,
    async fetchIncidents(): Promise<TrafficIncident[]> {
      this.calls += 1;
      const observedAt = now().toISOString();
      return MOCK_INCIDENTS.map((i) => ({ ...i, observedAt }));
    },
  };
}
