import { describe, expect, it } from "vitest";
import { DEFAULT_BUDGETS, MemoryQuotaStore, QuotaGuard } from "../../api/_lib/policies/quota";
import { RateLimiter } from "../../api/_lib/policies/rateLimit";
import { TtlCache } from "../../api/_lib/policies/ttlCache";
import { createJejuItsEvProvider, createMockEvProvider, groupEvStations, joinEv, parseEvStatus, type EvStation, type EvStatus } from "../../api/_lib/providers/jejuItsEv";
import { handleTrafficEv, selectEvProvider, type TrafficEvDeps } from "../../api/_lib/trafficEv";

const NOW = new Date("2026-10-21T07:00:00.000Z");
// TASK-019 시험 응답 표본(제주 ITS 돌발 키): 충전기 한 대가 한 줄, x_crdn=위도·y_crdn=경도
const CH = { id: "PI645030", bid: "PI", sid: "645030", cid: "25", name: "BMW차징스테이션 제주라온프라이빗타운", addr: "제주특별자치도 제주시 한림읍 금능남로 127", addr_dtl: " ", daddr: " ", daddr_dtl: " ", use_time: "24시간 이용가능", free: "Y", b_name: "GS차지비", b_call: "1600-4047", type: "02", x_crdn: "33.3796762", y_crdn: "126.2396078" };
const ok = (info: unknown[]) => ({ result: "success", info_cnt: info.length, info });

describe("제주 ITS 전기차 충전소 (TASK-019)", () => {
  it("충전기 → 충전소: ID로 묶어 급속(02·08 외)·완속(02·08) 수, 제주 밖 좌표 제외", () => {
    const st = groupEvStations(ok([CH, { ...CH, cid: "26" }, { ...CH, cid: "27", type: "04" }, { ...CH, id: "BAD", x_crdn: "35.5", y_crdn: "125" }, { ...CH, id: "B2", type: "08", daddr: "제주시 연동 1", daddr_dtl: "지하 1층" }]));
    expect(st).toEqual([
      ["PI645030", "BMW차징스테이션 제주라온프라이빗타운", "제주특별자치도 제주시 한림읍 금능남로 127", 33.379676, 126.239608, 1, 2, "24시간 이용가능", "GS차지비", "1600-4047", "Y"],
      ["B2", "BMW차징스테이션 제주라온프라이빗타운", "제주시 연동 1 지하 1층", 33.379676, 126.239608, 0, 1, "24시간 이용가능", "GS차지비", "1600-4047", "Y"],
    ]);
    expect(() => groupEvStations({ result: "code not registered", info: [] })).toThrow(/code not registered/);
  });

  it("충전 가능 정보와 합치기: 없으면 null, 가능 수는 충전기 수를 넘지 않음", () => {
    const status = parseEvStatus(ok([{ id: "A", fast: 4, slow: 0 }, { id: "B", fast: "1", slow: "9" }]));
    const stations: EvStation[] = [
      ["A", "가", "", 33.5, 126.5, 4, 0, "", "", "", ""],
      ["B", "나", "", 33.5, 126.5, 1, 2, "", "", "", ""],
      ["C", "다", "", 33.5, 126.5, 1, 1, "", "", "", ""],
    ];
    expect(joinEv(stations, status).map((r) => [r[0], r[7], r[8]])).toEqual([["A", 4, 0], ["B", 1, 2], ["C", null, null]]);
    expect(joinEv(stations, null).every((r) => r[7] === null && r[8] === null)).toBe(true);
  });

  it("공급자: 기본정보·충전 가능 주소와 code", async () => {
    const urls: string[] = [];
    const p = createJejuItsEvProvider("k", (async (u: string) => {
      urls.push(u);
      return Response.json(u.includes("infoEvInfoList") ? ok([CH]) : ok([{ id: "PI645030", fast: 0, slow: 1 }]));
    }) as unknown as typeof fetch);
    expect(await p.fetchStations()).toHaveLength(1);
    expect((await p.fetchStatus()).get("PI645030")).toEqual([0, 1]);
    expect(urls).toEqual(["http://api.jejuits.go.kr/api/infoEvInfoList?code=k", "http://api.jejuits.go.kr/api/infoEvList?code=k"]);
  });

  function deps(ev: TrafficEvDeps["ev"]): TrafficEvDeps {
    return {
      ev,
      stationCache: new TtlCache<EvStation[]>(86_400_000, () => NOW.getTime()),
      statusCache: new TtlCache<{ status: EvStatus; at: string }>(1_800_000, () => NOW.getTime()),
      guard: new QuotaGuard(new MemoryQuotaStore(), DEFAULT_BUDGETS, () => NOW),
      limiter: new RateLimiter(10, 60_000, () => NOW.getTime()),
      now: () => NOW,
    };
  }
  const req = (ip: string) => new Request("http://localhost/api/traffic/ev", { headers: { "x-real-ip": ip } });

  it("GET /api/traffic/ev: CDN 30분, 기본·충전 가능 캐시(제주 ITS 사용량 2), 충전 가능만 실패하면 null·짧게 보관, 기본 실패는 503", async () => {
    const d = deps(createMockEvProvider());
    const res = await handleTrafficEv(req("1.1.1.1"), d);
    expect(res.headers.get("cache-control")).toBe("public, max-age=300, s-maxage=1800, stale-while-revalidate=300");
    const body = await res.json();
    expect([body.source, body.stations.length, body.statusAt]).toEqual(["mock", 4, NOW.toISOString()]);
    await handleTrafficEv(req("2.2.2.2"), d);
    expect((await d.guard.status("jejuIts")).used).toBe(2);

    const statusDown = deps({ ...createMockEvProvider(), fetchStatus: async () => Promise.reject(new Error("down")) });
    const r2 = await handleTrafficEv(req("3.3.3.3"), statusDown);
    expect(r2.headers.get("cache-control")).toContain("s-maxage=120");
    const b2 = await r2.json();
    expect(b2.statusAt).toBeNull();
    expect(b2.stations.every((s: unknown[]) => s[7] === null)).toBe(true);

    const down = deps({ ...createMockEvProvider(), fetchStations: async () => Promise.reject(new Error("down")) });
    expect((await handleTrafficEv(req("4.4.4.4"), down)).status).toBe(503);
  });

  it("공급자 선택: TRAFFIC_PROVIDER=jejuIts와 돌발 키가 있을 때만 실제", () => {
    expect(selectEvProvider({}).source).toBe("mock");
    expect(selectEvProvider({ TRAFFIC_PROVIDER: "jejuIts", JEJU_ITS_API_KEY: "k" }).source).toBe("jejuIts");
  });
});
