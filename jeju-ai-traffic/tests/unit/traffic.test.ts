import { describe, expect, it } from "vitest";
import type { TrafficIncident, TrafficSegment } from "../../shared/contracts/traffic";
import {
  dedupeIncidents,
  distanceToPolylineMeters,
  dominantStatus,
  isStale,
  kakaoTrafficStatus,
  matchIncidents,
  trafficShares,
} from "../../shared/rules/traffic";

const seg = (status: TrafficSegment["status"], distanceMeters: number): TrafficSegment => ({ startIndex: 0, endIndex: 1, status, distanceMeters });
const incident = (id: string, lat: number, lng: number, kind: TrafficIncident["kind"] = "event"): TrafficIncident => ({
  id, kind, description: "x", location: { lat, lng }, observedAt: "2026-10-19T00:00:00.000Z", sourceTime: null, source: "jejuIts",
});

describe("카카오 혼잡 코드", () => {
  it("4 원활, 2·3 서행, 1·6 정체, 0·그 외 정보 미확보", () => {
    expect([4, 2, 3, 1, 6, 0, 5, undefined, "4"].map(kakaoTrafficStatus)).toEqual([
      "smooth", "slow", "slow", "congested", "congested", "unknown", "unknown", "unknown", "unknown",
    ]);
  });
});

describe("혼잡 비율·대표 상태", () => {
  it("거리 기준 비율", () => {
    expect(trafficShares([seg("smooth", 600), seg("slow", 300), seg("unknown", 100)])).toEqual({
      smooth: 0.6, slow: 0.3, congested: 0, unknown: 0.1,
    });
  });

  it("구간이 없거나 거리 0이면 정보 미확보 100%", () => {
    expect(trafficShares([]).unknown).toBe(1);
    expect(trafficShares([seg("smooth", 0)]).unknown).toBe(1);
  });

  it("대표 상태는 가장 긴 상태, 같으면 정보 미확보 우선", () => {
    expect(dominantStatus([seg("smooth", 600), seg("congested", 400)])).toBe("smooth");
    expect(dominantStatus([seg("smooth", 500), seg("unknown", 500)])).toBe("unknown");
    expect(dominantStatus([])).toBe("unknown");
  });
});

describe("사건-경로 매칭 (200m)", () => {
  const line = [
    { lat: 33.4, lng: 126.5 },
    { lat: 33.5, lng: 126.5 },
  ];
  const east = (m: number) => 126.5 + m / (111_320 * Math.cos((33.45 * Math.PI) / 180));

  it("선 위는 0m, 동쪽으로 떨어진 거리를 잰다", () => {
    expect(distanceToPolylineMeters({ lat: 33.45, lng: 126.5 }, line)).toBeCloseTo(0, 5);
    expect(distanceToPolylineMeters({ lat: 33.45, lng: east(150) }, line)).toBeCloseTo(150, 0);
    expect(distanceToPolylineMeters({ lat: 33.45, lng: 126.5 }, [])).toBe(Number.POSITIVE_INFINITY);
  });

  it("199m는 연결, 201m는 연결하지 않는다", () => {
    expect(matchIncidents([incident("a", 33.45, east(199)), incident("b", 33.45, east(201))], line)).toEqual(["a"]);
  });

  it("선분 끝 너머는 끝점과의 거리로 본다", () => {
    expect(matchIncidents([incident("a", 33.5015, 126.5)], line)).toEqual(["a"]); // 끝점 북쪽 약 166m
    expect(matchIncidents([incident("b", 33.503, 126.5)], line)).toEqual([]); // 약 332m
  });
});

describe("중복 사건", () => {
  it("같은 종류·같은 좌표는 첫 항목만, 종류가 다르면 유지", () => {
    const kept = dedupeIncidents([
      incident("a", 33.4366, 126.4242),
      incident("b", 33.436600001, 126.4242),
      incident("c", 33.4366, 126.4242, "roadwork"),
    ]);
    expect(kept.map((i) => i.id)).toEqual(["a", "c"]);
  });
});

describe("오래된 정보 (10분)", () => {
  it("600초까지는 최신, 넘으면 오래됨", () => {
    const at = "2026-10-19T07:00:00.000Z";
    expect(isStale(at, new Date("2026-10-19T07:10:00.000Z"))).toBe(false);
    expect(isStale(at, new Date("2026-10-19T07:10:00.001Z"))).toBe(true);
  });
});
