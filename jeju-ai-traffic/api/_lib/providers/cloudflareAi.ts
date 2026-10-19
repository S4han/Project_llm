import type { ExplanationFacts } from "../../../shared/contracts/explanation.js";
import { MAX_CHARS, MAX_SENTENCES } from "../../../shared/rules/explanationCheck.js";
import { explanationEvidence } from "../../../shared/rules/explanation.js";
import { ProviderError } from "../errors.js";
import type { ExplanationProvider } from "./types.js";

/** 기본 모델(한국어 품질은 TASK-007 실호출로 확인). CF_AI_MODEL로 바꿀 수 있다. */
export const DEFAULT_CF_MODEL = "@cf/meta/llama-3.3-70b-instruct-fp8-fast";

/** AI 지시문. 확인된 사실만 쓰도록 요구한다. 최종 판단은 검증기(checkAiExplanation)가 한다. */
export function buildPrompt(facts: ExplanationFacts): { system: string; user: string } {
  const system = [
    "너는 제주 운전자에게 추천 경로의 이유를 설명한다.",
    `한국어 ${MAX_SENTENCES}문장 이내, ${MAX_CHARS}자 이내로 쓴다.`,
    "아래 사실에 있는 경로 이름과 숫자만 쓴다. 새 숫자·도로 이름·사고·날씨·원인을 지어내지 않는다.",
    "정체·서행·공사·통제는 사실에 있을 때만 말한다. '사고'라는 말은 쓰지 않는다.",
    "교통 정보가 확인되지 않은 구간이 많으면 원활하다고 단정하지 않는다.",
    "설명 문장만 출력한다.",
  ].join("\n");
  const rec = facts.routes.find((r) => r.id === facts.recommendedRouteId);
  const user = [
    `추천 경로: ${rec?.label ?? ""}${facts.tiedRouteIds.length > 0 ? " (예상시간 동률, 거리가 짧아 추천)" : ""}`,
    "경로별 사실:",
    ...explanationEvidence(facts).slice(0, -1).map((line) => `- ${line}`),
    facts.incidentsStatus === "ok" ? "" : "- 교통 사건 정보는 조회하지 못함",
  ]
    .filter(Boolean)
    .join("\n");
  return { system, user };
}

/** Workers AI 응답에서 문장을 꺼낸다(result.response 또는 OpenAI 형식 choices). */
function extractText(body: unknown): string | null {
  const result = (body as { result?: { response?: unknown; choices?: { message?: { content?: unknown } }[] } } | null)?.result;
  const text = result?.response ?? result?.choices?.[0]?.message?.content;
  return typeof text === "string" ? text.trim() : null;
}

/** Cloudflare Workers AI REST 어댑터. 토큰은 서버 환경 변수로만 받고 출력하지 않는다. */
export function createCloudflareAiProvider(
  accountId: string,
  token: string,
  model: string = DEFAULT_CF_MODEL,
  fetchImpl: typeof fetch = fetch,
): ExplanationProvider {
  return {
    id: "ai",
    async explain(facts: ExplanationFacts, signal?: AbortSignal): Promise<string> {
      const { system, user } = buildPrompt(facts);
      const res = await fetchImpl(`https://api.cloudflare.com/client/v4/accounts/${accountId}/ai/run/${model}`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: [
            { role: "system", content: system },
            { role: "user", content: user },
          ],
          max_tokens: 256,
          temperature: 0.2,
        }),
        signal,
      });
      // 무료 한도(일 10,000 Neurons) 초과·요청 제한은 429로 본다.
      if (res.status === 429) throw new ProviderError("rate_limited", "cloudflare ai 429");
      if (!res.ok) throw new ProviderError("unavailable", `cloudflare ai ${res.status}`);
      const text = extractText(await res.json());
      if (!text) throw new ProviderError("unavailable", "cloudflare ai: 응답 형식 오류");
      return text;
    },
  };
}
