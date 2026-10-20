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

/** 구간 속도 상태(TASK-012). 기준: 원활 30km/h 이상, 서행 15~30, 정체 15 미만(DECISIONS 2026-10-20 "3. (a)"). */
export type SpeedStatus = "smooth" | "slow" | "congested";

/**
 * GET /api/traffic/speeds 응답. 제주 ITS 실시간 교통정보(구간별 평균속도·통행시간, 약 5분 단위 갱신).
 * speeds[link_id] = [평균속도 km/h, 통행시간 초].
 */
export interface TrafficSpeedsResponse {
  status: IncidentsStatus;
  /** 원천 가공 시각(prcn_dt, KST를 ISO로). 조회하지 못했으면 null. */
  observedAt: IsoDateTime | null;
  speeds: Record<string, [number, number]>;
  source: "jejuIts" | "mock";
  retryAfter: IsoDateTime | null;
}

/**
 * GET /api/traffic/links 응답. 브이월드 국가 교통링크 중 제주 ITS 속도가 있는 구간의 모양.
 * links[i] = [link_id, 도로명, Google polyline(정밀도 1e5)].
 */
export interface TrafficLinksResponse {
  links: [string, string, string][];
  builtAt: IsoDateTime;
  source: "vworld" | "mock";
}

/** 제주 ITS 교통시설물 유형(getFacilityInfo fcltType, TASK-013). */
export type FacilityType = "FTY01" | "FTY02" | "FTY03" | "FTY07" | "FTY09" | "FTY17" | "FTY23";

/**
 * GET /api/traffic/facilities 응답(TASK-013). facilities[i] = [시설물 ID, 유형, 설치 위치, 모델명(없으면 ""), 위도, 경도].
 * failedTypes는 이번에 받지 못한 유형(있으면 짧게만 보관).
 */
export interface TrafficFacilitiesResponse {
  facilities: [string, FacilityType, string, string, number, number][];
  failedTypes: FacilityType[];
  builtAt: IsoDateTime;
  source: "jejuIts" | "mock";
}
