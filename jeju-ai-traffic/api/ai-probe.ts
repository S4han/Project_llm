// TASK-007 일회성 확인용(승인: Workers AI 실호출 20건 이내). 확인 후 삭제한다.
// 열 때마다 고정 사례 4개를 AI에 보내고, 문장·검증 결과·응답 시간·토큰 사용량을 돌려준다.
// 인스턴스당 2회까지만 호출한다(최대 8건). 토큰 값은 응답에 넣지 않는다.
// 사용: 미리보기 주소 + /api/ai-probe 를 한 번만 연다.
import type { ExplanationFacts, RouteFacts } from "../shared/contracts/explanation.js";
import { checkAiExplanation } from "../shared/rules/explanationCheck.js";
import { createCloudflareAiProvider, DEFAULT_CF_MODEL } from "./_lib/providers/cloudflareAi.js";

let opens = 0;
const MAX_OPENS = 2;

const s = (smooth: number, slow: number, congested: number, unknown: number) => ({ smooth, slow, congested, unknown });
const r = (id: RouteFacts["id"], label: string, min: number, km: number, shares = s(100, 0, 0, 0), kinds: RouteFacts["incidentKinds"] = []): RouteFacts => ({
  id, label, durationSeconds: min * 60, distanceMeters: km * 1000, shares, incidentKinds: kinds,
});
const at = new Date().toISOString();
const CASES: Record<string, ExplanationFacts> = {
  normal: {
    routes: [r("recommend", "카카오 추천", 54, 41.4, s(87, 12, 0, 1), ["event", "event", "event"]), r("via1100", "1100도로 경유", 95, 58.6, s(60, 38, 2, 0)), r("via516", "516도로 경유", 111, 74.5, s(64, 32, 3, 1))],
    recommendedRouteId: "recommend", tiedRouteIds: [], incidentsStatus: "ok", observedAt: at,
  },
  tie: {
    routes: [r("recommend", "카카오 추천", 50, 45), r("distance", "최단거리", 50, 40, s(70, 30, 0, 0))],
    recommendedRouteId: "distance", tiedRouteIds: ["recommend", "distance"], incidentsStatus: "ok", observedAt: at,
  },
  unknownHigh: {
    routes: [r("recommend", "카카오 추천", 47, 37.4, s(55, 0, 0, 45)), r("distance", "최단거리", 52, 33.1, s(33, 33, 33, 1))],
    recommendedRouteId: "recommend", tiedRouteIds: [], incidentsStatus: "unavailable", observedAt: at,
  },
  roadwork: {
    routes: [r("recommend", "카카오 추천", 77, 47.7, s(90, 10, 0, 0), ["roadwork"]), r("distance", "최단거리", 80, 46.9)],
    recommendedRouteId: "recommend", tiedRouteIds: [], incidentsStatus: "ok", observedAt: at,
  },
};

export async function GET(): Promise<Response> {
  const headers = { "Cache-Control": "no-store", "Content-Type": "application/json; charset=utf-8" };
  const accountId = process.env.CLOUDFLARE_ACCOUNT_ID ?? "";
  const token = process.env.CLOUDFLARE_AI_TOKEN ?? "";
  const model = process.env.CF_AI_MODEL || DEFAULT_CF_MODEL;
  if (!accountId || !token) return new Response(JSON.stringify({ configured: false, accountId: !!accountId, token: !!token }), { headers });
  if (opens >= MAX_OPENS) return new Response(JSON.stringify({ stopped: "호출 상한 도달(인스턴스당 2회)" }), { headers });
  opens += 1;

  const redact = (v: string) => v.split(token).join("[TOKEN]").split(accountId).join("[ACCOUNT]");
  let usage: unknown = null;
  const capturingFetch = (async (url: RequestInfo | URL, init?: RequestInit) => {
    const res = await fetch(url, init);
    const body = await res.clone().json().catch(() => null);
    usage = (body as { result?: { usage?: unknown } } | null)?.result?.usage ?? null;
    return res;
  }) as typeof fetch;
  const provider = createCloudflareAiProvider(accountId, token, model, capturingFetch);

  const results = [];
  for (const [name, facts] of Object.entries(CASES)) {
    const started = Date.now();
    usage = null;
    try {
      const text = await provider.explain(facts, AbortSignal.timeout(15_000));
      const check = checkAiExplanation(text, facts);
      results.push({ case: name, ms: Date.now() - started, ok: check.ok, reasons: check.reasons, text, usage });
    } catch (e) {
      results.push({ case: name, ms: Date.now() - started, error: redact(String(e)) });
    }
  }
  const out = { open: opens, maxOpens: MAX_OPENS, model, region: process.env.VERCEL_REGION ?? null, calls: Object.keys(CASES).length, results };
  return new Response(redact(JSON.stringify(out, null, 1)), { headers });
}
