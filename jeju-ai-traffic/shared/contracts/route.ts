import type { Freshness, IsoDateTime } from "./common.js";
import type { IncidentsStatus, TrafficIncident, TrafficSegment, TrafficStatus } from "./traffic.js";

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
  /** 거리 기준으로 가장 많은 구간의 혼잡 상태. */
  trafficStatus: TrafficStatus;
  /** 구간별 혼잡(카카오 traffic_state). */
  segments: TrafficSegment[];
  /** 이 경로 200m 이내로 확인된 사건 ID(응답의 incidents 참조). */
  incidentIds: string[];
}

export interface RouteCompareRequest {
  origin: Coordinate;
  destination: Coordinate;
  /** reevaluation이면 서버가 재평가 사용량 기준(카카오 6,000건)을 적용한다. 기본 user. */
  purpose?: "user" | "reevaluation";
}

export interface RouteCompareResponse extends Freshness {
  routes: RouteOption[];
  /** 추천 경로 ID(최단 예상시간, 동률이면 거리 → 호출 순서). 경로가 없으면 null. */
  recommendedRouteId: string | null;
  /** 추천 경로와 예상시간(초)이 같은 경로 ID들(추천 포함). 동률이 없으면 빈 배열. */
  tiedRouteIds: string[];
  /** 어느 경로에든 연결된 확인 사건. */
  incidents: TrafficIncident[];
  incidentsStatus: IncidentsStatus;
  /** 교통 사건을 조회한 시각. 조회하지 못했으면 null. */
  incidentsObservedAt: IsoDateTime | null;
}
