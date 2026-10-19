import type { RouteOption, RouteQueryKind } from "../contracts/route.js";

/** 공급자가 경로를 찾지 못한 이유. 카카오 result_code 102(출발지)·103(도착지) 기준, 그 외는 notFound. */
export type NoRouteReason = "originUnreachable" | "destinationUnreachable" | "notFound";

export type RouteResult = { ok: true; route: RouteOption } | { ok: false; reason: NoRouteReason };

export interface RouteQuery {
  kind: RouteQueryKind;
  label: string;
}

/**
 * 조회에 쓸 호출 목록: 카카오 추천(실시간 교통 반영) 1회.
 * DECISIONS 2026-10-19 TASK-011 "경로방식 (a)" — 최단거리·1100도로·516도로 경유 호출은 하지 않는다.
 */
export function planRouteQueries(): RouteQuery[] {
  return [{ kind: "recommend", label: "카카오 추천" }];
}

/** 같은 경로 판정: 거리 차이 1% 이내이면서 시간 차이 120초 이내. */
export function isSameRoute(a: RouteOption, b: RouteOption): boolean {
  const longer = Math.max(a.distanceMeters, b.distanceMeters);
  const distanceClose = longer === 0 || Math.abs(a.distanceMeters - b.distanceMeters) / longer <= 0.01;
  return distanceClose && Math.abs(a.durationSeconds - b.durationSeconds) <= 120;
}

/** 같은 경로는 앞 순서 하나만 남긴다. */
export function dedupeRoutes(routes: RouteOption[]): RouteOption[] {
  const kept: RouteOption[] = [];
  for (const route of routes) {
    if (!kept.some((k) => isSameRoute(k, route))) kept.push(route);
  }
  return kept;
}

export interface Recommendation {
  recommendedRouteId: string | null;
  tiedRouteIds: string[];
}

/**
 * 최단 예상시간 경로 선택(AC-004-01·02). 동률(초 단위 같음)이면 거리가 짧은 경로,
 * 거리도 같으면 입력 순서. DECISIONS 2026-10-19 TASK-005 "1. (a)".
 */
export function pickRecommended(routes: RouteOption[]): Recommendation {
  if (routes.length === 0) return { recommendedRouteId: null, tiedRouteIds: [] };
  const minDuration = Math.min(...routes.map((r) => r.durationSeconds));
  const tied = routes.filter((r) => r.durationSeconds === minDuration);
  const best = tied.reduce((a, b) => (b.distanceMeters < a.distanceMeters ? b : a));
  return { recommendedRouteId: best.id, tiedRouteIds: tied.length > 1 ? tied.map((r) => r.id) : [] };
}

/** 추천 경로와의 예상시간 차이(초, 원천 값 그대로). 양수면 더 느리다(AC-004-03). */
export function durationDiffSeconds(route: RouteOption, recommended: RouteOption): number {
  return route.durationSeconds - recommended.durationSeconds;
}
