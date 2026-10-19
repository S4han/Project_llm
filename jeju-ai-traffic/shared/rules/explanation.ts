import type { Explanation, ExplanationFacts, RouteFacts } from "../contracts/explanation.js";
import type { RouteCompareResponse } from "../contracts/route.js";
import type { IncidentKind } from "../contracts/traffic.js";
import { trafficShares } from "./traffic.js";

/** 정보 미확보 비율이 이 값(%)을 넘으면 '원활'류 표현을 쓰지 않는다. DECISIONS 2026-10-19 TASK-007 "2. 승인". */
export const UNKNOWN_SHARE_LIMIT = 30;

const KIND_WORD: Record<IncidentKind, string> = { event: "돌발", closure: "통제", roadwork: "공사", weather: "기상" };

export function minutes(seconds: number): number {
  return Math.round(seconds / 60);
}

export function km(meters: number): string {
  return (meters / 1000).toFixed(1);
}

/** 경로 비교 응답 → 설명 사실(숫자 요약). 비율은 반올림한 정수 %. */
export function toExplanationFacts(data: RouteCompareResponse): ExplanationFacts | null {
  if (!data.recommendedRouteId) return null;
  const routes: RouteFacts[] = data.routes.map((r) => {
    const s = trafficShares(r.segments);
    const kinds = r.incidentIds
      .map((id) => data.incidents.find((i) => i.id === id)?.kind)
      .filter((k): k is IncidentKind => k !== undefined);
    return {
      id: r.id as RouteFacts["id"],
      label: r.label,
      durationSeconds: r.durationSeconds,
      distanceMeters: r.distanceMeters,
      shares: {
        smooth: Math.round(s.smooth * 100),
        slow: Math.round(s.slow * 100),
        congested: Math.round(s.congested * 100),
        unknown: Math.round(s.unknown * 100),
      },
      incidentKinds: kinds,
    };
  });
  return {
    routes,
    recommendedRouteId: data.recommendedRouteId as ExplanationFacts["recommendedRouteId"],
    tiedRouteIds: data.tiedRouteIds as ExplanationFacts["tiedRouteIds"],
    incidentsStatus: data.incidentsStatus,
    observedAt: data.observedAt,
  };
}

function kindsPhrase(kinds: IncidentKind[]): string {
  return [...new Set(kinds)].map((k) => KIND_WORD[k]).join("·");
}

/** ISO 시각 → "2026-10-19 18:18 (KST)". */
function kst(iso: string): string {
  const d = new Date(Date.parse(iso) + 9 * 3600_000).toISOString();
  return `${d.slice(0, 10)} ${d.slice(11, 16)} (KST)`;
}

/** 설명 근거 목록(경로별 값과 조회 시각). 출처 이름은 화면의 조회 기준 문구가 보여 준다. */
export function explanationEvidence(facts: ExplanationFacts): string[] {
  return [
    ...facts.routes.map(
      (r) =>
        `${r.label}: 예상 ${minutes(r.durationSeconds)}분, ${km(r.distanceMeters)}km, 원활 ${r.shares.smooth}%·서행 ${r.shares.slow}%·정체 ${r.shares.congested}%·미확보 ${r.shares.unknown}%, 교통 사건 ${r.incidentKinds.length}건`,
    ),
    `경로 조회 시각 ${kst(facts.observedAt)}`,
  ];
}

/**
 * 규칙 기반 설명(AC-006-06). 입력 사실만 쓰고, 0인 비율·사건은 말하지 않으며, 미확보가 많으면 '원활'을 말하지 않는다.
 */
export function buildRulesExplanation(facts: ExplanationFacts, now: Date): Explanation {
  const rec = facts.routes.find((r) => r.id === facts.recommendedRouteId);
  if (!rec) throw new Error("recommendedRouteId가 routes에 없습니다.");
  const others = facts.routes.filter((r) => r !== rec).sort((a, b) => a.durationSeconds - b.durationSeconds);
  const parts: string[] = [];

  const tiedOthers = others.filter((r) => facts.tiedRouteIds.includes(r.id));
  if (tiedOthers.length > 0) {
    parts.push(
      `${rec.label} 경로와 ${tiedOthers.map((r) => r.label).join("·")} 경로의 예상시간이 ${minutes(rec.durationSeconds)}분으로 같아, 거리가 짧은 ${rec.label} 경로를 추천합니다.`,
    );
  } else {
    parts.push(`${rec.label} 경로가 예상 ${minutes(rec.durationSeconds)}분으로 가장 빠릅니다.`);
    const next = others[0];
    if (!next) parts.push("비교할 대체 경로가 없습니다.");
    else {
      const diff = minutes(next.durationSeconds - rec.durationSeconds);
      parts.push(diff >= 1 ? `다음으로 빠른 ${next.label} 경로보다 약 ${diff}분 빠릅니다.` : `${next.label} 경로와의 차이는 1분 미만입니다.`);
    }
  }

  const { slow, congested, unknown, smooth } = rec.shares;
  const busy = [congested > 0 ? `정체 ${congested}%` : "", slow > 0 ? `서행 ${slow}%` : ""].filter(Boolean);
  if (busy.length > 0) parts.push(`이 경로에는 ${busy.join(", ")} 구간이 있습니다.`);
  else if (unknown <= UNKNOWN_SHARE_LIMIT && smooth > 0) parts.push(`이 경로는 원활 구간이 ${smooth}%입니다.`);
  if (unknown > UNKNOWN_SHARE_LIMIT) parts.push(`교통 정보가 확인되지 않은 구간이 ${unknown}%입니다.`);

  if (facts.incidentsStatus !== "ok") parts.push("교통 사건 정보는 확인하지 못했습니다.");
  else if (rec.incidentKinds.length > 0) {
    parts.push(`경로 주변에서 제주 ITS ${kindsPhrase(rec.incidentKinds)} 정보 ${rec.incidentKinds.length}건이 확인됐습니다.`);
  }

  return { text: parts.join(" "), source: "rules", evidence: explanationEvidence(facts), generatedAt: now.toISOString() };
}
