import type { Coordinate } from "../contracts/route.js";

/** 제주 범위(추자도·마라도 포함). DECISIONS 2026-10-19 TASK-004 "3. 승인". */
export const JEJU_BOUNDS = { minLat: 33.0, maxLat: 34.0, minLng: 126.0, maxLng: 127.0 } as const;

/** GPS 정확도가 이 값(m)보다 크면 재확인을 안내한다. */
export const MAX_GPS_ACCURACY_METERS = 200;

/** 출발지·목적지가 이 거리(m) 이내면 같은 곳으로 보고 조회를 막는다. */
export const SAME_PLACE_METERS = 30;

export function isValidCoordinate(c: Coordinate): boolean {
  return (
    Number.isFinite(c.lat) && Number.isFinite(c.lng) && Math.abs(c.lat) <= 90 && Math.abs(c.lng) <= 180
  );
}

export function isInJeju(c: Coordinate): boolean {
  return (
    isValidCoordinate(c) &&
    c.lat >= JEJU_BOUNDS.minLat &&
    c.lat <= JEJU_BOUNDS.maxLat &&
    c.lng >= JEJU_BOUNDS.minLng &&
    c.lng <= JEJU_BOUNDS.maxLng
  );
}

export function isJejuAddress(address: string): boolean {
  return address.trim().startsWith("제주특별자치도");
}

/** 두 좌표 사이 거리(m, 하버사인). */
export function distanceMeters(a: Coordinate, b: Coordinate): number {
  const R = 6_371_000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

export type TripProblem =
  | "originMissing"
  | "destinationMissing"
  | "originInvalid"
  | "destinationInvalid"
  | "samePlace";

/** 경로 조회 전 출발지·목적지 검사(AC-001-04, AC-002-04). 문제가 없으면 null. */
export function checkTrip(origin: Coordinate | null, destination: Coordinate | null): TripProblem | null {
  if (!origin) return "originMissing";
  if (!isInJeju(origin)) return "originInvalid";
  if (!destination) return "destinationMissing";
  if (!isInJeju(destination)) return "destinationInvalid";
  if (distanceMeters(origin, destination) <= SAME_PLACE_METERS) return "samePlace";
  return null;
}
