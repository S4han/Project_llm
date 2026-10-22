import type { ApiError, ApiErrorBody } from "../../../shared/contracts/common";
import type { TrafficEnforcementResponse, TrafficEvResponse, TrafficFacilitiesResponse, TrafficGasResponse, TrafficParkingResponse, TrafficIncidentsResponse, TrafficLinksResponse, TrafficSpeedsResponse, TrafficStayResponse, TrafficTourDetailResponse, TrafficTourResponse } from "../../../shared/contracts/traffic";
import type { SearchDetailResponse, SearchIndexResponse, SearchLiveResponse } from "../../../shared/contracts/search";

export type TrafficIncidentsResult = { ok: true; data: TrafficIncidentsResponse } | { ok: false; error: ApiError };

const NETWORK_ERROR: ApiError = {
  code: "PROVIDER_UNAVAILABLE",
  message: "네트워크 연결을 확인한 뒤 다시 시도하세요.",
};

/** GET /api/traffic/incidents(TASK-012). 네트워크 오류도 ApiError 형식으로 돌려준다. */
export async function fetchTrafficIncidents(signal?: AbortSignal): Promise<TrafficIncidentsResult> {
  let res: Response;
  try {
    res = await fetch("/api/traffic/incidents", { signal });
  } catch {
    return { ok: false, error: NETWORK_ERROR };
  }
  const body = (await res.json().catch(() => null)) as TrafficIncidentsResponse | ApiErrorBody | null;
  if (res.ok && body && "incidents" in body) return { ok: true, data: body };
  if (body && "error" in body) return { ok: false, error: body.error };
  return { ok: false, error: NETWORK_ERROR };
}

type Result<T> = { ok: true; data: T } | { ok: false; error: ApiError };

async function getJson<T>(url: string, isBody: (b: object) => boolean, signal?: AbortSignal): Promise<Result<T>> {
  let res: Response;
  try {
    res = await fetch(url, { signal });
  } catch {
    return { ok: false, error: NETWORK_ERROR };
  }
  const body = (await res.json().catch(() => null)) as (T & object) | ApiErrorBody | null;
  if (res.ok && body && isBody(body)) return { ok: true, data: body as T };
  if (body && "error" in body) return { ok: false, error: body.error };
  return { ok: false, error: NETWORK_ERROR };
}

/** GET /api/traffic/speeds(TASK-012): 구간별 평균속도. */
export function fetchTrafficSpeeds(signal?: AbortSignal): Promise<Result<TrafficSpeedsResponse>> {
  return getJson<TrafficSpeedsResponse>("/api/traffic/speeds", (b) => "speeds" in b, signal);
}

/** GET /api/traffic/links(TASK-012): 구간 모양·지점 이름(CDN 30일 보관). 화면을 열 때 한 번만 부른다. v=2는 지점 이름이 붙은 응답(TASK-015)으로, 이전 CDN 보관본을 피한다. */
export function fetchTrafficLinks(signal?: AbortSignal): Promise<Result<TrafficLinksResponse>> {
  return getJson<TrafficLinksResponse>("/api/traffic/links?v=2", (b) => "links" in b, signal);
}

/** GET /api/traffic/facilities(TASK-013): 교통시설물 위치(서버 하루·CDN 7일 보관). 화면을 열 때 한 번만 부른다. */
export function fetchTrafficFacilities(signal?: AbortSignal): Promise<Result<TrafficFacilitiesResponse>> {
  return getJson<TrafficFacilitiesResponse>("/api/traffic/facilities", (b) => "facilities" in b, signal);
}

/** GET /api/traffic/enforcement(TASK-016): 제주시 주정차 단속 CCTV 위치(서버 하루·CDN 7일 보관). 화면을 열 때 한 번만 부른다. */
export function fetchTrafficEnforcement(signal?: AbortSignal): Promise<Result<TrafficEnforcementResponse>> {
  return getJson<TrafficEnforcementResponse>("/api/traffic/enforcement", (b) => "cameras" in b, signal);
}

/** GET /api/traffic/parking(TASK-017): 제주시·서귀포시 주차장 위치·요금·면수(서버 하루·CDN 7일 보관). 화면을 열 때 한 번만 부른다. */
export function fetchTrafficParking(signal?: AbortSignal): Promise<Result<TrafficParkingResponse>> {
  return getJson<TrafficParkingResponse>("/api/traffic/parking", (b) => "lots" in b, signal);
}

/** GET /api/traffic/gas(TASK-018): 제주 주유소·휘발유·경유 가격(서버·CDN 6시간 보관). 화면을 열 때 한 번만 부른다. */
export function fetchTrafficGas(signal?: AbortSignal): Promise<Result<TrafficGasResponse>> {
  return getJson<TrafficGasResponse>("/api/traffic/gas?v=2", (b) => "stations" in b, signal);
}

/** GET /api/traffic/ev(TASK-019): 제주 전기차 충전소·충전 가능 수(충전 가능 30분 보관). 화면을 열 때와 30분마다 부른다. */
export function fetchTrafficEv(signal?: AbortSignal): Promise<Result<TrafficEvResponse>> {
  return getJson<TrafficEvResponse>("/api/traffic/ev", (b) => "stations" in b, signal);
}

/** GET /api/traffic/tour(TASK-026): 제주 관광지 목록(서버 하루·CDN 7일 보관). 화면을 열 때 한 번만 부른다. */
export function fetchTrafficTour(signal?: AbortSignal): Promise<Result<TrafficTourResponse>> {
  return getJson<TrafficTourResponse>("/api/traffic/tour", (b) => "spots" in b, signal);
}

/** GET /api/traffic/stay(TASK-028): 제주 숙소(비짓제주, 서버 하루·CDN 7일 보관). 화면을 열 때 한 번만 부른다. */
export function fetchTrafficStay(signal?: AbortSignal): Promise<Result<TrafficStayResponse>> {
  return getJson<TrafficStayResponse>("/api/traffic/stay", (b) => "stays" in b, signal);
}

const tourDetails = new Map<string, Promise<Result<TrafficTourDetailResponse>>>();
/** GET /api/traffic/tour?id=(TASK-026): 관광지 하나의 이용시간·쉬는날·주차. 관광지를 누를 때만, 이 화면에서는 한 번만(실패는 다시 받음). */
export function fetchTrafficTourDetail(id: string): Promise<Result<TrafficTourDetailResponse>> {
  const hit = tourDetails.get(id);
  if (hit) return hit;
  const p = getJson<TrafficTourDetailResponse>(`/api/traffic/tour?id=${encodeURIComponent(id)}`, (b) => "usetime" in b).then((r) => {
    if (!r.ok) tourDetails.delete(id);
    return r;
  });
  tourDetails.set(id, p);
  return p;
}

/** GET /api/traffic/search(TASK-029): 관광 통합 검색 목록(비짓제주·관광공사, 서버 하루·CDN 7일). 검색 페이지를 열 때 한 번. */
export function fetchSearchIndex(signal?: AbortSignal): Promise<Result<SearchIndexResponse>> {
  return getJson<SearchIndexResponse>("/api/traffic/search", (b) => "places" in b && "missing" in b, signal);
}

/**
 * GET /api/traffic/search?q=&cat=&lat=&lng=(TASK-029): 카카오 로컬 실시간 음식점·카페. 결과는 화면에만 쓰고 저장하지 않는다.
 * 기준 위치는 소수 셋째 자리(약 100m)로 줄여 보낸다.
 */
export function fetchSearchLive(input: { q: string; cat: string; origin: { lat: number; lng: number } | null }, signal?: AbortSignal): Promise<Result<SearchLiveResponse>> {
  const p = new URLSearchParams({ cat: input.cat });
  if (input.q) p.set("q", input.q);
  if (input.origin) {
    p.set("lat", input.origin.lat.toFixed(3));
    p.set("lng", input.origin.lng.toFixed(3));
  }
  return getJson<SearchLiveResponse>(`/api/traffic/search?${p}`, (b) => "places" in b && "observedAt" in b, signal);
}

const searchDetails = new Map<string, Promise<Result<SearchDetailResponse>>>();
/** GET /api/traffic/search?kto=&cat=(TASK-029 범위 변경): 관광공사 소개정보(운영시간·주차·반려동물). 카드를 열 때만, 이 화면에서는 한 번만(실패는 다시 받음). */
export function fetchSearchDetail(id: string, cat: string): Promise<Result<SearchDetailResponse>> {
  const key = `${cat === "CAFE" ? "RESTAURANT" : cat}:${id}`;
  const hit = searchDetails.get(key);
  if (hit) return hit;
  const p = getJson<SearchDetailResponse>(`/api/traffic/search?kto=${encodeURIComponent(id)}&cat=${encodeURIComponent(cat)}`, (b) => "hours" in b && "parking" in b).then((r) => {
    if (!r.ok) searchDetails.delete(key);
    return r;
  });
  searchDetails.set(key, p);
  return p;
}
