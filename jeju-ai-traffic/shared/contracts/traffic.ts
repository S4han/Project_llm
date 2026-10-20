import type { Coordinate } from "./route.js";
import type { IsoDateTime } from "./common.js";

/** 구간 혼잡 상태. 공급자가 값을 주지 않으면 unknown이며, unknown은 정상 소통이 아니다. */
export type TrafficStatus = "smooth" | "slow" | "congested" | "unknown";

/** 경로 좌표열의 한 구간(geometry[startIndex..endIndex])과 혼잡 상태. */
export interface TrafficSegment {
  startIndex: number;
  endIndex: number;
  status: TrafficStatus;
  distanceMeters: number;
}

/** 제주 ITS 확인 사건 종류: 돌발, 통제, 공사, 교통기상. */
export type IncidentKind = "event" | "closure" | "roadwork" | "weather";

export interface TrafficIncident {
  id: string;
  kind: IncidentKind;
  description: string;
  location: Coordinate;
  /** 우리 서버가 원천을 조회한 시각. */
  observedAt: IsoDateTime;
  /** 원천 데이터에 적힌 시각(발생·갱신). 원천에 없으면 null. */
  sourceTime: IsoDateTime | null;
  source: "jejuIts" | "mock";
}

/** 교통 사건 조회 상태. ok가 아니면 화면에 '교통 사건 정보 미확보(사유)'로 표시한다. */
export type IncidentsStatus = "ok" | "unavailable" | "quotaBlocked";

/** GET /api/traffic/incidents 응답(TASK-012 대시보드). 제주 전체 사건이며 경로와 연결하지 않는다. */
export interface TrafficIncidentsResponse {
  incidents: TrafficIncident[];
  status: IncidentsStatus;
  /** 원천을 조회한 시각(캐시 포함). 조회하지 못했으면 null. */
  observedAt: IsoDateTime | null;
  /** status가 quotaBlocked일 때 다시 쓸 수 있는 시각. */
  retryAfter: IsoDateTime | null;
}
