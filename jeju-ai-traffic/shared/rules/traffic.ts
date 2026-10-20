import type { Coordinate } from "../contracts/route.js";
import type { SpeedStatus, TrafficIncident, TrafficSegment, TrafficStatus } from "../contracts/traffic.js";

/** 사건-경로 매칭 거리(m). DECISIONS 2026-10-19 TASK-006 "2. 승인". */
export const INCIDENT_MATCH_METERS = 200;

/** 경로·혼잡 정보가 '오래된 정보'가 되는 시간(초). DECISIONS 2026-10-19 TASK-006 "3. 승인". */
export const STALE_AFTER_SECONDS = 600;

/** 카카오 traffic_state → 혼잡 상태. 4 원활, 2·3 지체·서행, 1 정체, 6 사고(통행 불가), 0·그 외 정보 없음(문서 기준). */
export function kakaoTrafficStatus(code: unknown): TrafficStatus {
  if (code === 4) return "smooth";
  if (code === 2 || code === 3) return "slow";
  if (code === 1 || code === 6) return "congested";
  return "unknown";
}

const STATUSES: TrafficStatus[] = ["smooth", "slow", "congested", "unknown"];

/** 거리 기준 혼잡 비율(0~1). 구간이 없으면 unknown 1. */
export function trafficShares(segments: TrafficSegment[]): Record<TrafficStatus, number> {
  const total = segments.reduce((sum, s) => sum + s.distanceMeters, 0);
  const shares = { smooth: 0, slow: 0, congested: 0, unknown: 0 };
  if (total <= 0) return { ...shares, unknown: 1 };
  for (const s of segments) shares[s.status] += s.distanceMeters / total;
  return shares;
}

/** 거리 기준으로 가장 많은 상태. 같으면 unknown 쪽을 고른다(정보 미확보를 정상으로 보이지 않게). */
export function dominantStatus(segments: TrafficSegment[]): TrafficStatus {
  const shares = trafficShares(segments);
  let best: TrafficStatus = "unknown";
  for (const status of STATUSES) {
    if (shares[status] > shares[best]) best = status;
  }
  return best;
}

/** 점과 선분 사이 거리(m). 제주 규모라 평면 근사. */
function pointToSegmentMeters(p: Coordinate, a: Coordinate, b: Coordinate): number {
  const kx = 111_320 * Math.cos((p.lat * Math.PI) / 180);
  const ky = 110_540;
  const [px, py, ax, ay, bx, by] = [p.lng * kx, p.lat * ky, a.lng * kx, a.lat * ky, b.lng * kx, b.lat * ky];
  const dx = bx - ax;
  const dy = by - ay;
  const l2 = dx * dx + dy * dy;
  const t = l2 ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / l2)) : 0;
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

/** 점과 좌표선 사이 최소 거리(m). 좌표가 하나면 그 점과의 거리. */
export function distanceToPolylineMeters(p: Coordinate, line: Coordinate[]): number {
  if (line.length === 0) return Number.POSITIVE_INFINITY;
  if (line.length === 1) return pointToSegmentMeters(p, line[0]!, line[0]!);
  let min = Number.POSITIVE_INFINITY;
  for (let i = 1; i < line.length; i++) {
    min = Math.min(min, pointToSegmentMeters(p, line[i - 1]!, line[i]!));
  }
  return min;
}

/** 경로 좌표선에서 200m 이내인 사건 ID. */
export function matchIncidents(incidents: TrafficIncident[], geometry: Coordinate[]): string[] {
  return incidents
    .filter((i) => distanceToPolylineMeters(i.location, geometry) <= INCIDENT_MATCH_METERS)
    .map((i) => i.id);
}

/** 같은 종류·같은 좌표(소수 5자리, 약 1m)의 중복 사건은 첫 항목만 남긴다. */
export function dedupeIncidents(incidents: TrafficIncident[]): TrafficIncident[] {
  const seen = new Set<string>();
  return incidents.filter((i) => {
    const key = `${i.kind}:${i.location.lat.toFixed(5)}:${i.location.lng.toFixed(5)}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/** 조회 후 10분이 지났는지. */
export function isStale(observedAt: string, now: Date): boolean {
  return now.getTime() - Date.parse(observedAt) > STALE_AFTER_SECONDS * 1000;
}

/** 구간 속도 색 기준(km/h). DECISIONS 2026-10-20 TASK-012 "3. (a)". */
export const SMOOTH_MIN_KMH = 30;
export const SLOW_MIN_KMH = 15;

/** 평균속도 → 원활(30 이상)·서행(15~30)·정체(15 미만). */
export function speedStatus(kmh: number): SpeedStatus {
  if (kmh >= SMOOTH_MIN_KMH) return "smooth";
  if (kmh >= SLOW_MIN_KMH) return "slow";
  return "congested";
}
