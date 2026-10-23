import type { TrafficIncident } from "../../../../shared/contracts/traffic";
import type { FacilityPoint, IncidentFocus, SpeedLine } from "../map/leafletMap";

/** 내 위치 기준으로 열 때의 확대 수준. 휴대폰 폭에서 주변 약 3km가 보인다(TASK-023 2.(a)). */
export const HOME_ZOOM = 14;

/** 제주도 전체가 보이는 범위. */
export const JEJU_BOUNDS: [[number, number], [number, number]] = [
  [33.11, 126.14],
  [33.57, 126.98],
];

export interface IncidentMapProps {
  incidents: TrafficIncident[];
  focus: IncidentFocus | null;
  /** 바뀌면 제주 전체 화면으로 다시 맞춘다(종류 필터 등). 1분 자동 갱신으로는 사용자가 옮긴 화면을 건드리지 않는다. */
  viewKey: string;
  /** 구간 속도 선(TASK-012). 비어 있으면 그리지 않는다. */
  speedLines?: SpeedLine[];
  speedObservedAt?: string | null;
  /** 도로 목록에서 고른 구간(TASK-012 소통대시보드). 있으면 굵게 강조하고 모두 보이게 확대한다. */
  highlightIds?: string[];
  /** 지도 높이(반응형 클래스). */
  heightClass?: string;
  /** 지도 가운데에 반투명으로 띄울 안내(예: "도로 소통 불러오는 중…"). */
  overlay?: string | null;
  /** 켜 둔 유형의 교통시설물(TASK-013). */
  facilities?: FacilityPoint[];
  /** 내 위치와 조회 반경(TASK-016 주정차 단속). 있으면 원과 내 위치 점을 그리고 원이 보이게 맞춘다. */
  nearby?: { lat: number; lng: number; radiusMeters: number; spot?: boolean } | null;
  /** 바뀌면 그 시설물로 옮기고 카드를 연다(주유소 목록, TASK-018). seq는 같은 곳을 다시 고를 때 구분용. */
  openFacility?: { id: string; seq: number } | null;
  /** 화면을 열 때 확인한 내 위치(TASK-023). 있으면 제주 전체 대신 내 위치 기준으로 열고 "제주 전체" 버튼을 보인다. */
  home?: { lat: number; lng: number } | null;
  /** 바뀌면 시설물(검색 결과)이 모두 보이게 맞춘다(관광 검색, TASK-029). */
  fitKey?: string | null;
  /** 지도 영역의 읽기 이름. */
  label?: string;
  /** 이 확대 수준 이상이면 화면 안 시설물(최대 250곳)에 이름을 붙인다(관광 검색 관광지 점, TASK-031). */
  labelZoom?: number | null;
}

export const NO_IDS: string[] = [];
export const NO_FACILITIES: FacilityPoint[] = [];
