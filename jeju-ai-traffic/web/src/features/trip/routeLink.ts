import type { Place } from "../../../../shared/contracts/place";
import { PLACE_QUERY_MAX_LENGTH } from "../../../../shared/contracts/place";
import { isInJeju } from "../../../../shared/rules/geo";

/**
 * 교통 현황의 주차장 → 경로 추천으로 넘기는 주소(TASK-017). 목적지(주차장, 공개 자료)만 담고 내 위치는 담지 않는다.
 * 경로 추천 화면이 현재 위치를 다시 확인해 출발지로 쓴다.
 */
export function parkingRouteHref(lot: { id: string; name: string; address: string; lat: number; lng: number }): string {
  const q = new URLSearchParams({ to: lot.name, addr: lot.address, lat: lot.lat.toFixed(6), lng: lot.lng.toFixed(6), id: lot.id });
  return `/route?${q}`;
}

/** 주소의 목적지 → 장소. 이름이 없거나 길거나, 좌표가 제주 밖이면 null(일반 경로 추천 화면). */
export function readRouteTarget(search: string): Place | null {
  const q = new URLSearchParams(search);
  const name = (q.get("to") ?? "").trim();
  const location = { lat: Number(q.get("lat")), lng: Number(q.get("lng")) };
  if (!name || name.length > PLACE_QUERY_MAX_LENGTH || !q.get("lat") || !q.get("lng") || !isInJeju(location)) return null;
  const address = (q.get("addr") ?? "").trim().slice(0, 100);
  return { id: `parking-${(q.get("id") ?? "").slice(0, 40)}`, name, address: address || "주차장", roadAddress: null, location, provider: "parking" };
}
