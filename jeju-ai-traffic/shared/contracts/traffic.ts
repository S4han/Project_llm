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
 * links[i] = [link_id, 도로명, Google polyline(정밀도 1e5), 시작 지점 이름, 끝 지점 이름].
 * 지점 이름은 브이월드 교통노드에서 붙이며(TASK-015) 모르면 "". named가 false면 교통노드를 받지 못한 것.
 */
export interface TrafficLinksResponse {
  links: [string, string, string, string, string][];
  named: boolean;
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

/**
 * GET /api/traffic/enforcement 응답(TASK-016). 제주시 주정차 단속 CCTV(공공데이터포털 15109175, 제주시만).
 * cameras[i] = [데이터 코드, 설치 장소, 설치 주소, 회전형 CCTV 수, 검지 CCTV 수, 운영 시간(줄바꿈 포함), 위도, 경도]. 수를 모르면 null.
 */
export interface TrafficEnforcementResponse {
  cameras: [string, string, string, number | null, number | null, string, number, number][];
  builtAt: IsoDateTime;
  source: "dataGoKr" | "mock";
}

/**
 * GET /api/traffic/parking 응답(TASK-017). 전국주차장정보표준데이터(공공데이터포털 15012896) 중 제주시·서귀포시. 실시간 남은 칸은 없다.
 * lots[i] = [주차장 관리번호, 이름, 구분(공영·민영 등), 유형(노외·노상·부설 등), 주소, 주차구획수(모르면 null), 운영 시간 설명, 요금 설명, 위도, 경도].
 */
export interface TrafficParkingResponse {
  lots: [string, string, string, string, string, number | null, string, string, number, number][];
  builtAt: IsoDateTime;
  source: "dataGoKr" | "mock";
}

/** 오피넷 상표 코드(제주 ITS도 같은 코드: SKE·GSC·HDO·SOL·RTO·RTX·NHO·ETC, LPG 충전소 SKG·E1G). 그 밖의 코드도 올 수 있다. */
export type GasBrand = string;

/**
 * GET /api/traffic/gas 응답(TASK-018, 범위 변경으로 제주 ITS 주유소 기본정보·가격).
 * stations[i] = [주유소 ID(오피넷), 상표 코드, 이름, 휘발유·경유 원/L(없으면 null), 위도, 경도, LPG 원/L(없으면 null), 주소, 전화].
 */
export interface TrafficGasResponse {
  stations: [string, GasBrand, string, number | null, number | null, number, number, number | null, string, string][];
  builtAt: IsoDateTime;
  source: "jejuIts" | "mock";
}

/**
 * GET /api/traffic/ev 응답(TASK-019). 제주 ITS 전기차 충전소 기본정보(충전기 단위 → 충전소로 묶음) + 충전 가능 정보.
 * stations[i] = [충전소 ID, 이름, 주소, 위도, 경도, 급속 충전기 수, 완속 충전기 수, 급속 충전 가능 수, 완속 충전 가능 수(모르면 null), 이용 시간, 운영기관, 문의 전화, 주차 무료(Y/N/"")].
 */
export interface TrafficEvResponse {
  stations: [string, string, string, number, number, number, number, number | null, number | null, string, string, string, string][];
  /** 충전 가능 정보를 받은 시각(받지 못했으면 null). */
  statusAt: IsoDateTime | null;
  builtAt: IsoDateTime;
  source: "jejuIts" | "mock";
}

/**
 * GET /api/traffic/tour 응답(TASK-026, 한국관광공사 국문 관광정보 서비스 KorService2, 제주 관광지 contentTypeId 12).
 * spots[i] = [콘텐츠 ID, 이름, 주소, 위도, 경도, 대표 사진 https 주소(없으면 ""), 사진 저작권 구분(Type1 출처표시·Type3 출처표시+변경금지, 없으면 "")].
 */
export interface TrafficTourResponse {
  spots: [string, string, string, number, number, string, string][];
  builtAt: IsoDateTime;
  source: "kto" | "mock";
}

/** GET /api/traffic/tour?id= 응답(TASK-026): 관광지 하나의 소개정보. 원천 글자에서 HTML을 걷어 낸 값(없으면 ""). */
export interface TrafficTourDetailResponse {
  id: string;
  /** 이용시간(여러 줄일 수 있음) */
  usetime: string;
  /** 쉬는날 */
  restdate: string;
  /** 주차시설 원문(예: "가능", "불가능", "주차가능 (승용차 50대)") */
  parking: string;
  /** 문의 및 안내 */
  infocenter: string;
  builtAt: IsoDateTime;
  source: "kto" | "mock";
}

/** 숙소 종류(TASK-028, 비짓제주 태그로 나눔). */
export type StayKind = "HOTEL" | "PENSION" | "GUEST" | "MINBAK" | "ETC";

/**
 * GET /api/traffic/stay 응답(TASK-028, 비짓제주 관광정보 OPEN API 숙박 c3).
 * stays[i] = [콘텐츠 ID, 이름, 주소, 위도, 경도, 종류, 주차장 태그 있음, 전화, 사진 https 주소(없으면 ""), 간단 소개, 특징 태그(쉼표)].
 */
export interface TrafficStayResponse {
  stays: [string, string, string, number, number, StayKind, boolean, string, string, string, string][];
  builtAt: IsoDateTime;
  source: "visitJeju" | "mock";
}
