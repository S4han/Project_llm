import { describe, expect, it } from "vitest";
import { DEFAULT_BUDGETS, MemoryQuotaStore, QuotaGuard } from "../../api/_lib/policies/quota";
import { RateLimiter } from "../../api/_lib/policies/rateLimit";
import { TtlCache } from "../../api/_lib/policies/ttlCache";
import { createMockParkingProvider, createParkingStandardProvider, feeText, hoursText, normalizeParkingPage, type ParkingSnapshot } from "../../api/_lib/providers/parkingStandard";
import { handleTrafficParking, selectParkingProvider, type TrafficParkingDeps } from "../../api/_lib/trafficParking";

const NOW = new Date("2026-10-21T05:00:00.000Z");
// TASK-017 시험 응답 형식: 최상위가 {header, body}(response 없이). 값은 시험 표본에서.
const ITEM = {
  prkplceNo: "406-2-000102",
  prkplceNm: "대정상모 공영노외1주차장",
  prkplceSe: "공영",
  prkplceType: "노외",
  rdnmadr: "",
  lnmadr: "제주특별자치도 서귀포시 대정읍 상모리 3964-1",
  prkcmprt: "37",
  operDay: "평일+토요일+공휴일",
  weekdayOperOpenHhmm: "00:00",
  weekdayOperColseHhmm: "23:59",
  satOperOperOpenHhmm: "00:00",
  satOperCloseHhmm: "23:59",
  holidayOperOpenHhmm: "00:00",
  holidayCloseOpenHhmm: "23:59",
  parkingchrgeInfo: "무료",
  latitude: "33.2205",
  longitude: "126.2505",
};
const page = (items: unknown[], totalCount = items.length) => ({ header: { resultCode: "00", resultMsg: "NORMAL SERVICE." }, body: { items: { item: items }, totalCount: String(totalCount) } });

describe("주차장 표준데이터 (TASK-017)", () => {
  it("정규화: {header, body} 형식, 도로명 없으면 지번 주소, 면수 숫자, 좌표 없음·제주 밖 제외", () => {
    const { lots, totalCount } = normalizeParkingPage(page([ITEM, { ...ITEM, prkplceNo: "x1", latitude: "" }, { ...ITEM, prkplceNo: "x2", latitude: "37.5", longitude: "127.0" }], 3));
    expect(totalCount).toBe(3);
    expect(lots).toEqual([["406-2-000102", "대정상모 공영노외1주차장", "공영", "노외", "제주특별자치도 서귀포시 대정읍 상모리 3964-1", 37, "매일 24시간", "무료", 33.2205, 126.2505]]);
    // response로 감싼 형식도 읽는다
    expect(normalizeParkingPage({ response: page([ITEM]) }).lots).toHaveLength(1);
    expect(normalizeParkingPage({ header: { resultCode: "03", resultMsg: "NODATA_ERROR" } }).lots).toEqual([]);
    expect(() => normalizeParkingPage({ header: { resultCode: "30", resultMsg: "SERVICE_KEY_IS_NOT_REGISTERED_ERROR" } })).toThrow(/SERVICE_KEY_IS_NOT_REGISTERED_ERROR/);
  });

  it("운영 시간·요금 설명", () => {
    expect(hoursText({ ...ITEM, satOperCloseHhmm: "13:00", satOperOperOpenHhmm: "09:00", weekdayOperOpenHhmm: "09:00", weekdayOperColseHhmm: "18:00", holidayOperOpenHhmm: "", holidayCloseOpenHhmm: "" })).toBe("평일 09:00~18:00 · 토 09:00~13:00");
    expect(hoursText({ operDay: "평일" })).toBe("평일");
    expect(feeText({ parkingchrgeInfo: "유료", basicTime: "30", basicCharge: "1000", addUnitTime: "10", addUnitCharge: "300" })).toBe("유료 · 기본 30분 1,000원 · 추가 10분 300원");
    expect(feeText({ parkingchrgeInfo: "혼합", basicTime: "0", basicCharge: "0" })).toBe("혼합");
  });

  it("공급자: 제주시·서귀포시 기관코드, 1,000곳 넘으면 다음 쪽(남은 쪽 예약), 중복 제거", async () => {
    const urls: URL[] = [];
    const fetchImpl = (async (u: string) => {
      const url = new URL(u);
      urls.push(url);
      const code = url.searchParams.get("instt_code");
      const n = url.searchParams.get("pageNo");
      return Response.json(page([{ ...ITEM, prkplceNo: `${code}-${n}` }, ITEM], code === "6510000" ? 1500 : 2));
    }) as unknown as typeof fetch;
    const reserved: number[] = [];
    const snap = await createParkingStandardProvider("k%2B", fetchImpl).fetchLots(async (n) => {
      reserved.push(n);
    });
    expect(urls.map((u) => `${u.searchParams.get("instt_code")}:${u.searchParams.get("pageNo")}`)).toEqual(["6510000:1", "6510000:2", "6520000:1"]);
    expect(urls[0]!.searchParams.get("type")).toBe("json");
    expect(urls[0]!.toString()).toContain("serviceKey=k%2B&");
    expect(reserved).toEqual([1]);
    expect(snap.lots.map((l) => l[0])).toEqual(["6510000-1", "406-2-000102", "6510000-2", "6520000-1"]);
  });

  it("GET /api/traffic/parking: CDN 7일 보관, 하루 메모리 캐시(사용량 기관 수 2), 실패는 503", async () => {
    const guard = new QuotaGuard(new MemoryQuotaStore(), DEFAULT_BUDGETS, () => NOW);
    const deps: TrafficParkingDeps = {
      parking: createMockParkingProvider(),
      cache: new TtlCache<ParkingSnapshot>(86_400_000, () => NOW.getTime()),
      guard,
      limiter: new RateLimiter(10, 60_000, () => NOW.getTime()),
      now: () => NOW,
    };
    const req = (ip: string) => new Request("http://localhost/api/traffic/parking", { headers: { "x-real-ip": ip } });
    const res = await handleTrafficParking(req("1.1.1.1"), deps);
    expect(res.headers.get("cache-control")).toBe("public, max-age=3600, s-maxage=604800, stale-while-revalidate=86400");
    const body = await res.json();
    expect([body.source, body.lots.length]).toEqual(["mock", 3]);
    await handleTrafficParking(req("2.2.2.2"), deps);
    expect((deps.parking as ReturnType<typeof createMockParkingProvider>).calls).toBe(1);
    expect((await guard.status("dataGoKr")).used).toBe(2);

    const failing: TrafficParkingDeps = { ...deps, parking: { id: "dataGoKr", fetchLots: async () => Promise.reject(new Error("down")) }, cache: new TtlCache<ParkingSnapshot>(86_400_000, () => NOW.getTime()) };
    const bad = await handleTrafficParking(req("3.3.3.3"), failing);
    expect(bad.status).toBe(503);
  });

  it("공급자 선택: DATA_GO_KR_API_KEY가 있을 때만 실제", () => {
    expect("calls" in selectParkingProvider({})).toBe(true);
    expect("calls" in selectParkingProvider({ DATA_GO_KR_API_KEY: "k" })).toBe(false);
  });
});
