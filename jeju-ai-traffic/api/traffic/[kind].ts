import { AppError, toErrorResponse } from "../_lib/errors.js";
import { defaultTrafficIncidentsDeps, handleTrafficIncidents } from "../_lib/incidents.js";
import { defaultTrafficEnforcementDeps, handleTrafficEnforcement } from "../_lib/trafficEnforcement.js";
import { defaultTrafficEvDeps, handleTrafficEv } from "../_lib/trafficEv.js";
import { defaultTrafficFacilitiesDeps, handleTrafficFacilities } from "../_lib/trafficFacilities.js";
import { defaultTrafficGasDeps, handleTrafficGas } from "../_lib/trafficGas.js";
import { defaultTrafficLinksDeps, defaultTrafficSpeedsDeps, handleTrafficLinks, handleTrafficSpeeds } from "../_lib/trafficLayers.js";
import { defaultTrafficParkingDeps, handleTrafficParking } from "../_lib/trafficParking.js";
import { defaultTrafficSearchDeps, handleTrafficSearch } from "../_lib/trafficSearch.js";
import { defaultTrafficStayDeps, handleTrafficStay } from "../_lib/trafficStay.js";
import { defaultTrafficTourDeps, handleTrafficTour } from "../_lib/trafficTour.js";

/**
 * Vercel Function: GET /api/traffic/{kind}. 교통 정보 엔드포인트를 함수 하나로 묶는다(TASK-026 범위 변경 "함수 통합 (a)":
 * Hobby 요금제는 배포당 함수 12개까지). 주소·응답·보관 방식은 예전 파일별 함수와 같다.
 * - incidents: 제주 전체 돌발·통제·공사(TASK-012)
 * - speeds: 제주 ITS 구간별 평균속도(TASK-012) / links: 브이월드 교통링크 모양(CDN 30일, TASK-012·015)
 * - facilities: 제주 ITS 교통시설물 7개 유형(TASK-013) / enforcement: 제주시 주정차 단속 CCTV(TASK-016)
 * - parking: 전국주차장정보표준데이터(TASK-017) / gas: 제주 ITS 주유소·가격(TASK-018) / ev: 전기차 충전소(TASK-019)
 * - tour: 한국관광공사 제주 관광지 목록, ?id=면 그 관광지 이용시간·쉬는날·주차(TASK-026)
 * - stay: 비짓제주 제주 숙소(TASK-028)
 * - search: 관광 통합 검색 목록(비짓제주·관광공사), ?q=·?lat=&lng=면 카카오 로컬 실시간 음식점·카페(TASK-029)
 */
const HANDLERS: Record<string, (request: Request) => Promise<Response>> = {
  incidents: (r) => handleTrafficIncidents(r, defaultTrafficIncidentsDeps),
  speeds: (r) => handleTrafficSpeeds(r, defaultTrafficSpeedsDeps),
  links: (r) => handleTrafficLinks(r, defaultTrafficLinksDeps),
  facilities: (r) => handleTrafficFacilities(r, defaultTrafficFacilitiesDeps),
  enforcement: (r) => handleTrafficEnforcement(r, defaultTrafficEnforcementDeps),
  parking: (r) => handleTrafficParking(r, defaultTrafficParkingDeps),
  gas: (r) => handleTrafficGas(r, defaultTrafficGasDeps),
  ev: (r) => handleTrafficEv(r, defaultTrafficEvDeps),
  tour: (r) => handleTrafficTour(r, defaultTrafficTourDeps),
  stay: (r) => handleTrafficStay(r, defaultTrafficStayDeps),
  search: (r) => handleTrafficSearch(r, defaultTrafficSearchDeps),
};

/** 주소의 마지막 경로("/api/traffic/gas" → "gas"). */
export function trafficKind(url: string): string {
  return new URL(url).pathname.replace(/\/+$/, "").split("/").at(-1) ?? "";
}

export function GET(request: Request): Promise<Response> {
  const kind = trafficKind(request.url);
  const handler = Object.hasOwn(HANDLERS, kind) ? HANDLERS[kind] : undefined;
  return handler ? handler(request) : Promise.resolve(toErrorResponse(new AppError("INVALID_INPUT", "알 수 없는 교통 정보 종류입니다.")));
}
