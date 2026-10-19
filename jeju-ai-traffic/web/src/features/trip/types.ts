import type { Place } from "../../../../shared/contracts/place";
import type { Coordinate } from "../../../../shared/contracts/route";

/** 출발지: 현재 위치 또는 검색으로 고른 장소. */
export type Origin =
  | { kind: "current"; location: Coordinate; accuracyMeters: number }
  | { kind: "place"; place: Place };

export function originLocation(origin: Origin): Coordinate {
  return origin.kind === "current" ? origin.location : origin.place.location;
}
