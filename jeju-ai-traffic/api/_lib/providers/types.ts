import type { Explanation } from "../../../shared/contracts/explanation.js";
import type { Place } from "../../../shared/contracts/place.js";
import type { RouteCompareRequest, RouteOption } from "../../../shared/contracts/route.js";
import type { TrafficIncident } from "../../../shared/contracts/traffic.js";
import type { RouteQuery, RouteResult } from "../../../shared/rules/route.js";

/**
 * 외부 공급자 어댑터 인터페이스. 구현은 실패 시 ProviderError(429 → rate_limited)를 던진다.
 * 호출은 반드시 guardedCall을 거친다.
 */
export interface RouteProvider {
  readonly id: "kakao";
  /** 호출 하나(우선순위 또는 경유지). 경로를 찾지 못하면 ok: false와 이유. 호출 수는 planRouteQueries가 정한다. */
  fetchRoute(request: RouteCompareRequest, query: RouteQuery): Promise<RouteResult>;
}

/** 장소 검색. 결과는 저장·캐시하지 않는다. */
export interface PlaceProvider {
  readonly id: "kakaoLocal";
  search(query: string): Promise<Place[]>;
}

export interface TrafficProvider {
  readonly id: "jejuIts";
  fetchIncidents(): Promise<TrafficIncident[]>;
}

/** AI 설명 입력. 확인된 구조화 데이터만 담는다. */
export interface ExplanationInput {
  routes: RouteOption[];
  recommendedRouteId: string;
  incidents: TrafficIncident[];
}

export interface ExplanationProvider {
  readonly id: "ai";
  explain(input: ExplanationInput): Promise<Pick<Explanation, "text">>;
}
