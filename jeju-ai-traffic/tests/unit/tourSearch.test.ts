import { describe, expect, it } from "vitest";
import { DEFAULT_BUDGETS, MemoryQuotaStore, QuotaGuard } from "../../api/_lib/policies/quota";
import { RateLimiter } from "../../api/_lib/policies/rateLimit";
import { TtlCache } from "../../api/_lib/policies/ttlCache";
import { cleanTags, createKakaoLiveProvider, createKtoDetail, createKtoFeed, createMockDetail, createMockFeeds, createMockLiveProvider, createVisitJejuFeed, normalizeKakaoSearch, normalizeKtoIntro, normalizeKtoPage, normalizeVisitJejuPage, petTag, type FeedProvider } from "../../api/_lib/providers/tourSearch";
import { handleTrafficSearch, SEARCH_PARTIAL_TTL_MS, selectSearchProviders, type TrafficSearchDeps } from "../../api/_lib/trafficSearch";
import type { SearchDetailResponse, SearchIndexResponse, SearchLiveResponse, SearchRow } from "../../shared/contracts/search";
import { mergePlaces, normalizePlaceName } from "../../shared/rules/placeMerge";
import { matchScore, searchPlaces } from "../../shared/rules/placeSearch";

const NOW = new Date("2026-10-22T23:00:00.000Z");
// TASK-029 시험 응답 표본(비짓제주 c4 "아줄레주", 관광공사 39 "가는곶 세화", 카카오 CE7)
const VJ_ITEM = {
  alltag: "제주동쪽맛집, 에그타르트, 성산카페,현금결제,카드결제,화장실,무료 WIFI,공용주차장",
  contentsid: "CNTS_200000000008044",
  contentscd: { value: "c4", label: "음식점" },
  title: "아줄레주",
  address: "제주특별자치도 서귀포시 성산읍 신풍리 627",
  roadaddress: "제주특별자치도 서귀포시 성산읍 신풍하동로19번길 59",
  tag: "제주동쪽맛집, 에그타르트, 성산카페",
  introduction: "에그타르트로 유명한 유럽풍의 카페\r\n",
  latitude: 33.3668229,
  longitude: 126.8391408,
  phoneno: "0507-1411-4052",
  repPhoto: { photoid: { imgpath: "https://api.cdn.visitjeju.net/photomng/imgpath/202410/17/c.webp", thumbnailpath: "https://api.cdn.visitjeju.net/photomng/thumbnailpath/t.webp" } },
};
const vjPage = (items: unknown[], pageCount = 1) => ({ result: "200", totalCount: items.length, pageCount, items });
const KTO_ITEM = { addr1: "제주특별자치도 제주시 구좌읍 세화14길 3", addr2: "", cat3: "A05020900", contentid: "2850913", firstimage: "http://tong.visitkorea.or.kr/cms/resource/05/2850905_image2_1.jpg", cpyrhtDivCd: "Type3", mapx: "126.8606961680", mapy: "33.5205279098", tel: "", title: "가는곶 세화", lclsSystm2: "FD05" };
const ktoPage = (item: unknown, totalCount = 1) => ({ response: { header: { resultCode: "0000", resultMsg: "OK" }, body: { totalCount, items: { item } } } });
const KAKAO_DOC = { address_name: "제주특별자치도 제주시 이도이동 1771-5", category_group_code: "CE7", category_name: "음식점 > 카페 > 커피전문점", id: "1219335616", phone: "", place_name: "레드버튼 제주시청점", road_address_name: "제주특별자치도 제주시 광양10길 10", x: "126.529033277888", y: "33.4992448369791" };

const row = (id: string, cat: SearchRow[1], name: string, lat: number, lng: number, source: SearchRow[10][number][0], extra: Partial<{ phone: string; photo: string; intro: string; address: string }> = {}): SearchRow => [
  `${source}:${id}`,
  cat,
  name,
  extra.address ?? "",
  lat,
  lng,
  extra.phone ?? "",
  extra.photo ?? "",
  extra.intro ?? "",
  "",
  [[source, id]],
  false,
  "",
];

describe("관광 통합 검색 출처 어댑터 (TASK-029)", () => {
  it("비짓제주: 요청한 분류만, 음식점 가운데 카페·커피·디저트는 카페, 시설 태그 제외, 소개 정리", () => {
    const { rows, pageCount } = normalizeVisitJejuPage(vjPage([VJ_ITEM, { ...VJ_ITEM, contentsid: "x1", contentscd: { value: "c1" } }, { ...VJ_ITEM, contentsid: "x2", title: "고기국수집", tag: "국수", alltag: "국수", latitude: 37.5 }, { ...VJ_ITEM, contentsid: "x3", title: "고기국수집", tag: "국수,한식", alltag: "" }], 19), "RESTAURANT");
    expect(pageCount).toBe(19);
    expect(rows).toEqual([
      ["visitJeju:CNTS_200000000008044", "CAFE", "아줄레주", VJ_ITEM.roadaddress, 33.3668229, 126.8391408, "0507-1411-4052", VJ_ITEM.repPhoto.photoid.imgpath, "에그타르트로 유명한 유럽풍의 카페", "제주동쪽맛집,에그타르트,성산카페,공용주차장", [["visitJeju", "CNTS_200000000008044"]], true, ""],
      ["visitJeju:x3", "RESTAURANT", "고기국수집", VJ_ITEM.roadaddress, 33.3668229, 126.8391408, "0507-1411-4052", VJ_ITEM.repPhoto.photoid.imgpath, "에그타르트로 유명한 유럽풍의 카페", "국수,한식", [["visitJeju", "x3"]], false, ""],
    ]);
    expect(() => normalizeVisitJejuPage({ result: "403" }, "ATTRACTION")).toThrow(/403/);
    expect(cleanTags("a,a,카드결제,무료 WIFI,b")).toBe("a,b");
  });

  it("반려동물 태그(범위 변경): 애견동반 등은 가능, 불가·금지가 붙으면 불가, 없으면 모름", () => {
    expect(petTag("제주카페, 애견동반, 제주서쪽")).toBe("YES");
    expect(petTag("반려동물 동반 가능,카페")).toBe("YES");
    expect(petTag("애견 동반 불가,카페")).toBe("NO");
    expect(petTag("반려동물 출입금지")).toBe("NO");
    expect(petTag("카페,오션뷰")).toBe("");
    // 시설 태그가 많아 특징 8개에서 잘려도 반려동물·주차는 전체 태그로 판단한다
    const many = { ...VJ_ITEM, tag: "a,b,c,d,e,f,g,h,i", alltag: "a,b,c,d,e,f,g,h,i,공용주차장,애견동반" };
    expect(normalizeVisitJejuPage(vjPage([many]), "RESTAURANT").rows[0]?.slice(11)).toEqual([true, "YES"]);
  });

  it("관광공사 소개정보(범위 변경): 분류마다 다른 항목을 운영시간·쉬는날·주차·반려동물·문의로", async () => {
    const intro = (item: unknown) => ktoPage(item);
    expect(normalizeKtoIntro("1", "ATTRACTION", intro({ usetime: "09:00~18:00<br>", restdate: "연중무휴", parking: "가능", chkpet: "불가", infocenter: "064" }))).toEqual({ id: "1", hours: "09:00~18:00", rest: "연중무휴", parking: "가능", pet: "불가", info: "064", source: "kto" });
    expect(normalizeKtoIntro("2", "ACCOMMODATION", intro({ checkintime: "15:00", checkouttime: "11:00", parkinglodging: "가능", infocenterlodging: "064-1" }))).toEqual({ id: "2", hours: "입실 15:00\n퇴실 11:00", rest: "", parking: "가능", pet: "", info: "064-1", source: "kto" });
    expect(normalizeKtoIntro("3", "CAFE", intro({ opentimefood: "10:00~20:00", restdatefood: "화요일", parkingfood: "불가", infocenterfood: "064-2" }))).toEqual({ id: "3", hours: "10:00~20:00", rest: "화요일", parking: "불가", pet: "", info: "064-2", source: "kto" });
    // 시험 응답 표본(가람돌솥밥)
    expect(normalizeKtoIntro("2755053", "RESTAURANT", intro({ opentimefood: "- 08:30~21:00<br>- 준비시간 16:00~17:00<br>- 마지막 주문 20:00", restdatefood: "연중무휴", parkingfood: "가능", infocenterfood: "0507-1432-1200" })).hours).toBe("- 08:30~21:00\n- 준비시간 16:00~17:00\n- 마지막 주문 20:00");
    const urls: string[] = [];
    await createKtoDetail("k", (async (u: string) => (urls.push(u), Response.json(intro({ opentimefood: "a" })))) as unknown as typeof fetch).fetchDetail("2850913", "CAFE");
    expect(urls[0]).toContain("/detailIntro2?");
    expect(urls[0]).toContain("contentId=2850913&contentTypeId=39");
  });

  it("비짓제주 묶음: 분류 코드로 부르고 남은 쪽은 예약 뒤 받는다", async () => {
    const urls: URL[] = [];
    const fetchImpl = (async (u: string) => {
      const url = new URL(u);
      urls.push(url);
      return Response.json(vjPage([{ ...VJ_ITEM, contentscd: { value: "c1" }, contentsid: `P${url.searchParams.get("page")}` }], 6));
    }) as unknown as typeof fetch;
    const reserved: number[] = [];
    const rows = await createVisitJejuFeed("k", "ATTRACTION", fetchImpl).fetch(async (n) => void reserved.push(n));
    expect(reserved).toEqual([5]);
    expect(urls.map((u) => u.searchParams.get("page"))).toEqual(["1", "2", "3", "4", "5", "6"]);
    expect(urls.every((u) => u.protocol === "https:" && u.searchParams.get("category") === "c1")).toBe(true);
    expect(rows.map((r) => r[0])).toEqual(["visitJeju:P1", "visitJeju:P2", "visitJeju:P3", "visitJeju:P4", "visitJeju:P5", "visitJeju:P6"]);
  });

  it("관광공사: 카페·찻집 분류는 카페, 사진은 공공누리 1·3유형만 https로", async () => {
    expect(normalizeKtoPage(ktoPage(KTO_ITEM), "RESTAURANT").rows).toEqual([["kto:2850913", "CAFE", "가는곶 세화", "제주특별자치도 제주시 구좌읍 세화14길 3", 33.5205279098, 126.860696168, "", "https://tong.visitkorea.or.kr/cms/resource/05/2850905_image2_1.jpg", "", "", [["kto", "2850913"]], false, ""]]);
    expect(normalizeKtoPage(ktoPage({ ...KTO_ITEM, cat3: "A05020100", lclsSystm2: "FD01", cpyrhtDivCd: "Type2" }), "RESTAURANT").rows[0]?.slice(1, 8)).toEqual(["RESTAURANT", "가는곶 세화", "제주특별자치도 제주시 구좌읍 세화14길 3", 33.5205279098, 126.860696168, "", ""]);
    const urls: string[] = [];
    const rows = await createKtoFeed("k", "ACCOMMODATION", (async (u: string) => (urls.push(u), Response.json(ktoPage([KTO_ITEM], 1)))) as unknown as typeof fetch).fetch(async () => {});
    expect(urls).toHaveLength(1);
    expect(urls[0]).toContain("contentTypeId=32");
    expect(rows[0]?.[1]).toBe("ACCOMMODATION");
  });

  it("카카오: 음식점·카페만, 제주 밖 제외, 분류 이름을 특징으로", () => {
    expect(normalizeKakaoSearch({ documents: [KAKAO_DOC, { ...KAKAO_DOC, id: "2", category_group_code: "AT4" }, { ...KAKAO_DOC, id: "3", address_name: "서울특별시 중구", y: "37.5" }] })).toEqual([
      ["kakaoLocal:1219335616", "CAFE", "레드버튼 제주시청점", "제주특별자치도 제주시 광양10길 10", 33.4992448369791, 126.529033277888, "", "", "", "카페,커피전문점", [["kakaoLocal", "1219335616"]], false, ""],
    ]);
  });

  it("카카오 공급자: 검색어는 키워드 1건(분류 하나면 그 분류만), 내 주변은 분류마다 카테고리 검색(3km·거리순)", async () => {
    const urls: URL[] = [];
    const live = createKakaoLiveProvider("k", (async (u: URL) => (urls.push(u), Response.json({ documents: [KAKAO_DOC] }))) as unknown as typeof fetch);
    await live.search({ q: "카페", codes: ["CE7"], origin: null, radius: 3000 });
    expect(urls[0]?.pathname).toBe("/v2/local/search/keyword.json");
    expect(urls[0]?.searchParams.get("category_group_code")).toBe("CE7");
    expect(urls[0]?.searchParams.get("rect")).toBeTruthy();
    await live.search({ q: "", codes: ["FD6", "CE7"], origin: { lat: 33.5, lng: 126.53 }, radius: 3000 });
    expect(urls.slice(1).map((u) => [u.pathname, u.searchParams.get("category_group_code"), u.searchParams.get("radius"), u.searchParams.get("sort")])).toEqual([
      ["/v2/local/search/category.json", "FD6", "3000", "distance"],
      ["/v2/local/search/category.json", "CE7", "3000", "distance"],
    ]);
  });
});

describe("같은 장소 합치기·검색 (TASK-029 3.(a))", () => {
  it("이름 정리: 괄호 설명·띄어쓰기·문장부호 제거", () => {
    expect(normalizePlaceName("성산 일출봉 (UNESCO 세계자연유산)")).toBe("성산일출봉");
    expect(normalizePlaceName("Cafe·Delmoondo!")).toBe("cafedelmoondo");
  });

  it("이름 같고 100m 안이 하나뿐이면 합친다(출처 모두, 빈 값만 채움). 멀거나·종류가 다르거나·애매하면 따로", () => {
    const vj = row("V1", "ATTRACTION", "사라봉", 33.5136, 126.5446, "visitJeju", { phone: "064-1" });
    const kto = row("K1", "ATTRACTION", "사라봉 (제주시)", 33.5139, 126.545, "kto", { photo: "https://tong.visitkorea.or.kr/a.jpg", phone: "064-2" });
    const far = row("K2", "ATTRACTION", "사라봉", 33.53, 126.56, "kto");
    const otherKind = row("K3", "ACCOMMODATION", "사라봉", 33.5136, 126.5446, "kto");
    const merged = mergePlaces([[vj], [kto, far, otherKind]]);
    expect(merged.map((r) => r[0])).toEqual(["visitJeju:V1", "kto:K2", "kto:K3"]);
    expect(merged[0]![10]).toEqual([["visitJeju", "V1"], ["kto", "K1"]]);
    expect(merged[0]![6]).toBe("064-1");
    expect(merged[0]![7]).toBe("https://tong.visitkorea.or.kr/a.jpg");
    // 원본은 바꾸지 않는다
    expect(vj[10]).toHaveLength(1);
    // 같은 이름이 100m 안에 둘 → 애매해서 따로
    const twins = mergePlaces([[row("A", "RESTAURANT", "국수집", 33.5, 126.53, "visitJeju"), row("B", "RESTAURANT", "국수집", 33.5003, 126.53, "visitJeju")], [row("C", "CAFE", "국수집", 33.5001, 126.53, "kakaoLocal")]]);
    expect(twins).toHaveLength(3);
    // 음식점과 카페는 같은 묶음으로 비교, 한쪽이 카페면 카페
    const cafe = mergePlaces([[row("A", "RESTAURANT", "바다 카페", 33.5, 126.53, "visitJeju")], [row("C", "CAFE", "바다카페", 33.5004, 126.5302, "kakaoLocal")]]);
    expect(cafe).toHaveLength(1);
    expect(cafe[0]![1]).toBe("CAFE");
    // 주차·반려동물 태그는 합친 쪽 어느 하나에 있으면 남긴다
    const a = row("A", "CAFE", "숲 카페", 33.5, 126.53, "kto");
    const b: SearchRow = [...row("B", "CAFE", "숲카페", 33.5001, 126.53, "visitJeju")];
    b[11] = true;
    b[12] = "YES";
    expect(mergePlaces([[a], [b]])[0]!.slice(11)).toEqual([true, "YES"]);
    // 같은 출처의 다른 번호는 합치지 않는다, 같은 출처·같은 번호는 한 번만
    expect(mergePlaces([[row("A", "CAFE", "카페", 33.5, 126.53, "kakaoLocal"), row("B", "CAFE", "카페", 33.5, 126.53, "kakaoLocal"), row("A", "CAFE", "카페", 33.5, 126.53, "kakaoLocal")]])).toHaveLength(2);
  });

  it("검색: 이름 같음 > 시작 > 포함 > 주소·특징, 카테고리 거르기, 위치만이면 3km 안 가까운 순", () => {
    const places = [row("1", "ATTRACTION", "성산일출봉", 33.458, 126.942, "visitJeju"), row("2", "RESTAURANT", "성산 해녀의집", 33.46, 126.93, "visitJeju"), row("3", "CAFE", "일출 카페", 33.45, 126.92, "visitJeju", { address: "서귀포시 성산읍" }), row("4", "ATTRACTION", "한라산", 33.36, 126.53, "kto")];
    expect(matchScore(places[0]!, "성산 일출봉")).toBe(0);
    expect(searchPlaces(places, { q: "성산", cat: "ALL" }).map((h) => h.place[0])).toEqual(["visitJeju:2", "visitJeju:1", "visitJeju:3"]);
    expect(searchPlaces(places, { q: "성산", cat: "CAFE" }).map((h) => h.place[0])).toEqual(["visitJeju:3"]);
    const near = searchPlaces(places, { q: "", cat: "ALL", origin: { lat: 33.459, lng: 126.935 } });
    expect(near.map((h) => h.place[0])).toEqual(["visitJeju:2", "visitJeju:1", "visitJeju:3"]);
    expect(near[0]!.meters).toBeGreaterThan(0);
    expect(searchPlaces(places, { q: "", cat: "ALL" })).toEqual([]);
    expect(searchPlaces(places, { q: "없는곳", cat: "ALL", keepUnmatched: true })).toHaveLength(4);
  });
});

function deps(over: Partial<TrafficSearchDeps> = {}): TrafficSearchDeps {
  return {
    feeds: createMockFeeds(),
    live: createMockLiveProvider(),
    liveMock: true,
    detail: createMockDetail(),
    cache: new TtlCache(24 * 60 * 60_000),
    detailCache: new TtlCache(30 * 24 * 60 * 60_000),
    guard: new QuotaGuard(new MemoryQuotaStore(), DEFAULT_BUDGETS, () => NOW),
    limiter: new RateLimiter(100, 60_000),
    now: () => NOW,
    ...over,
  };
}
const get = (d: TrafficSearchDeps, qs = "") => handleTrafficSearch(new Request(`http://localhost/api/traffic/search${qs}`), d);

describe("GET /api/traffic/search (TASK-029)", () => {
  it("목록: 출처 묶음을 합쳐(모의 사라봉 둘 → 하나) CDN 7일, 두 번째는 보관본", async () => {
    let calls = 0;
    const feeds = createMockFeeds().map((f) => ({ ...f, fetch: async (r: (n: number) => Promise<void>) => (calls++, f.fetch(r)) }));
    const d = deps({ feeds });
    const res = await get(d);
    expect(res.status).toBe(200);
    expect(res.headers.get("Cache-Control")).toContain("s-maxage=604800");
    const body = (await res.json()) as SearchIndexResponse;
    expect(body.mock).toBe(true);
    expect(body.missing).toEqual([]);
    const sarabong = body.places.filter((p) => p[2].startsWith("모의 사라봉"));
    expect(sarabong).toHaveLength(1);
    expect(sarabong[0]![10]).toEqual([["visitJeju", "MOCK-V1"], ["kto", "MOCK-K1"]]);
    await get(d);
    expect(calls).toBe(6);
  });

  it("부분 결과: 한 묶음이 실패해도 나머지를 주고 빠진 묶음을 알린다(서버 10분·CDN 10분). 모두 실패하면 오류", async () => {
    let clock = NOW.getTime();
    const broken = (f: FeedProvider): FeedProvider => (f.feed.source === "kto" && f.feed.category === "RESTAURANT" ? { ...f, fetch: async () => Promise.reject(new Error("down")) } : f);
    let calls = 0;
    const feeds = createMockFeeds().map(broken).map((f) => ({ ...f, fetch: async (r: (n: number) => Promise<void>) => (calls++, f.fetch(r)) }));
    const d = deps({ feeds, cache: new TtlCache(24 * 60 * 60_000, () => clock) });
    const res = await get(d);
    expect(res.status).toBe(200);
    expect(res.headers.get("Cache-Control")).toBe("public, max-age=300, s-maxage=600");
    expect(((await res.json()) as SearchIndexResponse).missing).toEqual([{ source: "kto", category: "RESTAURANT" }]);
    clock += SEARCH_PARTIAL_TTL_MS + 1;
    await get(d);
    expect(calls).toBe(12);
    const allDown = await get(deps({ feeds: createMockFeeds().map((f) => ({ ...f, fetch: async () => Promise.reject(new Error("down")) })) }));
    expect(allDown.status).toBe(503);
  });

  it("실시간: 음식점·카페만 카카오(no-store), 관광지·숙박은 부르지 않음, 입력 검사", async () => {
    const live = createMockLiveProvider();
    const d = deps({ live });
    const res = await get(d, "?q=%EA%B3%A0%EA%B8%B0&cat=ALL");
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    expect(((await res.json()) as SearchLiveResponse).places.map((p) => p[0])).toEqual(["kakaoLocal:MOCK-L2"]);
    const att = (await (await get(d, "?q=a&cat=ATTRACTION")).json()) as SearchLiveResponse;
    expect(att.places).toEqual([]);
    expect(live.calls).toBe(1);
    expect((await get(d, "?lat=33.5&lng=126.53&cat=CAFE")).status).toBe(200);
    expect(live.calls).toBe(2);
    expect((await get(d, "?lat=37.5&lng=127.5")).status).toBe(400);
    expect((await get(d, "?q=")).status).toBe(400);
    expect((await get(d, `?q=${"가".repeat(41)}`)).status).toBe(400);
    expect((await get(d, "?q=a&cat=BAR")).status).toBe(400);
  });

  it("소개정보(범위 변경): ?kto=&cat=, 30일 보관, 카페·음식점은 같은 보관본, 입력 검사", async () => {
    const detail = createMockDetail();
    const d = deps({ detail });
    const res = await get(d, "?kto=MOCK-K2&cat=CAFE");
    expect(res.status).toBe(200);
    expect(res.headers.get("Cache-Control")).toContain("s-maxage=2592000");
    expect((await res.json()) as SearchDetailResponse).toMatchObject({ id: "MOCK-K2", hours: "11:00~21:00", rest: "매주 화요일", parking: "불가", source: "mock" });
    await get(d, "?kto=MOCK-K2&cat=RESTAURANT");
    expect(detail.calls).toBe(1);
    expect((await get(d, "?kto=abc&cat=CAFE")).status).toBe(400);
    expect((await get(d, "?kto=123")).status).toBe(400);
  });

  it("공급자 선택: 키 있는 출처만, 없으면 모의. 카카오는 PLACES_PROVIDER=kakao와 키가 모두 있을 때만", () => {
    expect(selectSearchProviders({}).feeds.every((f) => f.mock)).toBe(true);
    const vj = selectSearchProviders({ VISITJEJU_API_KEY: "a" });
    expect(vj.feeds.map((f) => `${f.feed.source}:${f.feed.category}`)).toEqual(["visitJeju:ATTRACTION", "visitJeju:ACCOMMODATION", "visitJeju:RESTAURANT"]);
    expect(selectSearchProviders({ VISITJEJU_API_KEY: "a", DATA_GO_KR_API_KEY: "b" }).feeds).toHaveLength(6);
    expect(selectSearchProviders({ KAKAO_REST_API_KEY: "k" }).liveMock).toBe(true);
    expect(selectSearchProviders({ KAKAO_REST_API_KEY: "k", PLACES_PROVIDER: "kakao" }).liveMock).toBe(false);
  });
});
