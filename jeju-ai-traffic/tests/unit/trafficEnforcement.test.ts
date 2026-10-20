import { describe, expect, it } from "vitest";
import { DEFAULT_BUDGETS, MemoryQuotaStore, QuotaGuard } from "../../api/_lib/policies/quota";
import { RateLimiter } from "../../api/_lib/policies/rateLimit";
import { TtlCache } from "../../api/_lib/policies/ttlCache";
import { createJejuCityEnforcementProvider, createMockEnforcementProvider, normalizeEnforcementResponse, serviceKeyParam, type EnforcementSnapshot } from "../../api/_lib/providers/jejuCityEnforcement";
import { handleTrafficEnforcement, selectEnforcementProvider, type TrafficEnforcementDeps } from "../../api/_lib/trafficEnforcement";

const NOW = new Date("2026-10-20T07:00:00.000Z");
// TASK-016 시험 응답 형식(값은 시험 표본에서)
const ok = (items: unknown, totalCount = 2) => ({ response: { header: { resultCode: "00", resultMsg: "NORMAL_SERVICE" }, body: { items, totalCount, numOfRows: 1000, pageNo: 1 } } });
const ITEM = {
  dataCd: "1",
  regDt: "2026-07-15 15:18:44",
  laCrdnt: "33.5055",
  loCrdnt: "126.5412",
  instlPlaceNm: "1. 인제 신설오름 부근(고마로, 고마로17길)(특)",
  instlAdres: "제주시 일도2동 377-23",
  rtateCctvCnt: "1",
  auditCctvCnt: "2",
  operTimeInfo: "평일 07시30분 ~ 22시\n공휴일 09시 ~ 18시 \n(특) 07:30 ~ 23시",
};

describe("제주시 주정차 단속 CCTV (TASK-016)", () => {
  it("응답 정규화: 장소 앞 번호 제거, 수는 숫자(빈 값은 null), 운영 시간 줄 정리, 제주 밖 좌표 제외", () => {
    const { cameras, totalCount } = normalizeEnforcementResponse(ok([ITEM, { ...ITEM, dataCd: "2", auditCctvCnt: "" }, { ...ITEM, dataCd: "3", laCrdnt: "0", loCrdnt: "0" }], 3));
    expect(totalCount).toBe(3);
    expect(cameras).toEqual([
      ["1", "인제 신설오름 부근(고마로, 고마로17길)(특)", "제주시 일도2동 377-23", 1, 2, "평일 07시30분 ~ 22시\n공휴일 09시 ~ 18시\n(특) 07:30 ~ 23시", 33.5055, 126.5412],
      ["2", "인제 신설오름 부근(고마로, 고마로17길)(특)", "제주시 일도2동 377-23", 1, null, "평일 07시30분 ~ 22시\n공휴일 09시 ~ 18시\n(특) 07:30 ~ 23시", 33.5055, 126.5412],
    ]);
    // 항목이 하나면 객체로 올 수 있다
    expect(normalizeEnforcementResponse(ok({ item: ITEM }, 1)).cameras).toHaveLength(1);
    expect(() => normalizeEnforcementResponse({ OpenAPI_ServiceResponse: { cmmMsgHeader: { errMsg: "SERVICE_KEY_IS_NOT_REGISTERED_ERROR" } } })).toThrow(/SERVICE_KEY_IS_NOT_REGISTERED_ERROR/);
  });

  it("인증키: 인코딩 키('%' 포함)는 그대로, 일반 키는 인코딩", () => {
    expect(serviceKeyParam("abc%2Bdef%3D%3D")).toBe("abc%2Bdef%3D%3D");
    expect(serviceKeyParam(" abc+def== ")).toBe("abc%2Bdef%3D%3D");
  });

  it("공급자: 1쪽 1,000곳, 전체가 더 많으면 다음 쪽까지", async () => {
    const urls: string[] = [];
    const fetchImpl = (async (u: string) => {
      urls.push(u);
      const n = Number(new URL(u).searchParams.get("pageNo"));
      return Response.json(ok([{ ...ITEM, dataCd: String(n) }], 1500));
    }) as unknown as typeof fetch;
    const snap = await createJejuCityEnforcementProvider("k%2B", fetchImpl).fetchCameras();
    expect(snap.cameras.map((c) => c[0])).toEqual(["1", "2"]);
    expect(urls[0]).toBe("https://apis.data.go.kr/6510000/parkingControlCctvService/getParkingControlCctvList?serviceKey=k%2B&pageNo=1&numOfRows=1000");
    expect(urls).toHaveLength(2);
  });

  it("GET /api/traffic/enforcement: CDN 7일 보관, 하루 메모리 캐시(사용량 1), 실패는 503", async () => {
    const guard = new QuotaGuard(new MemoryQuotaStore(), DEFAULT_BUDGETS, () => NOW);
    const deps: TrafficEnforcementDeps = {
      cameras: createMockEnforcementProvider(),
      cache: new TtlCache<EnforcementSnapshot>(86_400_000, () => NOW.getTime()),
      guard,
      limiter: new RateLimiter(10, 60_000, () => NOW.getTime()),
      now: () => NOW,
    };
    const req = (ip: string) => new Request("http://localhost/api/traffic/enforcement", { headers: { "x-real-ip": ip } });
    const res = await handleTrafficEnforcement(req("1.1.1.1"), deps);
    expect(res.headers.get("cache-control")).toBe("public, max-age=3600, s-maxage=604800, stale-while-revalidate=86400");
    const body = await res.json();
    expect(body.source).toBe("mock");
    expect(body.cameras).toHaveLength(3);
    await handleTrafficEnforcement(req("2.2.2.2"), deps);
    expect((deps.cameras as ReturnType<typeof createMockEnforcementProvider>).calls).toBe(1);
    expect((await guard.status("dataGoKr")).used).toBe(1);

    const failing: TrafficEnforcementDeps = {
      ...deps,
      cameras: { id: "dataGoKr", fetchCameras: async () => Promise.reject(new Error("down")) },
      cache: new TtlCache<EnforcementSnapshot>(86_400_000, () => NOW.getTime()),
    };
    const bad = await handleTrafficEnforcement(req("3.3.3.3"), failing);
    expect(bad.status).toBe(503);
    expect(bad.headers.get("cache-control")).not.toContain("s-maxage");
  });

  it("공급자 선택: DATA_GO_KR_API_KEY가 있을 때만 실제", () => {
    expect("calls" in selectEnforcementProvider({})).toBe(true);
    expect("calls" in selectEnforcementProvider({ DATA_GO_KR_API_KEY: "k" })).toBe(false);
  });
});
