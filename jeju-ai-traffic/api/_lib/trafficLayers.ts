import type { TrafficLinksResponse, TrafficSpeedsResponse } from "../../shared/contracts/traffic.js";
import { AppError, toErrorResponse } from "./errors.js";
import { guardedCall } from "./policies/guardedCall.js";
import { quotaGuard, type QuotaGuard } from "./policies/quota.js";
import { RateLimiter } from "./policies/rateLimit.js";
import { TtlCache } from "./policies/ttlCache.js";
import { createJejuItsSpeedProvider, createMockSpeedProvider, type SpeedProvider, type SpeedSnapshot } from "./providers/jejuItsSpeeds.js";
import { createMockLinkProvider, createVworldLinkProvider, type LinkBuild, type LinkProvider } from "./providers/vworldLinks.js";

/** 구간 속도 캐시. 원천이 약 5분 단위라 1분이면 충분하다(TASK-012). */
export const SPEEDS_CACHE_TTL_MS = 60_000;
/** 구간 모양 캐시(인스턴스 메모리). 바깥에서는 CDN이 30일 보관한다. */
export const LINKS_CACHE_TTL_MS = 24 * 60 * 60_000;
/** 구간 모양 응답의 CDN 보관(초). 도로 모양은 거의 바뀌지 않는다(사용자 승인 "30일 캐시"). */
export const LINKS_CDN_SECONDS = 30 * 24 * 60 * 60;
/** 지점 이름(교통노드)을 받지 못한 응답은 1시간만 보관해 곧 다시 만든다(TASK-015). */
export const LINKS_PARTIAL_CDN_SECONDS = 60 * 60;

export const TRAFFIC_SPEEDS_PER_MINUTE = 20;
export const TRAFFIC_LINKS_PER_MINUTE = 10;

export interface SpeedDeps {
  speeds: SpeedProvider;
  speedCache: TtlCache<SpeedSnapshot>;
  guard: QuotaGuard;
  now?: () => Date;
}

export interface TrafficSpeedsDeps extends SpeedDeps {
  limiter: RateLimiter;
}

export interface TrafficLinksDeps extends SpeedDeps {
  links: LinkProvider;
  linkCache: TtlCache<LinkBuild>;
  limiter: RateLimiter;
}

/** JEJU_ITS_TRAFFIC_API_KEY(실시간 교통정보 전용 키)와 TRAFFIC_PROVIDER=jejuIts가 있을 때만 실제 호출, 그 외에는 모의. */
export function selectSpeedProvider(env: Record<string, string | undefined>): SpeedProvider {
  const key = env.JEJU_ITS_TRAFFIC_API_KEY;
  if (env.TRAFFIC_PROVIDER === "jejuIts" && key) return createJejuItsSpeedProvider(key);
  return createMockSpeedProvider();
}

/** VWORLD_API_KEY가 있을 때만 브이월드. domain은 인증키에 등록한 서비스 주소(VWORLD_DOMAIN, 기본 공개 주소). */
export function selectLinkProvider(env: Record<string, string | undefined>): LinkProvider {
  const key = env.VWORLD_API_KEY;
  if (key) return createVworldLinkProvider(key, env.VWORLD_DOMAIN || "https://jeju-its-probe.vercel.app");
  return createMockLinkProvider();
}

function clientKey(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return request.headers.get("x-real-ip") ?? (forwarded || "unknown");
}

function limit(deps: { limiter: RateLimiter }, request: Request) {
  const retryAt = deps.limiter.tryAcquire(clientKey(request));
  if (retryAt !== null) throw new AppError("QUOTA_BLOCKED", "교통 현황 요청이 너무 잦습니다. 잠시 후 다시 시도하세요.", new Date(retryAt).toISOString());
}

/** 구간 속도(60초 캐시, 제주 ITS 일일 한도 공유). */
export function loadSpeeds(deps: SpeedDeps): Promise<SpeedSnapshot> {
  return deps.speedCache.getOrLoad("speeds", () => guardedCall(deps.guard, "jejuIts", () => deps.speeds.fetchSpeeds()));
}

/** GET /api/traffic/speeds: 실패·한도는 200 + status. 빈도 제한만 429. */
export async function handleTrafficSpeeds(request: Request, deps: TrafficSpeedsDeps): Promise<Response> {
  const now = deps.now ?? (() => new Date());
  try {
    limit(deps, request);
    let body: TrafficSpeedsResponse;
    try {
      const snap = await loadSpeeds(deps);
      body = { status: "ok", observedAt: snap.observedAt, speeds: snap.speeds, source: snap.source, retryAfter: null };
    } catch (err) {
      const quota = err instanceof AppError && err.code === "QUOTA_BLOCKED";
      body = { status: quota ? "quotaBlocked" : "unavailable", observedAt: null, speeds: {}, source: "jejuIts", retryAfter: quota ? (err.retryAfter ?? null) : null };
    }
    return Response.json(body, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    return toErrorResponse(err, now());
  }
}

/**
 * GET /api/traffic/links: 속도가 있는 구간의 모양·양 끝 지점 이름. 성공하면 CDN에 30일 보관한다(지점 이름이 없으면 1시간).
 * 속도나 모양을 받지 못하면 오류(보관하지 않음) — 화면은 구간 색 없이 사건만 보여 준다.
 */
export async function handleTrafficLinks(request: Request, deps: TrafficLinksDeps): Promise<Response> {
  const now = deps.now ?? (() => new Date());
  try {
    limit(deps, request);
    const build = await deps.linkCache.getOrLoad("links", async () => {
      const ids = new Set(Object.keys((await loadSpeeds(deps)).speeds));
      return guardedCall(deps.guard, "vworld", () =>
        deps.links.fetchLinks(ids, async (calls) => {
          await deps.guard.reserve("vworld", { cost: calls });
        }),
      );
    });
    const body: TrafficLinksResponse = { links: build.links, named: build.named, builtAt: now().toISOString(), source: deps.links.source };
    const cache = build.named
      ? `public, max-age=86400, s-maxage=${LINKS_CDN_SECONDS}, stale-while-revalidate=604800`
      : `public, max-age=${LINKS_PARTIAL_CDN_SECONDS}, s-maxage=${LINKS_PARTIAL_CDN_SECONDS}`;
    return Response.json(body, { headers: { "Cache-Control": cache } });
  } catch (err) {
    return toErrorResponse(err, now());
  }
}

const speedCache = new TtlCache<SpeedSnapshot>(SPEEDS_CACHE_TTL_MS);
const speeds = selectSpeedProvider(process.env);

export const defaultTrafficSpeedsDeps: TrafficSpeedsDeps = {
  speeds,
  speedCache,
  guard: quotaGuard,
  limiter: new RateLimiter(TRAFFIC_SPEEDS_PER_MINUTE, 60_000),
};

export const defaultTrafficLinksDeps: TrafficLinksDeps = {
  speeds,
  speedCache,
  links: selectLinkProvider(process.env),
  linkCache: new TtlCache<LinkBuild>(LINKS_CACHE_TTL_MS),
  guard: quotaGuard,
  limiter: new RateLimiter(TRAFFIC_LINKS_PER_MINUTE, 60_000),
};
