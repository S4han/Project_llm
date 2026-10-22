import type { SearchCategory, SearchFeed, SearchRow } from "../../../shared/contracts/search.js";
import { isInJeju, isJejuAddress, JEJU_BOUNDS } from "../../../shared/rules/geo.js";
import { ProviderError } from "../errors.js";
import { serviceKeyParam } from "./jejuCityEnforcement.js";
import { imageUrl, plainText } from "./ktoTour.js";
import { stayPhoto } from "./visitJejuStay.js";

/**
 * 관광 통합 검색(TASK-029)의 출처 어댑터. 출처마다 따로 실패하고(장애 격리) 같은 모양(SearchRow)으로 바꾼다.
 * TASK-029 시험: 비짓제주 관광지 c1 1,298곳(13쪽)·숙박 c3 916곳(10쪽)·음식점 c4 1,841곳(19쪽),
 * 한국관광공사 제주 음식점(39) 394곳, 카카오 로컬 카페(CE7) 정상.
 */
const TIMEOUT_MS = 20_000;
const INTRO_MAX = 120;
const TAGS_MAX = 8;

const text = (v: unknown) => String(v ?? "").trim();
const clipIntro = (v: string) => (v.length > INTRO_MAX ? `${v.slice(0, INTRO_MAX - 1)}…` : v).replace(/\s+/g, " ");
/** 쉼표 태그를 다듬어 앞에서 8개만. 결제·화장실 같은 시설 태그는 뺀다. */
export function cleanTags(v: string): string {
  const out: string[] = [];
  for (const t of v.split(",").map((s) => s.trim())) {
    if (!t || out.includes(t) || /결제|WIFI|화장실|음료대|안내시설|피난시설|어려움|^영어|Staff/i.test(t)) continue;
    out.push(t);
    if (out.length >= TAGS_MAX) break;
  }
  return out.join(",");
}

/** 비짓제주 음식점(c4) 가운데 카페: 이름·태그에 카페·커피·디저트·베이커리가 있으면. */
const CAFE_WORDS = /카페|커피|디저트|베이커리|cafe|coffee/i;

export interface FeedProvider {
  readonly feed: SearchFeed;
  /** 개발용 모의 묶음이면 true. */
  readonly mock?: boolean;
  /** reserve는 첫 쪽에서 전체 쪽 수를 알게 된 뒤 남은 호출 수를 사용량에 예약한다. */
  fetch(reserve: (calls: number) => Promise<void>): Promise<SearchRow[]>;
}

// ── 비짓제주 ──────────────────────────────────────────────
const VJ_BASE = "https://api.visitjeju.net/vsjApi/contents/searchList";
const VJ_CODE: Record<SearchFeed["category"], string> = { ATTRACTION: "c1", ACCOMMODATION: "c3", RESTAURANT: "c4" };
const VJ_MAX_PAGES = 25;
const VJ_PARALLEL = 4;

/** 비짓제주 목록 한 쪽 → 장소. 요청한 분류가 아니거나 좌표가 제주 밖이면 버린다. */
export function normalizeVisitJejuPage(body: unknown, category: SearchFeed["category"]): { rows: SearchRow[]; pageCount: number } {
  const b = body as { result?: unknown; pageCount?: unknown; items?: unknown } | null;
  const code = text(b?.result);
  if (code !== "200") throw new ProviderError(code === "429" ? "rate_limited" : "unavailable", `비짓제주 응답 오류 ${code || "형식"}`);
  const rows: SearchRow[] = [];
  for (const i of (Array.isArray(b?.items) ? b.items : []) as Record<string, unknown>[]) {
    const id = text(i.contentsid);
    const name = plainText(i.title);
    const lat = Number(i.latitude);
    const lng = Number(i.longitude);
    if ((i.contentscd as { value?: unknown } | undefined)?.value !== VJ_CODE[category] || !id || !name || !isInJeju({ lat, lng })) continue;
    const tag = text(i.tag);
    const photo = (i.repPhoto as { photoid?: { thumbnailpath?: unknown; imgpath?: unknown } } | undefined)?.photoid;
    const cat: SearchCategory = category === "RESTAURANT" && CAFE_WORDS.test(`${name},${tag}`) ? "CAFE" : category;
    rows.push([`visitJeju:${id}`, cat, name, text(i.roadaddress) || text(i.address), lat, lng, text(i.phoneno), stayPhoto(photo?.imgpath) || stayPhoto(photo?.thumbnailpath), clipIntro(plainText(i.introduction)), cleanTags(`${tag},${text(i.alltag)}`), [["visitJeju", id]]]);
  }
  return { rows, pageCount: Number(b?.pageCount) || 1 };
}

export function createVisitJejuFeed(apiKey: string, category: SearchFeed["category"], fetchImpl: typeof fetch = fetch): FeedProvider {
  const page = async (n: number) => {
    let res: Response;
    try {
      res = await fetchImpl(`${VJ_BASE}?apiKey=${encodeURIComponent(apiKey)}&locale=kr&category=${VJ_CODE[category]}&page=${n}`, { signal: AbortSignal.timeout(TIMEOUT_MS) });
    } catch {
      throw new ProviderError("unavailable", "비짓제주 연결 실패");
    }
    if (res.status === 429) throw new ProviderError("rate_limited", "비짓제주 한도");
    if (!res.ok) throw new ProviderError("unavailable", `비짓제주 HTTP ${res.status}`);
    try {
      return normalizeVisitJejuPage(await res.json(), category);
    } catch (e) {
      throw e instanceof ProviderError ? e : new ProviderError("unavailable", "비짓제주 응답 형식");
    }
  };
  return {
    feed: { source: "visitJeju", category },
    async fetch(reserve) {
      const first = await page(1);
      const rows = [...first.rows];
      const pages = Math.min(VJ_MAX_PAGES, first.pageCount);
      if (pages > 1) await reserve(pages - 1);
      // 남은 쪽은 4개씩 함께 받는다(함수 실행 시간 제한 60초 안).
      for (let n = 2; n <= pages; n += VJ_PARALLEL) {
        const batch = await Promise.all(Array.from({ length: Math.min(VJ_PARALLEL, pages - n + 1) }, (_, k) => page(n + k)));
        for (const p of batch) rows.push(...p.rows);
      }
      return rows;
    },
  };
}

// ── 한국관광공사 ──────────────────────────────────────────
const KTO_BASE = "https://apis.data.go.kr/B551011/KorService2/areaBasedList2";
const KTO_TYPE: Record<SearchFeed["category"], string> = { ATTRACTION: "12", ACCOMMODATION: "32", RESTAURANT: "39" };
const KTO_PAGE_SIZE = 1000;

/** 관광공사 지역기반 목록 → 장소. 음식점(39) 가운데 분류가 카페·찻집(cat3 A05020900, 신분류 FD05)이면 카페. */
export function normalizeKtoPage(body: unknown, category: SearchFeed["category"]): { rows: SearchRow[]; totalCount: number } {
  const b = body as { response?: { header?: { resultCode?: unknown }; body?: { totalCount?: unknown; items?: { item?: unknown } | string } } } | null;
  const code = text(b?.response?.header?.resultCode);
  if (code !== "0000") throw new ProviderError(code === "22" ? "rate_limited" : "unavailable", `관광정보 응답 오류 ${code || "형식"}`);
  const raw = typeof b?.response?.body?.items === "object" ? b.response.body.items.item : undefined;
  const list = (Array.isArray(raw) ? raw : raw ? [raw] : []) as Record<string, unknown>[];
  const rows: SearchRow[] = [];
  for (const i of list) {
    const id = text(i.contentid);
    const name = plainText(i.title);
    const lat = Number(i.mapy);
    const lng = Number(i.mapx);
    if (!id || !name || !isInJeju({ lat, lng })) continue;
    const cafe = category === "RESTAURANT" && (text(i.cat3) === "A05020900" || text(i.lclsSystm2) === "FD05");
    const cp = text(i.cpyrhtDivCd);
    // 사진은 공공누리 1·3유형만(TASK-026과 같이). 출처 표시는 화면에서.
    const photo = cp === "Type1" || cp === "Type3" ? imageUrl(i.firstimage) : "";
    rows.push([`kto:${id}`, cafe ? "CAFE" : category, name, [text(i.addr1), text(i.addr2)].filter(Boolean).join(" "), lat, lng, text(i.tel), photo, "", "", [["kto", id]]]);
  }
  return { rows, totalCount: Number(b?.response?.body?.totalCount) || list.length };
}

export function createKtoFeed(apiKey: string, category: SearchFeed["category"], fetchImpl: typeof fetch = fetch): FeedProvider {
  return {
    feed: { source: "kto", category },
    async fetch(reserve) {
      const rows: SearchRow[] = [];
      for (let n = 1; n <= 3; n++) {
        if (n > 1) await reserve(1);
        let res: Response;
        try {
          res = await fetchImpl(`${KTO_BASE}?serviceKey=${serviceKeyParam(apiKey)}&MobileOS=ETC&MobileApp=JejuTraffic&_type=json&areaCode=39&contentTypeId=${KTO_TYPE[category]}&numOfRows=${KTO_PAGE_SIZE}&pageNo=${n}&arrange=A`, { signal: AbortSignal.timeout(TIMEOUT_MS) });
        } catch {
          throw new ProviderError("unavailable", "관광정보 연결 실패");
        }
        if (res.status === 429) throw new ProviderError("rate_limited", "관광정보 한도");
        if (!res.ok) throw new ProviderError("unavailable", `관광정보 HTTP ${res.status}`);
        let page: ReturnType<typeof normalizeKtoPage>;
        try {
          page = normalizeKtoPage(await res.json(), category);
        } catch (e) {
          throw e instanceof ProviderError ? e : new ProviderError("unavailable", "관광정보 응답 형식");
        }
        rows.push(...page.rows);
        if (n * KTO_PAGE_SIZE >= page.totalCount) break;
      }
      return rows;
    },
  };
}

// ── 카카오 로컬(실시간, 저장하지 않음) ─────────────────────
const KAKAO_GROUP: Partial<Record<string, SearchCategory>> = { FD6: "RESTAURANT", CE7: "CAFE", AT4: "ATTRACTION", AD5: "ACCOMMODATION" };
export const KAKAO_CODE: Partial<Record<SearchCategory, string>> = { RESTAURANT: "FD6", CAFE: "CE7" };

/** 카카오 키워드·카테고리 검색 응답 → 음식점·카페(그 밖의 분류와 제주 밖은 버림). */
export function normalizeKakaoSearch(body: unknown): SearchRow[] {
  const documents = (body as { documents?: unknown } | null)?.documents;
  if (!Array.isArray(documents)) throw new ProviderError("unavailable", "kakaoLocal: documents 없음");
  const rows: SearchRow[] = [];
  for (const d of documents as Record<string, unknown>[]) {
    const id = text(d.id);
    const name = text(d.place_name);
    const lat = Number.parseFloat(text(d.y));
    const lng = Number.parseFloat(text(d.x));
    const address = text(d.road_address_name) || text(d.address_name);
    const cat = KAKAO_GROUP[text(d.category_group_code)];
    if (!id || !name || (cat !== "RESTAURANT" && cat !== "CAFE") || !isInJeju({ lat, lng }) || !isJejuAddress(text(d.address_name))) continue;
    const kind = text(d.category_name).split(">").map((s) => s.trim()).filter(Boolean).slice(1).join(",");
    rows.push([`kakaoLocal:${id}`, cat, name, address, lat, lng, text(d.phone), "", "", kind, [["kakaoLocal", id]]]);
  }
  return rows;
}

export interface LiveSearchProvider {
  /** 검색어(있으면 키워드 검색) 또는 기준 위치(카테고리 검색, 반경 3km). codes는 FD6·CE7 가운데 부를 것. 호출 수 = codes 수(검색어면 1). */
  search(input: { q: string; codes: string[]; origin: { lat: number; lng: number } | null; radius: number }): Promise<SearchRow[]>;
}

export function createKakaoLiveProvider(apiKey: string, fetchImpl: typeof fetch = fetch): LiveSearchProvider {
  const get = async (url: URL) => {
    let res: Response;
    try {
      res = await fetchImpl(url, { headers: { Authorization: `KakaoAK ${apiKey}` }, signal: AbortSignal.timeout(5000) });
    } catch {
      throw new ProviderError("unavailable", "kakaoLocal 연결 실패");
    }
    if (res.status === 429) throw new ProviderError("rate_limited", "kakaoLocal 429");
    if (!res.ok) throw new ProviderError("unavailable", `kakaoLocal ${res.status}`);
    return normalizeKakaoSearch(await res.json());
  };
  const rect = [JEJU_BOUNDS.minLng, JEJU_BOUNDS.minLat, JEJU_BOUNDS.maxLng, JEJU_BOUNDS.maxLat].join(",");
  return {
    async search({ q, codes, origin, radius }) {
      if (q) {
        const url = new URL("https://dapi.kakao.com/v2/local/search/keyword.json");
        url.searchParams.set("query", q);
        url.searchParams.set("size", "15");
        if (codes.length === 1) url.searchParams.set("category_group_code", codes[0]!);
        if (origin) {
          url.searchParams.set("x", String(origin.lng));
          url.searchParams.set("y", String(origin.lat));
        } else url.searchParams.set("rect", rect);
        return get(url);
      }
      if (!origin) return [];
      const lists = await Promise.all(
        codes.map((code) => {
          const url = new URL("https://dapi.kakao.com/v2/local/search/category.json");
          url.searchParams.set("category_group_code", code);
          url.searchParams.set("x", String(origin.lng));
          url.searchParams.set("y", String(origin.lat));
          url.searchParams.set("radius", String(radius));
          url.searchParams.set("sort", "distance");
          url.searchParams.set("size", "15");
          return get(url);
        }),
      );
      return lists.flat();
    },
  };
}

// ── 개발용 모의 ───────────────────────────────────────────
/** 모의 장소(실제 장소가 아니다). 비짓제주·관광공사에 같은 "모의 사라봉"이 있어 합치기를 확인할 수 있다. */
export function createMockFeeds(): FeedProvider[] {
  const vj: Record<SearchFeed["category"], SearchRow[]> = {
    ATTRACTION: [
      ["visitJeju:MOCK-V1", "ATTRACTION", "모의 사라봉", "제주시 모의동 20", 33.5136, 126.5446, "064-000-0020", "", "모의 오름 산책길", "오름,산책", [["visitJeju", "MOCK-V1"]]],
      ["visitJeju:MOCK-V2", "ATTRACTION", "모의 성산 일출봉", "서귀포시 모의동 40", 33.4585, 126.9425, "", "", "모의 해돋이 명소", "자연경관,해돋이", [["visitJeju", "MOCK-V2"]]],
    ],
    ACCOMMODATION: [["visitJeju:MOCK-V3", "ACCOMMODATION", "모의 신산 호텔", "제주시 모의동 30", 33.5055, 126.5405, "064-000-0030", "", "모의 시내 호텔", "호텔,조식", [["visitJeju", "MOCK-V3"]]]],
    RESTAURANT: [
      ["visitJeju:MOCK-V4", "RESTAURANT", "모의 고기국수", "제주시 모의동 50", 33.5005, 126.5305, "064-000-0050", "", "모의 국수집", "국수,한식", [["visitJeju", "MOCK-V4"]]],
      ["visitJeju:MOCK-V5", "CAFE", "모의 바다 카페", "제주시 모의동 51", 33.5165, 126.5255, "", "", "모의 바다 앞 카페", "카페,오션뷰", [["visitJeju", "MOCK-V5"]]],
    ],
  };
  const kto: Record<SearchFeed["category"], SearchRow[]> = {
    ATTRACTION: [["kto:MOCK-K1", "ATTRACTION", "모의 사라봉 (제주시)", "제주시 모의동 20-1", 33.5139, 126.545, "", "", "", "", [["kto", "MOCK-K1"]]]],
    ACCOMMODATION: [],
    RESTAURANT: [["kto:MOCK-K2", "RESTAURANT", "모의 흑돼지", "제주시 모의동 60", 33.4985, 126.5285, "064-000-0060", "", "", "", [["kto", "MOCK-K2"]]]],
  };
  return (["visitJeju", "kto"] as const).flatMap((source) =>
    (["ATTRACTION", "ACCOMMODATION", "RESTAURANT"] as const).map((category) => ({ feed: { source, category }, mock: true, fetch: async () => (source === "visitJeju" ? vj : kto)[category] })),
  );
}

export function createMockLiveProvider(): LiveSearchProvider & { calls: number } {
  const rows: SearchRow[] = [
    ["kakaoLocal:MOCK-L1", "CAFE", "모의 시청 커피", "제주시 모의동 70", 33.4995, 126.5315, "064-000-0070", "", "", "카페,커피전문점", [["kakaoLocal", "MOCK-L1"]]],
    ["kakaoLocal:MOCK-L2", "RESTAURANT", "모의 고기국수", "제주시 모의동 50", 33.5006, 126.5307, "064-000-0050", "", "", "한식,국수", [["kakaoLocal", "MOCK-L2"]]],
  ];
  return {
    calls: 0,
    async search({ q, codes }) {
      this.calls += 1;
      const want = new Set<SearchCategory>(codes.map((c) => (c === "CE7" ? "CAFE" : "RESTAURANT")));
      return rows.filter((r) => want.has(r[1]) && (!q || r[2].includes(q) || r[9].includes(q)));
    },
  };
}
