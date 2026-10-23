import type { SpeedStatus } from "../../../../shared/contracts/traffic";
import type { FacilityKey } from "./facilityStyle";

/** 내 위치 주변 유형(대시보드 카드 → 전용 지도 페이지, TASK-025). */
export type NearbyView = Extract<FacilityKey, "ENF" | "PARK" | "GAS" | "LPG" | "EV" | "TOUR">;

/**
 * 교통 현황의 화면(TASK-025 2.(a)). home은 지도 없는 대시보드 카드(TASK-032부터 /traffic "교통 현황"), 나머지는 그 항목만 지도에 보이는 페이지.
 * incidents(돌발·통제·공사)와 facilities(CCTV 등 제주 ITS 시설물)는 3.(a)의 작은 카드.
 * start는 단순한 첫 화면(/), nearby는 내 주변 고르기(/nearby, TASK-032 1.(a)·2.(a)).
 */
export type TrafficView = "start" | "nearby" | "home" | SpeedStatus | NearbyView | "incidents" | "facilities";
/** 지도 페이지(첫 화면·고르기·교통 현황 카드가 아닌 화면). */
export type MapView = Exclude<TrafficView, "start" | "nearby" | "home">;

export const PAGE_PATH: Record<"start" | "nearby" | "home", string> = { start: "/", nearby: "/nearby", home: "/traffic" };

export const VIEW_PATH: Record<MapView, string> = {
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

export const VIEW_TITLE: Record<MapView, string> = {
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

/** 관광지 페이지에서 그 관광지 기준으로 보는 것: 주변 주차장(TASK-027) 또는 주변 숙소(TASK-028). */
export type Around = { kind: "parking" | "stay"; id: string };

/** 화면 주소. 관광지 주변 주차장·숙소를 보는 중이면 ?parking= 또는 ?stay=관광지 번호(공유·새로고침). */
export const pathOf = (view: TrafficView, around: Around | null = null): string =>
  view === "start" || view === "nearby" || view === "home" ? PAGE_PATH[view] : view === "TOUR" && around ? `${VIEW_PATH.TOUR}?${around.kind}=${encodeURIComponent(around.id)}` : VIEW_PATH[view];

/** 주소의 ?parking= 또는 ?stay= 값(관광지 번호). 관광지 페이지에서만, 형식이 맞을 때만. */
export function aroundFromLocation(pathname: string, search: string): Around | null {
  if (viewFromPath(pathname) !== "TOUR") return null;
  const q = new URLSearchParams(search);
  for (const kind of ["parking", "stay"] as const) {
    const id = q.get(kind);
    if (id && /^[A-Za-z0-9-]{1,20}$/.test(id)) return { kind, id };
  }
  return null;
}

/** 주소 → 화면. "/traffic"은 교통 현황 카드, "/nearby"는 내 주변 고르기, "/"와 모르는 주소는 첫 화면(TASK-032). */
export function viewFromPath(pathname: string): TrafficView {
  const path = pathname.replace(/\/+$/, "") || "/";
  const page = (Object.entries(PAGE_PATH) as ["start" | "nearby" | "home", string][]).find(([, p]) => p === path);
  if (page) return page[0];
  const hit = (Object.entries(VIEW_PATH) as [MapView, string][]).find(([, p]) => p === path);
  return hit ? hit[0] : "start";
}

export const isSpeedView = (v: TrafficView): v is SpeedStatus => v === "smooth" || v === "slow" || v === "congested";
export const isNearbyView = (v: TrafficView): v is NearbyView => v === "ENF" || v === "PARK" || v === "GAS" || v === "LPG" || v === "EV" || v === "TOUR";
