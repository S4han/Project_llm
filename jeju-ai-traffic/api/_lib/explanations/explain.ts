import type { AiStatus, Explanation, ExplanationFacts } from "../../../shared/contracts/explanation.js";
import { buildRulesExplanation } from "../../../shared/rules/explanation.js";
import { checkAiExplanation, type CheckResult } from "../../../shared/rules/explanationCheck.js";
import { AppError } from "../errors.js";
import { guardedCall } from "../policies/guardedCall.js";
import type { QuotaGuard } from "../policies/quota.js";
import type { ExplanationProvider } from "../providers/types.js";

/** AI 응답 제한 시간. 넘으면 규칙 기반 설명(AC-006-04). */
export const AI_TIMEOUT_MS = 4000;

export interface ExplainDeps {
  guard: QuotaGuard;
  ai?: ExplanationProvider;
  /** AI 문장 검증. 기본은 승인된 검증 정책(checkAiExplanation). */
  verify?: (text: string, facts: ExplanationFacts) => CheckResult;
  now?: () => Date;
  timeoutMs?: number;
}

export interface ExplainResult {
  explanation: Explanation;
  aiStatus: AiStatus;
  /** 검증 실패 이유(rejected일 때). 화면에는 쓰지 않고 시험·로그용. */
  rejectReasons?: string[];
}

/**
 * 설명 생성. AI가 없거나, 한도로 차단되거나, 실패·지연되거나, 검증에 실패하면 규칙 기반 설명을 돌려준다(AC-006-04·05).
 * 오류를 던지지 않는다.
 */
export async function explain(facts: ExplanationFacts, deps: ExplainDeps): Promise<ExplainResult> {
  const now = deps.now ?? (() => new Date());
  const rules = buildRulesExplanation(facts, now());
  const ai = deps.ai;
  if (!ai) return { explanation: rules, aiStatus: "notConfigured" };

  const verify = deps.verify ?? checkAiExplanation;
  try {
    const signal = AbortSignal.timeout(deps.timeoutMs ?? AI_TIMEOUT_MS);
    const text = await guardedCall(deps.guard, "ai", () => ai.explain(facts, signal));
    const check = verify(text, facts);
    if (!check.ok) return { explanation: rules, aiStatus: "rejected", rejectReasons: check.reasons };
    return {
      explanation: { text: text.trim(), source: "ai", evidence: rules.evidence, generatedAt: now().toISOString() },
      aiStatus: "used",
    };
  } catch (err) {
    const quota = err instanceof AppError && err.code === "QUOTA_BLOCKED";
    return { explanation: rules, aiStatus: quota ? "quotaBlocked" : "failed" };
  }
}
