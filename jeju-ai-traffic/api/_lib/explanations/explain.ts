import type { Explanation } from "../../../shared/contracts/explanation.js";
import type { RouteOption } from "../../../shared/contracts/route.js";
import { guardedCall } from "../policies/guardedCall.js";
import type { QuotaGuard } from "../policies/quota.js";
import type { ExplanationInput, ExplanationProvider } from "../providers/types.js";

function minutes(seconds: number): number {
  return Math.round(seconds / 60);
}

function routeEvidence(route: RouteOption): string {
  return `${route.provider} ${route.label}: 예상 ${minutes(route.durationSeconds)}분, 기준 시각 ${route.observedAt}`;
}

/**
 * 규칙 기반 설명. 입력에 있는 경로 예상시간과 확인된 사건 수만 사용하고 새 사실을 만들지 않는다(AC-006-03·06).
 */
export function buildRulesExplanation(input: ExplanationInput, now: Date): Explanation {
  const recommended = input.routes.find((r) => r.id === input.recommendedRouteId);
  if (!recommended) throw new Error("recommendedRouteId가 routes에 없습니다.");

  const others = input.routes
    .filter((r) => r.id !== recommended.id)
    .sort((a, b) => a.durationSeconds - b.durationSeconds);
  const parts = [`${recommended.label} 경로의 예상 소요시간은 ${minutes(recommended.durationSeconds)}분입니다.`];
  const next = others[0];
  if (next) {
    const diff = minutes(next.durationSeconds - recommended.durationSeconds);
    if (diff > 0) parts.push(`다음으로 빠른 ${next.label} 경로보다 약 ${diff}분 빠릅니다.`);
    else if (diff < 0) parts.push(`${next.label} 경로가 약 ${-diff}분 더 빠릅니다.`);
    else parts.push(`${next.label} 경로와 예상 소요시간 차이가 1분 미만입니다.`);
  } else {
    parts.push("비교할 대체 경로가 없습니다.");
  }
  if (input.incidents.length > 0) {
    parts.push(`경로 주변에서 확인된 교통 사건이 ${input.incidents.length}건 있습니다.`);
  }

  return {
    text: parts.join(" "),
    source: "rules",
    evidence: [
      ...[recommended, ...others].map(routeEvidence),
      ...input.incidents.map((i) => `jejuIts ${i.kind}: ${i.description}, 기준 시각 ${i.observedAt}`),
    ],
    generatedAt: now.toISOString(),
  };
}

export interface ExplainDeps {
  guard: QuotaGuard;
  ai?: ExplanationProvider;
  /**
   * AI 문장 사실 검증. 통과한 문장만 source "ai"로 쓴다.
   * 검증 규칙은 TASK-007에서 정하며, 그 전까지 기본값은 모두 거부한다.
   */
  verify?: (text: string, input: ExplanationInput) => boolean;
  now?: () => Date;
}

/**
 * 설명 생성. AI가 없거나, 한도로 차단되거나, 실패하거나, 검증에 실패하면 규칙 기반 설명으로 대체한다(AC-006-04·05).
 * 이 함수는 오류를 던지지 않으므로 경로 비교 응답을 막지 않는다.
 */
export async function explain(input: ExplanationInput, deps: ExplainDeps): Promise<Explanation> {
  const now = deps.now ?? (() => new Date());
  const rules = buildRulesExplanation(input, now());
  const ai = deps.ai;
  if (!ai) return rules;

  const verify = deps.verify ?? (() => false);
  try {
    const { text } = await guardedCall(deps.guard, "ai", () => ai.explain(input));
    if (!verify(text, input)) return rules;
    return { text, source: "ai", evidence: rules.evidence, generatedAt: now().toISOString() };
  } catch {
    return rules;
  }
}
