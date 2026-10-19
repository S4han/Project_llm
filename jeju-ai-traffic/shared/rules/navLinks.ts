import type { Place } from "../contracts/place.js";
import { isInJeju } from "./geo.js";

/** 외부 내비에 넘기는 목적지. 이름·좌표만(DECISIONS 2026-10-19 TASK-008 "2. 승인"). */
export interface NavDestination {
  name: string;
  lat: number;
  lng: number;
  /** 복사용 주소(도로명 우선). */
  address: string;
}

export function toNavDestination(place: Place): NavDestination | null {
  if (!isInJeju(place.location)) return null;
  return {
    name: place.name.trim() || "목적지",
    lat: place.location.lat,
    lng: place.location.lng,
    address: place.roadAddress ?? place.address,
  };
}

const fixed = (n: number) => n.toFixed(6);

/**
 * 카카오맵 길찾기 웹 링크(공식 지도 URL): https://map.kakao.com/link/to/이름,위도,경도
 * 이름 속 쉼표는 구분자와 섞이지 않도록 공백으로 바꾼다.
 */
export function kakaoMapRouteUrl(d: NavDestination): string {
  const name = encodeURIComponent(d.name.replace(/,/g, " "));
  return `https://map.kakao.com/link/to/${name},${fixed(d.lat)},${fixed(d.lng)}`;
}

/** 네이버지도 앱 자동차 길찾기: nmap://route/car?dlat=&dlng=&dname=&appname= (appname 필수). */
export function naverMapRouteUrl(d: NavDestination, appname: string): string {
  const q = new URLSearchParams({ dlat: fixed(d.lat), dlng: fixed(d.lng), dname: d.name, appname });
  return `nmap://route/car?${q.toString()}`;
}

/** 복사용 목적지 문구. */
export function destinationText(d: NavDestination): string {
  return `${d.name}\n${d.address}`;
}
