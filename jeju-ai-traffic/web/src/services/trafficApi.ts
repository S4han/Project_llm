import type { ApiError, ApiErrorBody } from "../../../shared/contracts/common";
import type { TrafficEnforcementResponse, TrafficFacilitiesResponse, TrafficGasResponse, TrafficParkingResponse, TrafficIncidentsResponse, TrafficLinksResponse, TrafficSpeedsResponse } from "../../../shared/contracts/traffic";

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
  return getJson<TrafficGasResponse>("/api/traffic/gas", (b) => "stations" in b, signal);
}
