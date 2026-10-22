import type { SpeedStatus } from "../../../../shared/contracts/traffic";
import type { FacilityKey } from "./facilityStyle";

/** 내 위치 주변 유형(대시보드 카드 → 전용 지도 페이지, TASK-025). */
export type NearbyView = Extract<FacilityKey, "ENF" | "PARK" | "GAS" | "LPG" | "EV" | "TOUR">;

/**
 * 교통 현황의 화면(TASK-025 2.(a)). home은 지도 없는 대시보드 카드, 나머지는 그 항목만 지도에 보이는 페이지.
 * incidents(돌발·통제·공사)와 facilities(CCTV 등 제주 ITS 시설물)는 3.(a)의 작은 카드.
 */
export type TrafficView = "home" | SpeedStatus | NearbyView | "incidents" | "facilities";

export const VIEW_PATH: Record<Exclude<TrafficView, "home">, string> = {
  smooth: "/map/smooth",
  slow: "/map/slow",
  congested: "/map/congested",
  ENF: "/map/enforcement",
  PARK: "/map/parking",
  GAS: "/map/gas",
  LPG: "/map/lpg",
  EV: "/map/ev",
  TOUR: "/map/tour",
  incidents: "/map/incidents",
  facilities: "/map/facilities",
};

export const VIEW_TITLE: Record<Exclude<TrafficView, "home">, string> = {
  smooth: "도로 소통 · 원활",
  slow: "도로 소통 · 서행",
  congested: "도로 소통 · 정체",
  ENF: "주정차 단속 CCTV",
  PARK: "주차장",
  GAS: "주유소",
  LPG: "LPG 충전소",
  EV: "전기차 충전소",
  TOUR: "관광지",
  incidents: "돌발·통제·공사",
  facilities: "CCTV 등 교통시설물",
};

/** 화면 주소. 관광지 페이지에서 그 관광지 주변 주차장을 보는 중이면 ?parking=관광지 번호(TASK-027 3.(a), 공유·새로고침). */
export const pathOf = (view: TrafficView, parkingOf: string | null = null): string =>
  view === "home" ? "/" : view === "TOUR" && parkingOf ? `${VIEW_PATH.TOUR}?parking=${encodeURIComponent(parkingOf)}` : VIEW_PATH[view];

/** 주소의 ?parking= 값(관광지 번호). 관광지 페이지에서만, 형식이 맞을 때만. */
export function parkingOfFromLocation(pathname: string, search: string): string | null {
  if (viewFromPath(pathname) !== "TOUR") return null;
  const id = new URLSearchParams(search).get("parking");
  return id && /^[A-Za-z0-9-]{1,20}$/.test(id) ? id : null;
}

/** 주소 → 화면. "/"·"/traffic"(예전 공유 주소)과 모르는 주소는 대시보드. */
export function viewFromPath(pathname: string): TrafficView {
  const path = pathname.replace(/\/+$/, "") || "/";
  const hit = (Object.entries(VIEW_PATH) as [Exclude<TrafficView, "home">, string][]).find(([, p]) => p === path);
  return hit ? hit[0] : "home";
}

export const isSpeedView = (v: TrafficView): v is SpeedStatus => v === "smooth" || v === "slow" || v === "congested";
export const isNearbyView = (v: TrafficView): v is NearbyView => v === "ENF" || v === "PARK" || v === "GAS" || v === "LPG" || v === "EV" || v === "TOUR";
