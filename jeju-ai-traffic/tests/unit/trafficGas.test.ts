import { describe, expect, it } from "vitest";
import { DEFAULT_BUDGETS, MemoryQuotaStore, QuotaGuard } from "../../api/_lib/policies/quota";
import { RateLimiter } from "../../api/_lib/policies/rateLimit";
import { TtlCache } from "../../api/_lib/policies/ttlCache";
import { createJejuItsGasProvider, createMockGasProvider, joinGas, type GasSnapshot } from "../../api/_lib/providers/jejuItsGas";
import { handleTrafficGas, selectGasProvider, type TrafficGasDeps } from "../../api/_lib/trafficGas";
import { distanceMeters } from "../../shared/rules/geo";
import { katecToWgs84, wgs84ToKatec } from "../../shared/rules/katec";

const NOW = new Date("2026-10-21T06:30:00.000Z");
// TASK-018 제주 ITS 시험 응답 표본(돌발 키, 224곳)
const INFO = { id: "A0001863", poll: "SKG", gpoll: "SKG", osnm: "SK행복충전 제주오케이충전소", zip: "690232", adr: "제주 제주시 일주서로 7588 (이호이동)", tel: "064-749-5188", lpgyn: "Y", gisxcoor: "256834.4", gisycoor: "100958.2" };
const PRICE = { id: "A0001863", gasoline: 0, premium_gasoline: 0, diesel: 0, lpg: 1178 };
const ok = (info: unknown[]) => ({ result: "success", info_cnt: info.length, info });

describe("KATEC 좌표 변환 (TASK-018)", () => {
  it("proj4 KATEC 정의 값과 같고(1cm 안), 왕복 오차 1cm 안", () => {
    // proj4 "+proj=tmerc +lat_0=38 +lon_0=128 +k=0.9999 +x_0=400000 +y_0=600000 +ellps=bessel +towgs84=-115.80,474.99,674.11,1.16,-2.31,-1.63,6.43"
    const k = wgs84ToKatec({ lat: 33.4996, lng: 126.5312 });
    expect(Math.abs(k.x - 263722.2)).toBeLessThan(0.01);
    expect(Math.abs(k.y - 101365.13)).toBeLessThan(0.01);
    expect(distanceMeters(katecToWgs84(k), { lat: 33.4996, lng: 126.5312 })).toBeLessThan(0.01);
    // 오피넷 시험 응답의 도남주유소 → 제주시 도남동
    const p = katecToWgs84({ x: 263350.5777, y: 100509.1776 });
    expect(p.lat).toBeCloseTo(33.4918, 3);
    expect(p.lng).toBeCloseTo(126.5273, 3);
  });
});

describe("제주 ITS 주유소 (TASK-018 범위 변경)", () => {
  it("기본정보+가격 합치기: KATEC → 위도·경도, 가격 0은 null, 상표 없으면 충전소 상표, 좌표 없음 제외, 실패 결과는 장애", () => {
    const rows = joinGas(
      ok([INFO, { ...INFO, id: "B", poll: " ", gpoll: "E1G", gisxcoor: "" }, { ...INFO, id: "C", poll: "SKE", osnm: "도남주유소", gisxcoor: "263350.5777", gisycoor: "100509.1776" }]),
      ok([PRICE, { id: "C", gasoline: 1867, premium_gasoline: 0, diesel: 1845, lpg: 0 }]),
    );
    expect(rows.map((r) => [r[0], r[1], r[2], r[3], r[4], r[7], r[8], r[9]])).toEqual([
      ["A0001863", "SKG", "SK행복충전 제주오케이충전소", null, null, 1178, "제주 제주시 일주서로 7588 (이호이동)", "064-749-5188"],
      ["C", "SKE", "도남주유소", 1867, 1845, null, "제주 제주시 일주서로 7588 (이호이동)", "064-749-5188"],
    ]);
    expect(rows[1]![5]).toBeCloseTo(33.4918, 3);
    expect(() => joinGas({ result: "code not registered", info: [] }, ok([]))).toThrow(/code not registered/);
  });

  it("공급자: 기본정보·가격 2건, code=키", async () => {
    const urls: URL[] = [];
    const fetchImpl = (async (u: string) => {
      const url = new URL(u);
      urls.push(url);
      return Response.json(url.pathname.endsWith("infoGasInfoList") ? ok([INFO]) : ok([PRICE]));
    }) as unknown as typeof fetch;
    const p = createJejuItsGasProvider("k", fetchImpl);
    const snap = await p.fetchStations();
    expect(p.calls).toBe(2);
    expect(urls.map((u) => u.pathname).sort()).toEqual(["/api/infoGasInfoList", "/api/infoGasPriceList"]);
    expect(urls[0]!.searchParams.get("code")).toBe("k");
    expect(snap.stations).toHaveLength(1);
  });

  it("GET /api/traffic/gas: CDN 1시간, 메모리 캐시(제주 ITS 사용량 2), 실패는 503", async () => {
    const guard = new QuotaGuard(new MemoryQuotaStore(), DEFAULT_BUDGETS, () => NOW);
    const p = createJejuItsGasProvider("k", (async (u: string) => Response.json(new URL(u).pathname.endsWith("infoGasInfoList") ? ok([INFO]) : ok([PRICE]))) as unknown as typeof fetch);
    const deps: TrafficGasDeps = {
      gas: p,
      cache: new TtlCache<GasSnapshot>(3_600_000, () => NOW.getTime()),
      guard,
      limiter: new RateLimiter(10, 60_000, () => NOW.getTime()),
      now: () => NOW,
    };
    const req = (ip: string) => new Request("http://localhost/api/traffic/gas", { headers: { "x-real-ip": ip } });
    const res = await handleTrafficGas(req("1.1.1.1"), deps);
    expect(res.headers.get("cache-control")).toBe("public, max-age=600, s-maxage=3600, stale-while-revalidate=600");
    expect((await res.json()).stations).toHaveLength(1);
    await handleTrafficGas(req("2.2.2.2"), deps);
    expect((await guard.status("jejuIts")).used).toBe(2);
    const failing: TrafficGasDeps = { ...deps, gas: { id: "jejuIts", calls: 2, fetchStations: async () => Promise.reject(new Error("down")) }, cache: new TtlCache<GasSnapshot>(3_600_000, () => NOW.getTime()) };
    expect((await handleTrafficGas(req("3.3.3.3"), failing)).status).toBe(503);
  });

  it("공급자 선택: TRAFFIC_PROVIDER=jejuIts와 돌발 키가 있을 때만 실제", () => {
    expect("fetches" in selectGasProvider({})).toBe(true);
    expect("fetches" in selectGasProvider({ JEJU_ITS_API_KEY: "k" })).toBe(true);
    expect("fetches" in selectGasProvider({ TRAFFIC_PROVIDER: "jejuIts", JEJU_ITS_API_KEY: "k" })).toBe(false);
    expect(createMockGasProvider().calls).toBe(1);
  });
});
