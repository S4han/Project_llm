import type { Freshness, IsoDateTime } from "./common.js";
import type { TrafficStatus } from "./traffic.js";

export interface Coordinate {
  lat: number;
  lng: number;
}

/** 공급자 응답을 정규화한 경로 하나. 시간은 초 단위, 공급자 값을 변경하지 않는다. */
export interface RouteOption {
  id: string;
  provider: "kakao";
  /** 사용자에게 보여 줄 경로 이름(예: 평화로 경유). */
  label: string;
  durationSeconds: number;
  distanceMeters: number;
  geometry: Coordinate[];
  observedAt: IsoDateTime;
  trafficStatus: TrafficStatus;
}

export interface RouteCompareRequest {
  origin: Coordinate;
  destination: Coordinate;
}

export interface RouteCompareResponse extends Freshness {
  routes: RouteOption[];
  /** 추천 경로 ID. 경로가 없으면 null. 선택·동률 규칙은 TASK-005. */
  recommendedRouteId: string | null;
}
