import type { SearchDetailResponse, SearchFeed, SearchIndexResponse, SearchPetResponse, SearchRow } from "../../shared/contracts/search.js";
import { SEARCH_CATEGORIES, type SearchCategory } from "../../shared/contracts/search.js";
import { attachPetPlaces, mergePlaces } from "../../shared/rules/placeMerge.js";
import { AppError, toErrorResponse } from "./errors.js";
import { guardedCall } from "./policies/guardedCall.js";
import { quotaGuard, type QuotaGuard } from "./policies/quota.js";
import { RateLimiter } from "./policies/rateLimit.js";
import { TtlCache } from "./policies/ttlCache.js";
import { createKtoDetail, createKtoFeed, createKtoPetProvider, createMockDetail, createMockFeeds, createMockPetProvider, createVisitJejuFeed, type DetailProvider, type FeedProvider, type PetProvider, type SearchDetail, type SearchPet } from "./providers/tourSearch.js";

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
  detail: DetailProvider;
  pet: PetProvider;
  cache: TtlCache<SearchIndex>;
  detailCache: TtlCache<SearchDetail>;
  petCache: TtlCache<SearchPet>;
  guard: QuotaGuard;
  limiter: RateLimiter;
  now?: () => Date;
}

const FEED_CATEGORIES = ["ATTRACTION", "ACCOMMODATION", "RESTAURANT"] as const;

/**
 * 출처 선택: VISITJEJU_API_KEY가 있으면 비짓제주 3묶음, DATA_GO_KR_API_KEY가 있으면 관광공사 3묶음. 둘 다 없으면 모의.
 * 합칠 때 앞의 출처를 우선한다(비짓제주: 사진·소개·전화가 더 많음).
 */
export function selectSearchProviders(env: Record<string, string | undefined>): Pick<TrafficSearchDeps, "feeds" | "detail" | "pet"> {
  const vj = env.VISITJEJU_API_KEY?.trim();
  const kto = env.DATA_GO_KR_API_KEY;
  const feeds = [...(vj ? FEED_CATEGORIES.map((c) => createVisitJejuFeed(vj, c)) : []), ...(kto ? FEED_CATEGORIES.map((c) => createKtoFeed(kto, c)) : [])];
  return { feeds: feeds.length ? feeds : createMockFeeds(), detail: kto ? createKtoDetail(kto) : createMockDetail(), pet: kto ? createKtoPetProvider(kto) : createMockPetProvider() };
}

function clientKey(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return request.headers.get("x-real-ip") ?? (forwarded || "unknown");
}

/**
 * 묶음마다 따로 받는다. 하나가 실패해도 나머지로 목록을 만들고 빠진 묶음을 알린다. 모두 실패하면 오류.
 * 반려동물 동반여행 목록(TASK-030)은 합친 목록의 같은 장소에 붙이고, 없는 곳은 더한다.
 */
async function buildIndex(deps: TrafficSearchDeps): Promise<SearchIndex> {
  const [results, petResult] = await Promise.all([
    Promise.allSettled(
      deps.feeds.map((f) => {
        const provider = f.feed.source === "visitJeju" ? "visitJeju" : "kto";
        return guardedCall(deps.guard, provider, () => f.fetch(async (calls) => void (await deps.guard.reserve(provider, { cost: calls }))));
      }),
    ),
    guardedCall(deps.guard, "ktoPet", () => deps.pet.fetchList()).then(
      (rows) => ({ ok: true as const, rows }),
      (reason: unknown) => ({ ok: false as const, reason }),
    ),
  ]);
  const ok = results.flatMap((r) => (r.status === "fulfilled" ? [r.value] : []));
  if (!ok.length && !petResult.ok) {
    const reasons = [...results.flatMap((r) => (r.status === "rejected" ? [r.reason as unknown] : [])), petResult.reason];
    const blocked = reasons.find((r) => r instanceof AppError && r.code === "QUOTA_BLOCKED");
    throw blocked ?? new AppError("PROVIDER_UNAVAILABLE", "관광 정보를 가져올 수 없습니다.");
  }
  const places = mergePlaces(ok);
  if (petResult.ok) attachPetPlaces(places, petResult.rows);
  return {
    places,
    missing: [...deps.feeds.filter((_, i) => results[i]!.status === "rejected").map((f) => f.feed), ...(petResult.ok ? [] : [{ source: "ktoPet" as const }])],
    mock: deps.feeds.every((f) => f.mock === true),
  };
}

function parseCategory(v: string | null): SearchCategory | "ALL" {
  if (v === null || v === "" || v === "ALL") return "ALL";
  if ((SEARCH_CATEGORIES as string[]).includes(v)) return v as SearchCategory;
  throw new AppError("INVALID_INPUT", "카테고리가 올바르지 않습니다.");
}

/**
 * GET /api/traffic/search: 비짓제주·관광공사 장소를 합친 목록(검색·주변 계산은 화면에서). 카카오 실시간 검색은 TASK-031 5.(a)로 뺐다.
 * ?kto=콘텐츠 ID&cat=카테고리면 그 장소의 관광공사 소개정보(운영시간·쉬는날·주차·반려동물, 30일).
 * ?pet=콘텐츠 ID면 관광공사 반려동물 동반여행 상세(동반 유형·동반 가능 동물·필요 사항 등, 30일, TASK-030).
 */
export async function handleTrafficSearch(request: Request, deps: TrafficSearchDeps): Promise<Response> {
  const now = deps.now ?? (() => new Date());
  try {
    const params = new URL(request.url).searchParams;
    if (params.has("pet")) {
      const id = params.get("pet") ?? "";
      if (!/^(?:\d{1,12}|MOCK-K\d{1,3})$/.test(id)) throw new AppError("INVALID_INPUT", "장소 번호가 올바르지 않습니다.");
      const retry = deps.limiter.tryAcquire(clientKey(request));
      if (retry !== null) throw new AppError("QUOTA_BLOCKED", "검색 요청이 너무 잦습니다. 잠시 후 다시 시도하세요.", new Date(retry).toISOString());
      const d = await deps.petCache.getOrLoad(id, () => guardedCall(deps.guard, "ktoPet", () => deps.pet.fetchPet(id)));
      const body: SearchPetResponse = { ...d, builtAt: now().toISOString() };
      return Response.json(body, { headers: { "Cache-Control": `public, max-age=86400, s-maxage=${SEARCH_DETAIL_CDN_SECONDS}, stale-while-revalidate=86400` } });
    }
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
    const retryAt = deps.limiter.tryAcquire(clientKey(request));
    if (retryAt !== null) throw new AppError("QUOTA_BLOCKED", "검색 요청이 너무 잦습니다. 잠시 후 다시 시도하세요.", new Date(retryAt).toISOString());
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
  petCache: new TtlCache<SearchPet>(SEARCH_DETAIL_TTL_MS),
  guard: quotaGuard,
  limiter: new RateLimiter(TRAFFIC_SEARCH_PER_MINUTE, 60_000),
};
