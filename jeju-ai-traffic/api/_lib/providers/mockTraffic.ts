import type { TrafficIncident } from "../../../shared/contracts/traffic.js";
import type { TrafficProvider } from "./types.js";

/** 합성 모의 사건(실제 교통이 아니다). 좌표는 평화로 부근과 모의 516도로 경유선 위. */
const MOCK_INCIDENTS: Omit<TrafficIncident, "observedAt">[] = [
  {
    id: "mock-event-1",
    kind: "event",
    description: "정지차량",
    location: { lat: 33.4366, lng: 126.4242 },
    sourceTime: null,
    source: "mock",
  },
  {
    id: "mock-roadwork-1",
    kind: "roadwork",
    description: "도로 공사",
    // 모의 516도로 경유 경로(공항 → 성판악 직선) 위의 점
    location: { lat: 33.3972, lng: 126.6069 },
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
