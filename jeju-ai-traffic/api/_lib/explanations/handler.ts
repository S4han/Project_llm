import type { ExplanationFacts, ExplanationResponse, RouteFacts } from "../../../shared/contracts/explanation.js";
import type { RouteQueryKind } from "../../../shared/contracts/route.js";
import type { IncidentKind, IncidentsStatus } from "../../../shared/contracts/traffic.js";
import { AppError, toErrorResponse } from "../errors.js";
import { quotaGuard, type QuotaGuard } from "../policies/quota.js";
import { RateLimiter } from "../policies/rateLimit.js";
import { createCloudflareAiProvider, DEFAULT_CF_MODEL } from "../providers/cloudflareAi.js";
import type { ExplanationProvider } from "../providers/types.js";
import { explain } from "./explain.js";

/** 설명 요청 빈도 제한: IP별 분당 10회 (DECISIONS 2026-10-19 TASK-007 "3. 승인"). */
export const EXPLANATION_PER_MINUTE = 10;

/** 경로 이름은 호출 방식별로 정해져 있다(planRouteQueries). 이 밖의 이름은 받지 않는다(지시문 주입 방지). */
const LABELS: Record<RouteQueryKind, string> = {
  recommend: "카카오 추천",
  distance: "최단거리",
  via1100: "1100도로 경유",
  via516: "516도로 경유",
};
const KINDS: IncidentKind[] = ["event", "closure", "roadwork", "weather"];
const STATUSES: IncidentsStatus[] = ["ok", "unavailable", "quotaBlocked"];

export interface ExplanationDeps {
  ai?: ExplanationProvider;
  guard: QuotaGuard;
  limiter: RateLimiter;
  now?: () => Date;
}

/** AI_PROVIDER=cloudflare와 계정 ID·토큰이 모두 있을 때만 Workers AI, 그 외에는 AI 없음(규칙 기반 설명만). */
export function selectAiProvider(env: Record<string, string | undefined>): ExplanationProvider | undefined {
  const { AI_PROVIDER, CLOUDFLARE_ACCOUNT_ID, CLOUDFLARE_AI_TOKEN, CF_AI_MODEL } = env;
  if (AI_PROVIDER !== "cloudflare" || !CLOUDFLARE_ACCOUNT_ID || !CLOUDFLARE_AI_TOKEN) return undefined;
  return createCloudflareAiProvider(CLOUDFLARE_ACCOUNT_ID, CLOUDFLARE_AI_TOKEN, CF_AI_MODEL || DEFAULT_CF_MODEL);
}

const isPct = (v: unknown) => Number.isInteger(v) && (v as number) >= 0 && (v as number) <= 100;

function parseRoute(raw: unknown): RouteFacts | null {
  const r = raw as Partial<RouteFacts> | null;
  if (!r || typeof r.id !== "string" || !(r.id in LABELS) || r.label !== LABELS[r.id as RouteQueryKind]) return null;
  if (typeof r.durationSeconds !== "number" || !(r.durationSeconds > 0) || r.durationSeconds > 86_400) return null;
  if (typeof r.distanceMeters !== "number" || !(r.distanceMeters >= 0) || r.distanceMeters > 500_000) return null;
  const s = r.shares;
  if (!s || !isPct(s.smooth) || !isPct(s.slow) || !isPct(s.congested) || !isPct(s.unknown)) return null;
  if (!Array.isArray(r.incidentKinds) || r.incidentKinds.length > 50 || !r.incidentKinds.every((k) => KINDS.includes(k))) return null;
  return {
    id: r.id as RouteQueryKind,
    label: r.label,
    durationSeconds: r.durationSeconds,
    distanceMeters: r.distanceMeters,
    shares: { smooth: s.smooth, slow: s.slow, congested: s.congested, unknown: s.unknown },
    incidentKinds: [...r.incidentKinds],
  };
}

/** 요청 본문 검사. 형식이 하나라도 맞지 않으면 INVALID_INPUT. */
export function parseFacts(body: unknown): ExplanationFacts {
  const b = body as Partial<ExplanationFacts> | null;
  const invalid = () => new AppError("INVALID_INPUT", "설명 요청 형식이 올바르지 않습니다.");
  if (!b || !Array.isArray(b.routes) || b.routes.length < 1 || b.routes.length > 4) throw invalid();
  const routes = b.routes.map(parseRoute);
  if (routes.some((r) => r === null)) throw invalid();
  const ids = (routes as RouteFacts[]).map((r) => r.id);
  if (new Set(ids).size !== ids.length) throw invalid();
  if (typeof b.recommendedRouteId !== "string" || !ids.includes(b.recommendedRouteId)) throw invalid();
  if (!Array.isArray(b.tiedRouteIds) || !b.tiedRouteIds.every((id) => ids.includes(id))) throw invalid();
  if (!STATUSES.includes(b.incidentsStatus as IncidentsStatus)) throw invalid();
  if (typeof b.observedAt !== "string" || Number.isNaN(Date.parse(b.observedAt))) throw invalid();
  return {
    routes: routes as RouteFacts[],
    recommendedRouteId: b.recommendedRouteId,
    tiedRouteIds: [...b.tiedRouteIds],
    incidentsStatus: b.incidentsStatus as IncidentsStatus,
    observedAt: b.observedAt,
  };
}

function clientKey(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return request.headers.get("x-real-ip") ?? (forwarded || "unknown");
}

/** POST /api/explanations: 입력 검사 → 빈도 제한 → 설명(AI 시도 후 검증, 실패 시 규칙). */
export async function handleExplanation(request: Request, deps: ExplanationDeps): Promise<Response> {
  const now = deps.now ?? (() => new Date());
  try {
    const facts = parseFacts(await request.json().catch(() => null));
    const retryAt = deps.limiter.tryAcquire(clientKey(request));
    if (retryAt !== null) {
      throw new AppError("QUOTA_BLOCKED", "설명 요청이 너무 잦습니다. 잠시 후 다시 시도하세요.", new Date(retryAt).toISOString());
    }
    const { explanation, aiStatus } = await explain(facts, { guard: deps.guard, ai: deps.ai, now });
    const body: ExplanationResponse = { explanation, aiStatus };
    return Response.json(body, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    return toErrorResponse(err, now());
  }
}

export const defaultExplanationDeps: ExplanationDeps = {
  ai: selectAiProvider(process.env),
  guard: quotaGuard,
  limiter: new RateLimiter(EXPLANATION_PER_MINUTE, 60_000),
};
