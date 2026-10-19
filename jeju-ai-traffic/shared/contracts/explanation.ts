import type { IsoDateTime } from "./common.js";
import type { RouteQueryKind } from "./route.js";
import type { IncidentKind, IncidentsStatus } from "./traffic.js";

/** 설명 출처. 화면에서 반드시 구분해 표시한다(AC-006-07). */
export type ExplanationSource = "ai" | "rules";

export interface Explanation {
  text: string;
  source: ExplanationSource;
  /** 설명에 사용한 확인된 근거(공급자·값·기준 시각). */
  evidence: string[];
  generatedAt: IsoDateTime;
}

/** 설명에 쓰는 경로 하나의 확인된 사실. 좌표는 넣지 않는다. 비율은 0~100 정수(%). */
export interface RouteFacts {
  id: RouteQueryKind;
  label: string;
  durationSeconds: number;
  distanceMeters: number;
  shares: { smooth: number; slow: number; congested: number; unknown: number };
  incidentKinds: IncidentKind[];
}

/** POST /api/explanations 요청: 경로 비교 응답에서 뽑은 사실만 담는다. */
export interface ExplanationFacts {
  routes: RouteFacts[];
  recommendedRouteId: RouteQueryKind;
  tiedRouteIds: RouteQueryKind[];
  incidentsStatus: IncidentsStatus;
  /** 경로 조회 시각(근거 표시용). */
  observedAt: IsoDateTime;
}

/** AI를 쓰지 못한 이유. used가 아니면 규칙 기반 설명을 돌려준 것이다. */
export type AiStatus = "used" | "notConfigured" | "quotaBlocked" | "failed" | "rejected";

export interface ExplanationResponse {
  explanation: Explanation;
  aiStatus: AiStatus;
}
