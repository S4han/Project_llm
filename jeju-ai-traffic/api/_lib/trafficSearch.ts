import type { SearchCategory, SearchDetailResponse, SearchFeed, SearchIndexResponse, SearchLiveResponse, SearchRow } from "../../shared/contracts/search.js";
import { SEARCH_CATEGORIES, SEARCH_NEAR_RADIUS, SEARCH_QUERY_MAX_LENGTH } from "../../shared/contracts/search.js";
import { isInJeju } from "../../shared/rules/geo.js";
import { mergePlaces } from "../../shared/rules/placeMerge.js";
import { AppError, toErrorResponse } from "./errors.js";
import { guardedCall } from "./policies/guardedCall.js";
import { quotaGuard, type QuotaGuard } from "./policies/quota.js";
import { RateLimiter } from "./policies/rateLimit.js";
import { TtlCache } from "./policies/ttlCache.js";
import { createKakaoLiveProvider, createKtoDetail, createKtoFeed, createMockDetail, createMockFeeds, createMockLiveProvider, createVisitJejuFeed, KAKAO_CODE, type DetailProvider, type FeedProvider, type LiveSearchProvider, type SearchDetail } from "./providers/tourSearch.js";

/** 목록은 서버 하루·CDN 7일(TASK-029 2.(a), 숙소·관광지와 같음). 일부 출처가 빠진 목록은 서버·CDN 10분만 두고 다시 받는다. */
export const SEARCH_CACHE_TTL_MS = 24 * 60 * 60_000;
export const SEARCH_CDN_SECONDS = 7 * 24 * 60 * 60;
export const SEARCH_PARTIAL_TTL_MS = 10 * 60_000;
/** 관광공사 소개정보(운영시간·주차·반려동물): 장소마다 서버·CDN 30일(범위 변경 2026-10-23, 관광지 TASK-026과 같음). */
export const SEARCH_DETAIL_TTL_MS = 30 * 24 * 60 * 60_000;
export const SEARCH_DETAIL_CDN_SECONDS = 30 * 24 * 60 * 60;
/** 목록·실시간 검색 합쳐 IP별 분당 요청 수. */
export const TRAFFIC_SEARCH_PER_MINUTE = 30;

interface SearchIndex {
  places: SearchRow[];
  missing: SearchFeed[];
  mock: boolean;
}

export interface TrafficSearchDeps {
  feeds: FeedProvider[];
  live: LiveSearchProvider;
  liveMock: boolean;
  detail: DetailProvider;
  cache: TtlCache<SearchIndex>;
  detailCache: TtlCache<SearchDetail>;
  guard: QuotaGuard;
  limiter: RateLimiter;
  now?: () => Date;
}

const FEED_CATEGORIES = ["ATTRACTION", "ACCOMMODATION", "RESTAURANT"] as const;

/**
 * 출처 선택: VISITJEJU_API_KEY가 있으면 비짓제주 3묶음, DATA_GO_KR_API_KEY가 있으면 관광공사 3묶음. 둘 다 없으면 모의.
 * 카카오는 장소 검색과 같이 PLACES_PROVIDER=kakao와 KAKAO_REST_API_KEY가 모두 있을 때만 실제 호출.
 * 합칠 때 앞의 출처를 우선한다(비짓제주: 사진·소개·전화가 더 많음).
 */
export function selectSearchProviders(env: Record<string, string | undefined>): Pick<TrafficSearchDeps, "feeds" | "live" | "liveMock" | "detail"> {
  const vj = env.VISITJEJU_API_KEY?.trim();
  const kto = env.DATA_GO_KR_API_KEY;
  const feeds = [...(vj ? FEED_CATEGORIES.map((c) => createVisitJejuFeed(vj, c)) : []), ...(kto ? FEED_CATEGORIES.map((c) => createKtoFeed(kto, c)) : [])];
  const kakao = env.KAKAO_REST_API_KEY;
  const real = env.PLACES_PROVIDER === "kakao" && kakao;
  return { feeds: feeds.length ? feeds : createMockFeeds(), live: real ? createKakaoLiveProvider(kakao) : createMockLiveProvider(), liveMock: !real, detail: kto ? createKtoDetail(kto) : createMockDetail() };
}

function clientKey(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return request.headers.get("x-real-ip") ?? (forwarded || "unknown");
}

/** 묶음마다 따로 받는다. 하나가 실패해도 나머지로 목록을 만들고 빠진 묶음을 알린다. 모두 실패하면 오류. */
async function buildIndex(deps: TrafficSearchDeps): Promise<SearchIndex> {
  const results = await Promise.allSettled(
    deps.feeds.map((f) => {
      const provider = f.feed.source === "visitJeju" ? "visitJeju" : "kto";
      return guardedCall(deps.guard, provider, () => f.fetch(async (calls) => void (await deps.guard.reserve(provider, { cost: calls }))));
    }),
  );
  const ok = results.flatMap((r) => (r.status === "fulfilled" ? [r.value] : []));
  if (!ok.length) {
    const blocked = results.find((r): r is PromiseRejectedResult => r.status === "rejected" && r.reason instanceof AppError && r.reason.code === "QUOTA_BLOCKED");
    throw blocked ? blocked.reason : new AppError("PROVIDER_UNAVAILABLE", "관광 정보를 가져올 수 없습니다.");
  }
  return {
    places: mergePlaces(ok),
    missing: deps.feeds.filter((_, i) => results[i]!.status === "rejected").map((f) => f.feed),
    mock: deps.feeds.every((f) => f.mock === true),
  };
}

function parseCategory(v: string | null): SearchCategory | "ALL" {
  if (v === null || v === "" || v === "ALL") return "ALL";
  if ((SEARCH_CATEGORIES as string[]).includes(v)) return v as SearchCategory;
  throw new AppError("INVALID_INPUT", "카테고리가 올바르지 않습니다.");
}

/**
 * GET /api/traffic/search: 비짓제주·관광공사 장소를 합친 목록(검색은 화면에서).
 * ?q=검색어 또는 ?lat=&lng=(내 주변)이 있으면 카카오 로컬 실시간 음식점·카페(카테고리 ALL·RESTAURANT·CAFE만, 저장하지 않음, no-store).
 * ?kto=콘텐츠 ID&cat=카테고리면 그 장소의 관광공사 소개정보(운영시간·쉬는날·주차·반려동물, 30일).
 */
export async function handleTrafficSearch(request: Request, deps: TrafficSearchDeps): Promise<Response> {
  const now = deps.now ?? (() => new Date());
  try {
    const params = new URL(request.url).searchParams;
    if (params.has("kto")) {
      const id = params.get("kto") ?? "";
      const cat = parseCategory(params.get("cat"));
      if (!/^(?:\d{1,12}|MOCK-K\d{1,3})$/.test(id) || cat === "ALL") throw new AppError("INVALID_INPUT", "장소 번호나 카테고리가 올바르지 않습니다.");
      const retry = deps.limiter.tryAcquire(clientKey(request));
      if (retry !== null) throw new AppError("QUOTA_BLOCKED", "검색 요청이 너무 잦습니다. 잠시 후 다시 시도하세요.", new Date(retry).toISOString());
      // 카페와 음식점은 관광공사에서 같은 분류(39)라 같은 보관본을 쓴다.
      const kind = cat === "CAFE" ? "RESTAURANT" : cat;
      const d = await deps.detailCache.getOrLoad(`${kind}:${id}`, () => guardedCall(deps.guard, "kto", () => deps.detail.fetchDetail(id, kind)));
      const body: SearchDetailResponse = { ...d, builtAt: now().toISOString() };
      return Response.json(body, { headers: { "Cache-Control": `public, max-age=86400, s-maxage=${SEARCH_DETAIL_CDN_SECONDS}, stale-while-revalidate=86400` } });
    }
    const live = params.has("q") || params.has("lat") || params.has("lng");
    let liveInput: Parameters<LiveSearchProvider["search"]>[0] | null = null;
    if (live) {
      const q = (params.get("q") ?? "").trim();
      const cat = parseCategory(params.get("cat"));
      const hasOrigin = params.has("lat") || params.has("lng");
      const origin = hasOrigin ? { lat: Number(params.get("lat")), lng: Number(params.get("lng")) } : null;
      if (q.length > SEARCH_QUERY_MAX_LENGTH) throw new AppError("INVALID_INPUT", `검색어를 ${SEARCH_QUERY_MAX_LENGTH}자 이하로 입력하세요.`);
      if (origin && !isInJeju(origin)) throw new AppError("INVALID_INPUT", "기준 위치가 제주 밖입니다.");
      if (!q && !origin) throw new AppError("INVALID_INPUT", "검색어나 기준 위치가 필요합니다.");
      const codes = cat === "ALL" ? ["FD6", "CE7"] : KAKAO_CODE[cat] ? [KAKAO_CODE[cat]!] : [];
      liveInput = { q, codes, origin, radius: SEARCH_NEAR_RADIUS };
    }
    const retryAt = deps.limiter.tryAcquire(clientKey(request));
    if (retryAt !== null) throw new AppError("QUOTA_BLOCKED", "검색 요청이 너무 잦습니다. 잠시 후 다시 시도하세요.", new Date(retryAt).toISOString());
    if (liveInput) {
      const input = liveInput;
      // 관광지·숙박만 고르면 카카오를 부르지 않는다.
      const places = input.codes.length ? await guardedCall(deps.guard, "kakaoLocal", () => deps.live.search(input), { cost: input.q ? 1 : input.codes.length }) : [];
      const body: SearchLiveResponse = { places, observedAt: now().toISOString(), mock: deps.liveMock };
      return Response.json(body, { headers: { "Cache-Control": "no-store" } });
    }
    const index = await deps.cache.getOrLoad("index", () => buildIndex(deps), (v) => (v.missing.length ? SEARCH_PARTIAL_TTL_MS : SEARCH_CACHE_TTL_MS));
    const body: SearchIndexResponse = { places: index.places, missing: index.missing, builtAt: now().toISOString(), mock: index.mock };
    const cdn = index.missing.length ? "public, max-age=300, s-maxage=600" : `public, max-age=3600, s-maxage=${SEARCH_CDN_SECONDS}, stale-while-revalidate=86400`;
    return Response.json(body, { headers: { "Cache-Control": cdn } });
  } catch (err) {
    return toErrorResponse(err, now());
  }
}

export const defaultTrafficSearchDeps: TrafficSearchDeps = {
  ...selectSearchProviders(process.env),
  cache: new TtlCache<SearchIndex>(SEARCH_CACHE_TTL_MS),
  detailCache: new TtlCache<SearchDetail>(SEARCH_DETAIL_TTL_MS),
  guard: quotaGuard,
  limiter: new RateLimiter(TRAFFIC_SEARCH_PER_MINUTE, 60_000),
};
