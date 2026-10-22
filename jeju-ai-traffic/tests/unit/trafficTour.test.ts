import { describe, expect, it } from "vitest";
import { DEFAULT_BUDGETS, MemoryQuotaStore, QuotaGuard } from "../../api/_lib/policies/quota";
import { RateLimiter } from "../../api/_lib/policies/rateLimit";
import { TtlCache } from "../../api/_lib/policies/ttlCache";
import { createKtoTourProvider, createMockTourProvider, imageUrl, normalizeTourDetail, normalizeTourPage, plainText, type TourDetail, type TourSnapshot } from "../../api/_lib/providers/ktoTour";
import { handleTrafficTour, selectTourProvider, type TrafficTourDeps } from "../../api/_lib/trafficTour";
import { tourParking } from "../../web/src/features/traffic/facilityStyle";

const NOW = new Date("2026-10-22T06:00:00.000Z");
// TASK-026 시험 응답 표본(가마오름)
const ITEM = {
  addr1: "제주특별자치도 제주시 한경면 청수리",
  addr2: "1205",
  contentid: "1884191",
  contenttypeid: "12",
  firstimage: "http://tong.visitkorea.or.kr/cms/resource/72/3477972_image2_1.jpg",
  cpyrhtDivCd: "Type3",
  mapx: "126.2466098987",
  mapy: "33.3057279944",
  tel: "",
  title: "가마오름",
};
const page = (items: unknown[], totalCount = items.length) => ({ response: { header: { resultCode: "0000", resultMsg: "OK" }, body: { items: { item: items }, totalCount } } });

describe("한국관광공사 관광지 (TASK-026)", () => {
  it("글자 정리: <br>은 줄바꿈, 태그·엔티티 제거, 빈 줄 정리", () => {
    expect(plainText("09:00~18:00<br>※ 입장 마감 17:00<br />&nbsp;")).toBe("09:00~18:00\n※ 입장 마감 17:00");
    expect(plainText('<a href="x">누리집</a> &amp; 안내')).toBe("누리집 & 안내");
    expect(plainText(undefined)).toBe("");
  });

  it("사진 주소: 관광공사 사진 서버만, https로", () => {
    expect(imageUrl(ITEM.firstimage)).toBe("https://tong.visitkorea.or.kr/cms/resource/72/3477972_image2_1.jpg");
    expect(imageUrl("https://evil.example.com/a.jpg")).toBe("");
    expect(imageUrl("javascript:alert(1)")).toBe("");
    expect(imageUrl("")).toBe("");
  });

  it("목록 정규화: 주소 합치기, 사진 https, 저작권 구분, 좌표 없음·제주 밖(원천 오타 12.79) 제외", () => {
    const { spots, totalCount } = normalizeTourPage(page([ITEM, { ...ITEM, contentid: "2", mapx: "12.79737228191" }, { ...ITEM, contentid: "3", mapy: "" }, { ...ITEM, contentid: "4", cpyrhtDivCd: "Type9", firstimage: "" }], 4));
    expect(totalCount).toBe(4);
    expect(spots).toEqual([
      ["1884191", "가마오름", "제주특별자치도 제주시 한경면 청수리 1205", 33.3057279944, 126.2466098987, "https://tong.visitkorea.or.kr/cms/resource/72/3477972_image2_1.jpg", "Type3"],
      ["4", "가마오름", "제주특별자치도 제주시 한경면 청수리 1205", 33.3057279944, 126.2466098987, "", ""],
    ]);
    expect(normalizeTourPage(page([ITEM])).spots).toHaveLength(1);
    expect(() => normalizeTourPage({ response: { header: { resultCode: "30", resultMsg: "SERVICE_KEY_IS_NOT_REGISTERED_ERROR" } } })).toThrow(/30/);
  });

  it("소개정보 정규화: 이용시간·쉬는날·주차·문의", () => {
    const d = normalizeTourDetail("1884191", page([{ usetime: "※ 일부 출입이 제한<br>방문 시 전화문의", restdate: "연중무휴", parking: "불가능", infocenter: "제주시 관광정보센터 064-740-6000" }]));
    expect(d).toEqual({ id: "1884191", usetime: "※ 일부 출입이 제한\n방문 시 전화문의", restdate: "연중무휴", parking: "불가능", infocenter: "제주시 관광정보센터 064-740-6000", source: "kto" });
  });

  it("주차 판단: 가능·불가·정보 없음", () => {
    expect(tourParking("가능")).toBe("YES");
    expect(tourParking("주차가능 (승용차 50대)")).toBe("YES");
    expect(tourParking("불가능")).toBe("NO");
    expect(tourParking("없음")).toBe("NO");
    expect(tourParking("")).toBe("UNKNOWN");
    expect(tourParking("인근 이용")).toBe("UNKNOWN");
  });

  it("공급자: 제주(areaCode 39)·관광지(12) 목록 1,000건씩, 상세는 detailIntro2, 인코딩 키는 그대로, 한도(22)는 rate_limited", async () => {
    const urls: URL[] = [];
    const fetchImpl = (async (u: string) => {
      const url = new URL(u);
      urls.push(url);
      if (url.pathname.endsWith("detailIntro2")) return Response.json(page([{ usetime: "상시", parking: "가능" }]));
      return Response.json(page([ITEM], 1));
    }) as unknown as typeof fetch;
    const p = createKtoTourProvider("k%2B", fetchImpl);
    expect((await p.fetchSpots()).spots).toHaveLength(1);
    expect((await p.fetchDetail("1884191")).parking).toBe("가능");
    expect(urls.map((u) => u.pathname.split("/").at(-1))).toEqual(["areaBasedList2", "detailIntro2"]);
    expect(urls[0]!.searchParams.get("areaCode")).toBe("39");
    expect(urls[0]!.searchParams.get("contentTypeId")).toBe("12");
    expect(urls[0]!.searchParams.get("numOfRows")).toBe("1000");
    expect(urls[1]!.searchParams.get("contentId")).toBe("1884191");
    expect(urls[0]!.href).toContain("serviceKey=k%2B&");
    const limited = createKtoTourProvider("k", (async () => Response.json({ response: { header: { resultCode: "22", resultMsg: "LIMITED" } } })) as unknown as typeof fetch);
    await expect(limited.fetchSpots()).rejects.toMatchObject({ kind: "rate_limited" });
  });

  it("공급자 선택: 키가 있으면 관광공사, 없으면 모의", () => {
    expect(selectTourProvider({ DATA_GO_KR_API_KEY: "k" })).not.toHaveProperty("calls");
    expect(selectTourProvider({})).toHaveProperty("calls");
  });

  function deps() {
    const tour = createMockTourProvider();
    const store = new MemoryQuotaStore();
    const d: TrafficTourDeps = {
      tour,
      cache: new TtlCache<TourSnapshot>(60_000, () => NOW.getTime()),
      detailCache: new TtlCache<TourDetail>(60_000, () => NOW.getTime()),
      guard: new QuotaGuard(store, DEFAULT_BUDGETS, () => NOW),
      limiter: new RateLimiter(30, 60_000, () => NOW.getTime()),
      now: () => NOW,
    };
    return { d, tour, store };
  }
  const req = (q = "") => new Request(`https://x.vercel.app/api/traffic/tour${q}`, { headers: { "x-real-ip": "10.0.0.1" } });

  it("목록: 하루·CDN 7일 보관, 상세: 관광지마다 30일 보관(같은 관광지는 다시 부르지 않음), 사용량 1건씩", async () => {
    const { d, tour, store } = deps();
    const list = await handleTrafficTour(req(), d);
    expect(list.status).toBe(200);
    expect(list.headers.get("Cache-Control")).toContain(`s-maxage=${7 * 24 * 3600}`);
    expect(((await list.json()) as { spots: unknown[] }).spots).toHaveLength(3);
    const detail = await handleTrafficTour(req("?id=MOCK-T1"), d);
    expect(detail.headers.get("Cache-Control")).toContain(`s-maxage=${30 * 24 * 3600}`);
    expect(await detail.json()).toMatchObject({ id: "MOCK-T1", parking: "가능 (승용차 30대)", source: "mock" });
    await handleTrafficTour(req("?id=MOCK-T1"), d);
    await handleTrafficTour(req(), d);
    expect(tour.calls).toBe(2);
    expect(await store.used("kto", "2026-10-22")).toBe(2);
  });

  it("관광지 번호가 이상하면 400(외부 호출 없음)", async () => {
    const { d, tour } = deps();
    const bad = await handleTrafficTour(req("?id=../../etc"), d);
    expect(bad.status).toBe(400);
    expect(tour.calls).toBe(0);
  });
});
