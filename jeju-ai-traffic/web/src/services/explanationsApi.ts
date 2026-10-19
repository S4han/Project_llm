import type { ExplanationFacts, ExplanationResponse } from "../../../shared/contracts/explanation";

/** POST /api/explanations. 실패하면 null(화면은 규칙 기반 설명을 그대로 둔다). */
export async function requestExplanation(facts: ExplanationFacts, signal?: AbortSignal): Promise<ExplanationResponse | null> {
  try {
    const res = await fetch("/api/explanations", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(facts),
      signal,
    });
    if (!res.ok) return null;
    const body = (await res.json().catch(() => null)) as ExplanationResponse | null;
    return body && body.explanation ? body : null;
  } catch {
    return null;
  }
}
