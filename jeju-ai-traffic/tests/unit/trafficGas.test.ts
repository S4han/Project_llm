import { describe, expect, it } from "vitest";
import { DEFAULT_BUDGETS, MemoryQuotaStore, QuotaGuard } from "../../api/_lib/policies/quota";
import { RateLimiter } from "../../api/_lib/policies/rateLimit";
import { TtlCache } from "../../api/_lib/policies/ttlCache";
import { createMockGasProvider, createOpinetGasProvider, jejuGrid, parseAround, type GasSnapshot } from "../../api/_lib/providers/opinetGas";
import { handleTrafficGas, resetGasLastGood, selectGasProvider, type TrafficGasDeps } from "../../api/_lib/trafficGas";
import { distanceMeters, isInJeju } from "../../shared/rules/geo";
import { katecToWgs84, wgs84ToKatec } from "../../shared/rules/katec";

const NOW = new Date("2026-10-21T06:00:00.000Z");
// TASK-018 시험 응답 표본(제주시청 부근 반경 5km, 휘발유)
const OIL = { UNI_ID: "A0030897", POLL_DIV_CD: "SKE", OS_NM: "도남주유소", PRICE: 1867, DISTANCE: 932, GIS_X_COOR: 263350.5777, GIS_Y_COOR: 100509.1776 };

describe("KATEC 좌표 변환 (TASK-018)", () => {
  it("proj4 KATEC 정의 값과 같고(1cm 안), 왕복 오차 1cm 안", () => {
    // proj4 "+proj=tmerc +lat_0=38 +lon_0=128 +k=0.9999 +x_0=400000 +y_0=600000 +ellps=bessel +towgs84=-115.80,474.99,674.11,1.16,-2.31,-1.63,6.43"
    const k = wgs84ToKatec({ lat: 33.4996, lng: 126.5312 });
    expect(Math.abs(k.x - 263722.2)).toBeLessThan(0.01);
    expect(Math.abs(k.y - 101365.13)).toBeLessThan(0.01);
    expect(distanceMeters(katecToWgs84(k), { lat: 33.4996, lng: 126.5312 })).toBeLessThan(0.01);
    // 시험 응답의 도남주유소 → 제주시 도남동
    const p = katecToWgs84({ x: 263350.5777, y: 100509.1776 });
    expect(p.lat).toBeCloseTo(33.4918, 3);
    expect(p.lng).toBeCloseTo(126.5273, 3);
  });
});

describe("오피넷 주유소 (TASK-018)", () => {
  it("응답 해석: KATEC → 위도·경도, 가격 0은 null, RESULT.OIL 없으면 장애", () => {
    const rows = parseAround({ RESULT: { OIL: [OIL, { ...OIL, UNI_ID: "Z", PRICE: 0 }, { ...OIL, UNI_ID: "Y", GIS_X_COOR: 0 }] } });
    expect(rows.map((r) => [r.id, r.brand, r.name, r.price])).toEqual([["A0030897", "SKE", "도남주유소", 1867], ["Z", "SKE", "도남주유소", null]]);
    expect(rows[0]!.lat).toBeCloseTo(33.4918, 3);
    expect(() => parseAround({ RESULT: {} })).toThrow();
  });

  it("격자: 육각 배치 약 45곳(1회 약 90건 < 하루 한도 300), 모두 제주 범위, 주요 마을이 5km 원 안", () => {
    const grid = jejuGrid();
    expect(grid.length).toBeGreaterThan(38);
    expect(grid.length).toBeLessThanOrEqual(48);
    expect(grid.every((c) => isInJeju(c))).toBe(true);
    for (const town of [{ lat: 33.215, lng: 126.25 }, { lat: 33.46, lng: 126.93 }, { lat: 33.505, lng: 126.955 }, { lat: 33.33, lng: 126.83 }, { lat: 33.465, lng: 126.32 }, { lat: 33.33, lng: 126.17 }, { lat: 33.3, lng: 126.165 }, { lat: 33.5, lng: 126.9 }, { lat: 33.54, lng: 126.67 }, { lat: 33.4918, lng: 126.5273 }]) {
      expect(Math.min(...grid.map((c) => distanceMeters(c, town)))).toBeLessThan(5000);
    }
  });

  it("공급자: 격자마다 휘발유·경유 1건씩, 주유소 ID로 합친다(text/html 응답도 JSON으로 읽음)", async () => {
    const urls: URL[] = [];
    const fetchImpl = (async (u: string) => {
      const url = new URL(u);
      urls.push(url);
      const diesel = url.searchParams.get("prodcd") === "D047";
      return new Response(JSON.stringify({ RESULT: { OIL: [{ ...OIL, PRICE: diesel ? 1845 : 1867 }] } }), { headers: { "content-type": "text/html; charset=utf-8" } });
    }) as unknown as typeof fetch;
    const p = createOpinetGasProvider("k", fetchImpl);
    const snap = await p.fetchStations();
    expect(p.calls).toBe(jejuGrid().length * 2);
    expect(urls).toHaveLength(p.calls);
    expect(urls[0]!.searchParams.get("radius")).toBe("5000");
    expect(urls[0]!.searchParams.get("out")).toBe("json");
    // 좌표는 정수(시험에서 확인된 형식)
    expect(urls.every((u) => /^\d+$/.test(u.searchParams.get("x")!) && /^\d+$/.test(u.searchParams.get("y")!))).toBe(true);
    expect(new Set(urls.map((u) => u.searchParams.get("x") + "," + u.searchParams.get("y"))).size).toBe(jejuGrid().length);
    expect(snap.stations).toEqual([["A0030897", "SKE", "도남주유소", 1867, 1845, expect.any(Number), expect.any(Number)]]);
    expect(snap.meta).toEqual({ calls: p.calls, nonEmpty: p.calls, distinctResults: 2 });
  });

  it("GET /api/traffic/gas: CDN 하루, 메모리 캐시(사용량 = 호출 수), 처음부터 실패면 503", async () => {
    resetGasLastGood();
    const guard = new QuotaGuard(new MemoryQuotaStore(), DEFAULT_BUDGETS, () => NOW);
    const deps: TrafficGasDeps = {
      gas: createMockGasProvider(),
      cache: new TtlCache<GasSnapshot>(86_400_000, () => NOW.getTime()),
      guard,
      limiter: new RateLimiter(10, 60_000, () => NOW.getTime()),
      now: () => NOW,
    };
    const req = (ip: string) => new Request("http://localhost/api/traffic/gas", { headers: { "x-real-ip": ip } });
    const res = await handleTrafficGas(req("1.1.1.1"), deps);
    expect(res.headers.get("cache-control")).toBe("public, max-age=3600, s-maxage=86400, stale-while-revalidate=86400");
    expect((await res.json()).stations).toHaveLength(4);
    await handleTrafficGas(req("2.2.2.2"), deps);
    expect((deps.gas as ReturnType<typeof createMockGasProvider>).fetches).toBe(1);
    expect((await guard.status("opinet")).used).toBe(1);
    const failing: TrafficGasDeps = { ...deps, gas: { id: "opinet", calls: 2, fetchStations: async () => Promise.reject(new Error("down")) }, cache: new TtlCache<GasSnapshot>(86_400_000, () => NOW.getTime()) };
    // 다시 받다가 실패하면 마지막 목록을 10분만 보관하며 준다
    const stale = await handleTrafficGas(req("3.3.3.3"), failing);
    expect(stale.status).toBe(200);
    expect(stale.headers.get("cache-control")).toBe("public, max-age=600, s-maxage=600");
    expect((await stale.json()).stations).toHaveLength(4);
    resetGasLastGood();
    expect((await handleTrafficGas(req("4.4.4.4"), { ...failing, cache: new TtlCache<GasSnapshot>(86_400_000, () => NOW.getTime()) })).status).toBe(503);
  });

  it("공급자 선택: OPINET_API_KEY가 있을 때만 실제", () => {
    expect("fetches" in selectGasProvider({})).toBe(true);
    expect("fetches" in selectGasProvider({ OPINET_API_KEY: "k" })).toBe(false);
  });
});
