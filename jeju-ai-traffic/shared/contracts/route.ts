import type { Freshness, IsoDateTime } from "./common.js";
import type { TrafficStatus } from "./traffic.js";

export interface Coordinate {
  lat: number;
  lng: number;
}

/** 경로를 얻은 호출 방식. 경로 ID와 이름의 기준이다. */
export type RouteQueryKind = "recommend" | "distance" | "via1100" | "via516";

/** 공급자 응답을 정규화한 경로 하나. 시간은 초 단위, 공급자 값을 변경하지 않는다. */
export interface RouteOption {
  id: string;
  /** mock이면 화면에 모의 데이터임을 표시한다. */
  provider: "kakao" | "mock";
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
  /** 추천 경로 ID(최단 예상시간, 동률이면 거리 → 호출 순서). 경로가 없으면 null. */
  recommendedRouteId: string | null;
  /** 추천 경로와 예상시간(초)이 같은 경로 ID들(추천 포함). 동률이 없으면 빈 배열. */
  tiedRouteIds: string[];
}
