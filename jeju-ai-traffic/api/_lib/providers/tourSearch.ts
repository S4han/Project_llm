import type { FeedCategory, PetTag, SearchCategory, SearchDetailResponse, SearchFeed, SearchPetResponse, SearchRow } from "../../../shared/contracts/search.js";
import { isInJeju } from "../../../shared/rules/geo.js";
import { ProviderError } from "../errors.js";
import { serviceKeyParam } from "./jejuCityEnforcement.js";
import { imageUrl, ktoItems, plainText } from "./ktoTour.js";
import { stayPhoto } from "./visitJejuStay.js";

/**
 * 관광 통합 검색(TASK-029)의 출처 어댑터. 출처마다 따로 실패하고(장애 격리) 같은 모양(SearchRow)으로 바꾼다.
 * TASK-029 시험: 비짓제주 관광지 c1 1,298곳(13쪽)·숙박 c3 916곳(10쪽)·음식점 c4 1,841곳(19쪽),
 * 한국관광공사 제주 음식점(39) 394곳. 카카오 실시간 검색은 TASK-031에서 뺐다.
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

/**
 * 반려동물 태그(범위 변경 2026-10-23). TASK-029 시험 표본에 "애견동반"이 있었다. "불가"·"금지"가 붙으면 불가.
 * 태그가 없으면 ""(모름). 없다고 불가로 보지 않는다.
 */
export function petTag(tags: string): PetTag {
  const t = tags.replace(/\s+/g, "");
  if (/(애견|반려동물|반려견|펫|애완동물|애완견)(동반|출입|입장)?(불가|금지)|노키즈펫/.test(t)) return "NO";
  if (/애견동반|반려동물동반|반려견동반|애완동물동반|펫프렌들리|애견카페|애견가능|반려동물가능|반려동물출입가|애견출입가|펫동반/i.test(t)) return "YES";
  return "";
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
const VJ_CODE: Record<FeedCategory, string> = { ATTRACTION: "c1", ACCOMMODATION: "c3", RESTAURANT: "c4" };
const VJ_MAX_PAGES = 25;
const VJ_PARALLEL = 4;

/** 비짓제주 목록 한 쪽 → 장소. 요청한 분류가 아니거나 좌표가 제주 밖이면 버린다. */
export function normalizeVisitJejuPage(body: unknown, category: FeedCategory): { rows: SearchRow[]; pageCount: number } {
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
    const alltag = text(i.alltag);
    rows.push([`visitJeju:${id}`, cat, name, text(i.roadaddress) || text(i.address), lat, lng, text(i.phoneno), stayPhoto(photo?.imgpath) || stayPhoto(photo?.thumbnailpath), clipIntro(plainText(i.introduction)), cleanTags(`${tag},${alltag}`), [["visitJeju", id]], /주차/.test(alltag), petTag(`${tag},${alltag}`)]);
  }
  return { rows, pageCount: Number(b?.pageCount) || 1 };
}

export function createVisitJejuFeed(apiKey: string, category: FeedCategory, fetchImpl: typeof fetch = fetch): FeedProvider {
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
const KTO_TYPE: Record<FeedCategory, string> = { ATTRACTION: "12", ACCOMMODATION: "32", RESTAURANT: "39" };
const KTO_PAGE_SIZE = 1000;

/** 관광공사 지역기반 목록 → 장소. 음식점(39) 가운데 분류가 카페·찻집(cat3 A05020900, 신분류 FD05)이면 카페. */
export function normalizeKtoPage(body: unknown, category: FeedCategory): { rows: SearchRow[]; totalCount: number } {
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
    rows.push([`kto:${id}`, cafe ? "CAFE" : category, name, [text(i.addr1), text(i.addr2)].filter(Boolean).join(" "), lat, lng, text(i.tel), photo, "", "", [["kto", id]], false, ""]);
  }
  return { rows, totalCount: Number(b?.response?.body?.totalCount) || list.length };
}

export function createKtoFeed(apiKey: string, category: FeedCategory, fetchImpl: typeof fetch = fetch): FeedProvider {
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

// ── 한국관광공사 소개정보(범위 변경 2026-10-23: 운영시간·주차·반려동물) ──
export type SearchDetail = Omit<SearchDetailResponse, "builtAt">;

export interface DetailProvider {
  fetchDetail(id: string, category: SearchCategory): Promise<SearchDetail>;
}

const KTO_INTRO = "https://apis.data.go.kr/B551011/KorService2/detailIntro2";
/** 카페는 관광공사에서 음식점(39)이다. */
export const ktoTypeOf = (c: SearchCategory) => (c === "CAFE" ? KTO_TYPE.RESTAURANT : KTO_TYPE[c]);

/**
 * 소개정보 → 운영시간·쉬는날·주차·반려동물·문의. 항목 이름은 분류마다 다르다:
 * 관광지 usetime·restdate·parking·chkpet·infocenter(TASK-026), 숙박 checkintime·checkouttime·parkinglodging·infocenterlodging(TASK-028 시험),
 * 음식점 opentimefood·restdatefood·parkingfood·infocenterfood(TASK-029 범위 변경 시험 2건: 카페 "가는곶 세화"·음식점 "가람돌솥밥"으로 확인).
 */
export function normalizeKtoIntro(id: string, category: SearchCategory, body: unknown): SearchDetail {
  const i = ktoItems(body).list[0] ?? {};
  const t = (k: string) => plainText(i[k]);
  if (category === "ATTRACTION") return { id, hours: t("usetime"), rest: t("restdate"), parking: t("parking"), pet: t("chkpet"), info: t("infocenter"), source: "kto" };
  if (category === "ACCOMMODATION") {
    const hours = [t("checkintime") && `입실 ${t("checkintime")}`, t("checkouttime") && `퇴실 ${t("checkouttime")}`].filter(Boolean).join("\n");
    return { id, hours, rest: "", parking: t("parkinglodging"), pet: "", info: t("infocenterlodging"), source: "kto" };
  }
  return { id, hours: t("opentimefood"), rest: t("restdatefood"), parking: t("parkingfood"), pet: "", info: t("infocenterfood"), source: "kto" };
}

export function createKtoDetail(apiKey: string, fetchImpl: typeof fetch = fetch): DetailProvider {
  return {
    async fetchDetail(id, category) {
      let res: Response;
      try {
        res = await fetchImpl(`${KTO_INTRO}?serviceKey=${serviceKeyParam(apiKey)}&MobileOS=ETC&MobileApp=JejuTraffic&_type=json&contentId=${encodeURIComponent(id)}&contentTypeId=${ktoTypeOf(category)}`, { signal: AbortSignal.timeout(TIMEOUT_MS) });
      } catch {
        throw new ProviderError("unavailable", "관광정보 연결 실패");
      }
      if (res.status === 429) throw new ProviderError("rate_limited", "관광정보 한도");
      if (!res.ok) throw new ProviderError("unavailable", `관광정보 HTTP ${res.status}`);
      try {
        return normalizeKtoIntro(id, category, await res.json());
      } catch (e) {
        throw e instanceof ProviderError ? e : new ProviderError("unavailable", "관광정보 응답 형식");
      }
    },
  };
}

/** 모의 소개정보(모의 사라봉·모의 흑돼지). 실제 정보가 아니다. */
export function createMockDetail(): DetailProvider & { calls: number } {
  const rows: Record<string, Omit<SearchDetail, "id" | "source">> = {
    "MOCK-K1": { hours: "상시 개방", rest: "연중무휴", parking: "가능 (승용차 30대)", pet: "가능 (목줄 착용)", info: "모의 안내소 064-000-0020" },
    "MOCK-K2": { hours: "11:00~21:00", rest: "매주 화요일", parking: "불가", pet: "", info: "" },
  };
  return {
    calls: 0,
    async fetchDetail(id) {
      this.calls += 1;
      return { id, ...(rows[id] ?? { hours: "", rest: "", parking: "", pet: "", info: "" }), source: "mock" };
    },
  };
}

// ── 한국관광공사 반려동물 동반여행(TASK-030) ─────────────────
/**
 * End Point https://apis.data.go.kr/B551011/KorPetTourService2(사용자 캡처). TASK-030 시험: 제주(areaCode 39) 17곳
 * (관광지 12 11곳·문화시설 14 1곳·레포츠 28 3곳·숙박 32 2곳), 목록 항목은 국문 관광정보와 같고 번호도 같은 체계로 보인다.
 * 등록되지 않은 번호로 상세를 부르면 빈 목록(오류 아님).
 */
const PET_BASE = "https://apis.data.go.kr/B551011/KorPetTourService2";
/** 관광 타입 → 검색 카테고리. 숙박 32, 음식점 39, 그 밖(관광지·문화시설·레포츠·축제·코스·쇼핑)은 관광지. */
export function petCategory(contentTypeId: string, cat3: string, lcls2: string): SearchCategory {
  if (contentTypeId === "32") return "ACCOMMODATION";
  if (contentTypeId === "39") return cat3 === "A05020900" || lcls2 === "FD05" ? "CAFE" : "RESTAURANT";
  return "ATTRACTION";
}

/** 반려동물 동반 장소 목록 → 장소(출처 ktoPet, 반려동물 "YES"). */
export function normalizeKtoPetPage(body: unknown): SearchRow[] {
  const rows: SearchRow[] = [];
  for (const i of ktoItems(body).list) {
    const id = text(i.contentid);
    const name = plainText(i.title);
    const lat = Number(i.mapy);
    const lng = Number(i.mapx);
    if (!id || !name || !isInJeju({ lat, lng })) continue;
    const cp = text(i.cpyrhtDivCd);
    const photo = cp === "Type1" || cp === "Type3" ? imageUrl(i.firstimage) : "";
    rows.push([`ktoPet:${id}`, petCategory(text(i.contenttypeid), text(i.cat3), text(i.lclsSystm2)), name, [text(i.addr1), text(i.addr2)].filter(Boolean).join(" "), lat, lng, text(i.tel), photo, "", "", [["ktoPet", id]], false, "YES"]);
  }
  return rows;
}

export type SearchPet = Omit<SearchPetResponse, "builtAt">;

/** 반려동물 상세 → 동반 유형·동반 가능 동물·필요 사항 등. 등록되지 않았으면 모두 "". */
export function normalizeKtoPet(id: string, body: unknown): SearchPet {
  const i = ktoItems(body).list[0] ?? {};
  const t = (k: string) => plainText(i[k]);
  return { id, type: t("acmpyTypeCd"), animals: t("acmpyPsblCpam"), need: t("acmpyNeedMtr"), etc: t("etcAcmpyInfo"), facilities: t("relaPosesFclty"), furnish: t("relaFrnshPrdlst"), rental: t("relaRntlPrdlst"), purchase: t("relaPurcPrdlst"), risk: t("relaAcdntRiskMtr"), source: "ktoPet" };
}

export interface PetProvider {
  fetchList(): Promise<SearchRow[]>;
  fetchPet(id: string): Promise<SearchPet>;
}

export function createKtoPetProvider(apiKey: string, fetchImpl: typeof fetch = fetch): PetProvider {
  const get = async (op: string, params: string) => {
    let res: Response;
    try {
      res = await fetchImpl(`${PET_BASE}/${op}?serviceKey=${serviceKeyParam(apiKey)}&MobileOS=ETC&MobileApp=JejuTraffic&_type=json&${params}`, { signal: AbortSignal.timeout(TIMEOUT_MS) });
    } catch {
      throw new ProviderError("unavailable", "반려동물 동반여행 연결 실패");
    }
    if (res.status === 429) throw new ProviderError("rate_limited", "반려동물 동반여행 한도");
    if (!res.ok) throw new ProviderError("unavailable", `반려동물 동반여행 HTTP ${res.status}`);
    try {
      return await res.json();
    } catch {
      throw new ProviderError("unavailable", "반려동물 동반여행 응답 형식");
    }
  };
  return {
    // 제주 17곳(시험)이라 한 쪽(1,000곳)이면 된다.
    fetchList: async () => normalizeKtoPetPage(await get("areaBasedList2", "areaCode=39&numOfRows=1000&pageNo=1&arrange=A")),
    fetchPet: async (id) => normalizeKtoPet(id, await get("detailPetTour2", `contentId=${encodeURIComponent(id)}`)),
  };
}

/** 모의 반려동물 동반 장소: 모의 사라봉(관광공사 MOCK-K1과 같은 번호) + 목록에 없는 모의 승마장. 실제 정보가 아니다. */
export function createMockPetProvider(): PetProvider & { calls: number } {
  const rows: SearchRow[] = [
    ["ktoPet:MOCK-K1", "ATTRACTION", "모의 사라봉", "제주시 모의동 20-1", 33.5139, 126.545, "", "", "", "", [["ktoPet", "MOCK-K1"]], false, "YES"],
    ["ktoPet:MOCK-K9", "ATTRACTION", "모의 반려 승마장", "제주시 모의동 90", 33.4955, 126.5205, "064-000-0090", "", "", "", [["ktoPet", "MOCK-K9"]], false, "YES"],
  ];
  const pets: Record<string, Omit<SearchPet, "id" | "source">> = {
    "MOCK-K1": { type: "전구역 동반가능", animals: "전 견종 동반 가능", need: "목줄 착용", etc: "- 배변봉투 지참", facilities: "", furnish: "", rental: "", purchase: "", risk: "" },
    "MOCK-K9": { type: "일부구역 동반가능", animals: "소형견", need: "목줄·입마개", etc: "", facilities: "반려견 놀이터", furnish: "배변봉투", rental: "", purchase: "", risk: "" },
  };
  const empty = { type: "", animals: "", need: "", etc: "", facilities: "", furnish: "", rental: "", purchase: "", risk: "" };
  return {
    calls: 0,
    async fetchList() {
      this.calls += 1;
      return rows.map((r) => [...r] as SearchRow);
    },
    async fetchPet(id) {
      this.calls += 1;
      return { id, ...(pets[id] ?? empty), source: "mock" as const };
    },
  };
}

// ── 개발용 모의 ───────────────────────────────────────────
/** 모의 장소(실제 장소가 아니다). 비짓제주·관광공사에 같은 "모의 사라봉"이 있어 합치기를 확인할 수 있다. */
export function createMockFeeds(): FeedProvider[] {
  const vj: Record<FeedCategory, SearchRow[]> = {
    ATTRACTION: [
      ["visitJeju:MOCK-V1", "ATTRACTION", "모의 사라봉", "제주시 모의동 20", 33.5136, 126.5446, "064-000-0020", "", "모의 오름 산책길", "오름,산책", [["visitJeju", "MOCK-V1"]], true, ""],
      ["visitJeju:MOCK-V2", "ATTRACTION", "모의 성산 일출봉", "서귀포시 모의동 40", 33.4585, 126.9425, "", "", "모의 해돋이 명소", "자연경관,해돋이", [["visitJeju", "MOCK-V2"]], false, ""],
    ],
    ACCOMMODATION: [["visitJeju:MOCK-V3", "ACCOMMODATION", "모의 신산 호텔", "제주시 모의동 30", 33.5055, 126.5405, "064-000-0030", "", "모의 시내 호텔", "호텔,조식", [["visitJeju", "MOCK-V3"]], false, ""]],
    RESTAURANT: [
      ["visitJeju:MOCK-V4", "RESTAURANT", "모의 고기국수", "제주시 모의동 50", 33.5005, 126.5305, "064-000-0050", "", "모의 국수집", "국수,한식", [["visitJeju", "MOCK-V4"]], true, "NO"],
      ["visitJeju:MOCK-V5", "CAFE", "모의 바다 카페", "제주시 모의동 51", 33.5165, 126.5255, "", "", "모의 바다 앞 카페", "카페,오션뷰,애견동반", [["visitJeju", "MOCK-V5"]], true, "YES"],
    ],
  };
  const kto: Record<FeedCategory, SearchRow[]> = {
    ATTRACTION: [["kto:MOCK-K1", "ATTRACTION", "모의 사라봉 (제주시)", "제주시 모의동 20-1", 33.5139, 126.545, "", "", "", "", [["kto", "MOCK-K1"]], false, ""]],
    ACCOMMODATION: [],
    RESTAURANT: [["kto:MOCK-K2", "RESTAURANT", "모의 흑돼지", "제주시 모의동 60", 33.4985, 126.5285, "064-000-0060", "", "", "", [["kto", "MOCK-K2"]], false, ""]],
  };
  return (["visitJeju", "kto"] as const).flatMap((source) =>
    (["ATTRACTION", "ACCOMMODATION", "RESTAURANT"] as const).map((category) => ({ feed: { source, category }, mock: true, fetch: async () => (source === "visitJeju" ? vj : kto)[category] })),
  );
}
