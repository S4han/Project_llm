import { describe, expect, it } from "vitest";
import { DEFAULT_BUDGETS, MemoryQuotaStore, QuotaGuard } from "../../api/_lib/policies/quota";
import { RateLimiter } from "../../api/_lib/policies/rateLimit";
import { TtlCache } from "../../api/_lib/policies/ttlCache";
import { createMockStayProvider, createVisitJejuStayProvider, normalizeStayPage, stayKind, stayPhoto, type StaySnapshot } from "../../api/_lib/providers/visitJejuStay";
import { handleTrafficStay, selectStayProvider, type TrafficStayDeps } from "../../api/_lib/trafficStay";

const NOW = new Date("2026-10-22T08:00:00.000Z");
// TASK-028 시험 응답 표본(오렌지트리 호텔)
const ITEM = {
  alltag: "호텔,공용주차장,현금결제,카드결제",
  contentsid: "CONT_000000000500984",
  contentscd: { value: "c3", label: "숙박", refId: "contentscd>c3" },
  title: "오렌지트리 호텔",
  address: "제주특별자치도 제주시 이도일동 1371-2",
  roadaddress: "제주특별자치도 제주시 관덕로8길 7-12",
  tag: "호텔,숙소,조식 포함",
  introduction: "구제주의 중심에 위치한 호텔",
  latitude: 33.5122997,
  longitude: 126.5243863,
  phoneno: "064-755-8688",
  repPhoto: { photoid: { imgpath: "https://api.cdn.visitjeju.net/photomng/imgpath/201804/30/a.webp", thumbnailpath: "https://api.cdn.visitjeju.net/photomng/thumbnailpath/b.webp" } },
};
const page = (items: unknown[], pageCount = 1) => ({ result: "200", resultMessage: "SUCCESS", totalCount: items.length, pageCount, items });

describe("비짓제주 숙소 (TASK-028)", () => {
  it("종류: 게스트하우스·펜션·민박 먼저, 호텔·리조트·콘도는 호텔, 그 밖은 기타", () => {
    expect(stayKind("호텔,숙소")).toBe("HOTEL");
    expect(stayKind("리조트")).toBe("HOTEL");
    expect(stayKind("숙박,펜션,휴양펜션,민박")).toBe("PENSION");
    expect(stayKind("게스트하우스,호텔")).toBe("GUEST");
    expect(stayKind("민박,농어촌")).toBe("MINBAK");
    expect(stayKind("숙소")).toBe("ETC");
  });

  it("사진: 비짓제주 사진 서버 https만", () => {
    expect(stayPhoto(ITEM.repPhoto.photoid.imgpath)).toBe(ITEM.repPhoto.photoid.imgpath);
    expect(stayPhoto("http://api.cdn.visitjeju.net/a.webp")).toBe("");
    expect(stayPhoto("https://evil.example.com/a.webp")).toBe("");
  });

  it("정규화: 숙박(c3)만·제주 밖 제외, 도로명 주소 우선, 종류·주차장 태그·전화·사진·소개·태그", () => {
    const { stays, pageCount } = normalizeStayPage(
      page([ITEM, { ...ITEM, contentsid: "x1", contentscd: { value: "c1" } }, { ...ITEM, contentsid: "x2", latitude: 37.5 }, { ...ITEM, contentsid: "x3", roadaddress: "", alltag: "펜션", tag: "펜션", phoneno: null, repPhoto: null }], 10),
    );
    expect(pageCount).toBe(10);
    expect(stays).toEqual([
      ["CONT_000000000500984", "오렌지트리 호텔", "제주특별자치도 제주시 관덕로8길 7-12", 33.5122997, 126.5243863, "HOTEL", true, "064-755-8688", "https://api.cdn.visitjeju.net/photomng/imgpath/201804/30/a.webp", "구제주의 중심에 위치한 호텔", "호텔,숙소,조식 포함"],
      ["x3", "오렌지트리 호텔", "제주특별자치도 제주시 이도일동 1371-2", 33.5122997, 126.5243863, "PENSION", false, "", "", "구제주의 중심에 위치한 호텔", "펜션"],
    ]);
    expect(() => normalizeStayPage({ result: "403", resultMessage: "apiKey is invalid" })).toThrow(/403/);
  });

  it("공급자: https·category=c3·쪽마다 부르고 남은 쪽 예약, 중복 제거", async () => {
    const urls: URL[] = [];
    const fetchImpl = (async (u: string) => {
      const url = new URL(u);
      urls.push(url);
      return Response.json(page([{ ...ITEM, contentsid: `P${url.searchParams.get("page")}` }, ITEM], 3));
    }) as unknown as typeof fetch;
    const reserved: number[] = [];
    const snap = await createVisitJejuStayProvider("k+1", fetchImpl).fetchStays(async (n) => {
      reserved.push(n);
    });
    expect(urls.map((u) => `${u.protocol}${u.host}${u.pathname}?${u.searchParams.get("category")}&${u.searchParams.get("page")}`)).toEqual([
      "https:api.visitjeju.net/vsjApi/contents/searchList?c3&1",
      "https:api.visitjeju.net/vsjApi/contents/searchList?c3&2",
      "https:api.visitjeju.net/vsjApi/contents/searchList?c3&3",
    ]);
    expect(urls[0]!.searchParams.get("apiKey")).toBe("k+1");
    expect(reserved).toEqual([2]);
    expect(snap.stays.map((s) => s[0])).toEqual(["P1", "CONT_000000000500984", "P2", "P3"]);
  });

  it("공급자 선택: VISITJEJU_API_KEY가 있으면 비짓제주, 없으면 모의(공공데이터포털 키로는 쓰지 않음)", () => {
    expect(selectStayProvider({ VISITJEJU_API_KEY: "k" })).not.toHaveProperty("calls");
    expect(selectStayProvider({ DATA_GO_KR_API_KEY: "k" })).toHaveProperty("calls");
  });

  it("처리기: 서버 하루·CDN 7일 보관, 두 번째는 다시 부르지 않음, 사용량 1건", async () => {
    const stay = createMockStayProvider();
    const store = new MemoryQuotaStore();
    const d: TrafficStayDeps = {
      stay,
      cache: new TtlCache<StaySnapshot>(60_000, () => NOW.getTime()),
      guard: new QuotaGuard(store, DEFAULT_BUDGETS, () => NOW),
      limiter: new RateLimiter(10, 60_000, () => NOW.getTime()),
      now: () => NOW,
    };
    const req = () => new Request("https://x.vercel.app/api/traffic/stay", { headers: { "x-real-ip": "10.0.0.2" } });
    const res = await handleTrafficStay(req(), d);
    expect(res.status).toBe(200);
    expect(res.headers.get("Cache-Control")).toContain(`s-maxage=${7 * 24 * 3600}`);
    expect(((await res.json()) as { stays: unknown[]; source: string }).source).toBe("mock");
    await handleTrafficStay(req(), d);
    expect(stay.calls).toBe(1);
    expect(await store.used("visitJeju", "2026-10-22")).toBe(1);
  });
});
