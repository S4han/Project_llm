import { describe, expect, it } from "vitest";
import { DEFAULT_BUDGETS, MemoryQuotaStore, QuotaGuard } from "../../api/_lib/policies/quota";
import { RateLimiter } from "../../api/_lib/policies/rateLimit";
import { TtlCache } from "../../api/_lib/policies/ttlCache";
import { createJejuItsFacilityProvider, createMockFacilityProvider, normalizeFacilityResponse, type FacilitySnapshot } from "../../api/_lib/providers/jejuItsFacilities";
import { handleTrafficFacilities, selectFacilityProvider, type TrafficFacilitiesDeps } from "../../api/_lib/trafficFacilities";

const NOW = new Date("2026-10-20T05:10:00.000Z");

describe("제주 ITS 교통시설물 (TASK-013)", () => {
  it("x_crdn=위도·y_crdn=경도, 0·제주 밖 좌표 제외, 모델명 '-'는 빈 값", () => {
    const rows = normalizeFacilityResponse(
      {
        result: "success",
        info: [
          { fclt_id: "CA000010", fclt_type: "FTY02", fclt_lctn: "이호테우해변입구교차로", mdl_nm: "TCS-3500", x_crdn: 33.49546151, y_crdn: 126.45414751 },
          { fclt_id: "MW600010", fclt_type: "FTY01", fclt_lctn: "축산마을입구", mdl_nm: "-", x_crdn: 33.44447858, y_crdn: 126.48865242 },
          { fclt_id: "CA999", fclt_type: "FTY02", fclt_lctn: "좌표 없음", mdl_nm: "-", x_crdn: 0, y_crdn: 0 },
        ],
      },
      "FTY02",
    );
    expect(rows).toEqual([
      ["CA000010", "FTY02", "이호테우해변입구교차로", "TCS-3500", 33.49546151, 126.45414751],
      ["MW600010", "FTY02", "축산마을입구", "", 33.44447858, 126.48865242],
    ]);
    expect(() => normalizeFacilityResponse({ result: "code not registered", info: [] }, "FTY01")).toThrow();
  });

  it("7개 유형을 fcltType으로 1건씩, 일부 실패면 받은 것 + 실패 유형", async () => {
    const urls: URL[] = [];
    const fetchImpl = (async (u: string) => {
      const url = new URL(u);
      urls.push(url);
      const t = url.searchParams.get("fcltType");
      if (t === "FTY17") return new Response("x", { status: 500 });
      return Response.json({ result: "success", info: [{ fclt_id: `${t}-1`, fclt_lctn: "곳", mdl_nm: "-", x_crdn: 33.4, y_crdn: 126.5 }] });
    }) as unknown as typeof fetch;
    const snap = await createJejuItsFacilityProvider("k", fetchImpl).fetchFacilities();
    expect(urls.map((u) => u.searchParams.get("fcltType"))).toEqual(["FTY01", "FTY02", "FTY03", "FTY07", "FTY09", "FTY17", "FTY23"]);
    expect(urls.every((u) => u.pathname === "/api/getFacilityInfo")).toBe(true);
    expect(snap.facilities).toHaveLength(6);
    expect(snap.failedTypes).toEqual(["FTY17"]);
  });

  function setup(provider = createMockFacilityProvider() as TrafficFacilitiesDeps["facilities"]) {
    const guard = new QuotaGuard(new MemoryQuotaStore(), DEFAULT_BUDGETS, () => NOW);
    const deps: TrafficFacilitiesDeps = {
      facilities: provider,
      cache: new TtlCache<FacilitySnapshot>(86_400_000, () => NOW.getTime()),
      guard,
      limiter: new RateLimiter(10, 60_000, () => NOW.getTime()),
      now: () => NOW,
    };
    const get = (ip = "1.1.1.1") => handleTrafficFacilities(new Request("http://localhost/api/traffic/facilities", { headers: { "x-real-ip": ip } }), deps);
    return { deps, guard, get };
  }

  it("처리기: CDN 7일, 두 번째는 메모리 캐시, 제주 ITS 사용량 7", async () => {
    const provider = createMockFacilityProvider();
    const { get, guard } = setup(provider);
    const res = await get();
    expect(res.headers.get("cache-control")).toBe("public, max-age=3600, s-maxage=604800, stale-while-revalidate=86400");
    const body = await res.json();
    expect(body.source).toBe("mock");
    expect(body.facilities.length).toBeGreaterThan(0);
    await get("2.2.2.2");
    expect(provider.calls).toBe(1);
    expect((await guard.status("jejuIts")).used).toBe(7);
  });

  it("처리기: 일부 유형 실패면 CDN 1시간만, 모두 실패면 503", async () => {
    const partial: TrafficFacilitiesDeps["facilities"] = { id: "jejuIts", fetchFacilities: async () => ({ facilities: [], failedTypes: ["FTY17"], source: "jejuIts" }) };
    expect((await setup(partial).get()).headers.get("cache-control")).toContain("s-maxage=3600,");
    const failing: TrafficFacilitiesDeps["facilities"] = {
      id: "jejuIts",
      fetchFacilities: async () => {
        throw new Error("down");
      },
    };
    const res = await setup(failing).get();
    expect(res.status).toBe(503);
  });

  it("공급자 선택: 전용 키 또는 실시간 교통정보 키 + TRAFFIC_PROVIDER=jejuIts일 때만 실제", () => {
    expect("calls" in selectFacilityProvider({ TRAFFIC_PROVIDER: "jejuIts", JEJU_ITS_API_KEY: "k" })).toBe(true);
    expect("calls" in selectFacilityProvider({ TRAFFIC_PROVIDER: "jejuIts", JEJU_ITS_TRAFFIC_API_KEY: "k" })).toBe(false);
    expect("calls" in selectFacilityProvider({ TRAFFIC_PROVIDER: "jejuIts", JEJU_ITS_FACILITY_API_KEY: "k" })).toBe(false);
    expect("calls" in selectFacilityProvider({ JEJU_ITS_TRAFFIC_API_KEY: "k" })).toBe(true);
  });
});
