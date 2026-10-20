import { describe, expect, it } from "vitest";
import { DEFAULT_BUDGETS, MemoryQuotaStore, QuotaGuard } from "../../api/_lib/policies/quota";
import { RateLimiter } from "../../api/_lib/policies/rateLimit";
import { TtlCache } from "../../api/_lib/policies/ttlCache";
import { createMockSpeedProvider, normalizeSpeedResponse, prcnToIso, type SpeedSnapshot } from "../../api/_lib/providers/jejuItsSpeeds";
import { createMockLinkProvider, createNodeNamer, createVworldLinkProvider, parseVworldPage, toLinkShape, toNamedNode, type LinkBuild, type LinkShape } from "../../api/_lib/providers/vworldLinks";
import { handleTrafficLinks, handleTrafficSpeeds, selectLinkProvider, selectSpeedProvider, type TrafficLinksDeps } from "../../api/_lib/trafficLayers";
import { decodePolyline, encodePolyline, simplifyLine } from "../../shared/rules/polyline";
import { speedStatus } from "../../shared/rules/traffic";
import { buildCongestionRows, groupByRoad, joinSpeedLines, sectionText } from "../../web/src/features/traffic/speedLines";

const NOW = new Date("2026-10-20T01:00:00.000Z");

describe("구간 속도 규칙·형식 (TASK-012)", () => {
  it("속도 색 기준: 30 이상 원활, 15~30 서행, 15 미만 정체", () => {
    expect([45, 30, 29, 15, 14, 1].map(speedStatus)).toEqual(["smooth", "smooth", "slow", "slow", "congested", "congested"]);
  });

  it("polyline 인코딩·복원(1e5 정밀도), 단순화는 일직선 중간점을 버린다", () => {
    const pts = [{ lat: 33.50661, lng: 126.49291 }, { lat: 33.4, lng: 126.5 }, { lat: 33.2541, lng: 126.5601 }];
    expect(decodePolyline(encodePolyline(pts))).toEqual(pts);
    const straight = [{ lat: 33.5, lng: 126.5 }, { lat: 33.505, lng: 126.505 }, { lat: 33.51, lng: 126.51 }];
    expect(simplifyLine(straight, 3)).toHaveLength(2);
  });

  it("제주 ITS 응답 정규화: prcn_dt(KST)→ISO, 무효 구간 ID·속도 제외", () => {
    expect(prcnToIso("20261020095000")).toBe("2026-10-20T00:50:00.000Z");
    expect(prcnToIso("x")).toBeNull();
    const snap = normalizeSpeedResponse({
      result: "success",
      info: [
        { link_id: "4050175900", prcn_dt: "20261020095000", tfvl: "0", sped: 33, ocpy_rate: 0, trvl_hh: 5 },
        { link_id: "4050021604", prcn_dt: "20261020094500", sped: "20", trvl_hh: "77" },
        { link_id: "123", prcn_dt: "20261020095000", sped: 40, trvl_hh: 3 },
        { link_id: "4060000001", prcn_dt: "20261020095000", sped: 0, trvl_hh: 3 },
      ],
    });
    expect(snap).toEqual({ observedAt: "2026-10-20T00:50:00.000Z", speeds: { "4050175900": [33, 5], "4050021604": [20, 77] }, source: "jejuIts" });
    expect(() => normalizeSpeedResponse({ result: "code not registered", info: [] })).toThrow();
  });

  it("브이월드 응답: ERROR는 장애, MultiLineString은 이어 붙여 모양 하나", () => {
    expect(() => parseVworldPage({ response: { status: "ERROR", error: { text: "인증키 오류" } } })).toThrow(/인증키 오류/);
    expect(parseVworldPage({ response: { status: "NOT_FOUND" } }).features).toEqual([]);
    const shape = toLinkShape({
      properties: { link_id: "4050401601", road_name: "월각로 " },
      geometry: { type: "MultiLineString", coordinates: [[[126.3428, 33.3607], [126.3427, 33.3606]], [[126.3427, 33.3606], [126.34, 33.36]]] },
    });
    expect(shape?.[0]).toBe("4050401601");
    expect(shape?.[1]).toBe("월각로");
    expect(decodePolyline(shape![2]).at(-1)).toEqual({ lat: 33.36, lng: 126.34 });
    expect(toLinkShape({ properties: { link_id: "1" }, geometry: { type: "MultiLineString", coordinates: [[[126, 33]]] } })).toBeNull();
  });

  it("브이월드 공급자: 첫 쪽에서 전체 쪽 수를 알고 남은 쪽을 예약한 뒤 받으며, 속도가 있는 구간만 남긴다", async () => {
    const urls: URL[] = [];
    const feature = (id: string) => ({ properties: { link_id: id, road_name: "도로" }, geometry: { type: "MultiLineString", coordinates: [[[126.5, 33.5], [126.51, 33.49]]] } });
    const node = (name: string, lng: number, lat: number) => ({ properties: { node_name: name }, geometry: { type: "Point", coordinates: [lng, lat] } });
    const fetchImpl = (async (u: string) => {
      const url = new URL(u);
      urls.push(url);
      const n = Number(url.searchParams.get("page"));
      if (url.searchParams.get("data") === "LT_P_MOCTNODE") {
        const features = n === 1 ? [node("최소노드배치점", 126.5, 33.5), node("노형오거리", 126.5001, 33.5001)] : [node("남원읍 태흥리 364-3", 126.51, 33.49)];
        return Response.json({ response: { status: "OK", page: { total: "2" }, result: { featureCollection: { features } } } });
      }
      return Response.json({ response: { status: "OK", page: { total: "3" }, result: { featureCollection: { features: [feature(`405000000${n}`), feature("9999999999")] } } } });
    }) as unknown as typeof fetch;
    const reserved: number[] = [];
    const build = await createVworldLinkProvider("k", "https://jeju-its-probe.vercel.app", fetchImpl).fetchLinks(new Set(["4050000001", "4050000003"]), async (n) => {
      reserved.push(n);
    });
    expect(build.named).toBe(true);
    expect(build.links.map((l) => l[0])).toEqual(["4050000001", "4050000003"]);
    // 끝점과 정확히 같은 "최소노드배치점"은 건너뛰고 약 14m 떨어진 이름 있는 지점을 쓴다.
    expect(build.links[0]!.slice(3)).toEqual(["노형오거리", "남원읍 태흥리 364-3"]);
    expect(reserved.sort()).toEqual([1, 1, 2]);
    const links = urls.filter((u) => u.searchParams.get("data") === "LT_L_MOCTLINK");
    expect(links.map((u) => u.searchParams.get("page"))).toEqual(["1", "2", "3"]);
    expect(urls.filter((u) => u.searchParams.get("data") === "LT_P_MOCTNODE")).toHaveLength(2);
    expect(links[0]!.searchParams.get("domain")).toBe("https://jeju-its-probe.vercel.app");
    expect(links[0]!.searchParams.get("crs")).toBe("EPSG:4326");
  });

  it("브이월드 공급자: 교통노드를 받지 못해도 구간 모양은 주고 named=false", async () => {
    const fetchImpl = (async (u: string) => {
      if (new URL(u).searchParams.get("data") === "LT_P_MOCTNODE") return new Response("", { status: 500 });
      return Response.json({ response: { status: "OK", page: { total: "1" }, result: { featureCollection: { features: [{ properties: { link_id: "1", road_name: "도로" }, geometry: { type: "LineString", coordinates: [[126.5, 33.5], [126.51, 33.49]] } }] } } } });
    }) as unknown as typeof fetch;
    const build = await createVworldLinkProvider("k", "d", fetchImpl).fetchLinks(new Set(["1"]), async () => {});
    expect(build).toEqual({ links: [["1", "도로", expect.any(String), "", ""]], named: false });
  });

  it("지점 이름: 최소노드배치점·빈 이름 제외, 300m 안 가장 가까운 이름", () => {
    expect(toNamedNode({ properties: { node_name: "최소노드배치점" }, geometry: { type: "Point", coordinates: [126.5, 33.5] } })).toBeNull();
    expect(toNamedNode({ properties: { node_name: " " }, geometry: { type: "Point", coordinates: [126.5, 33.5] } })).toBeNull();
    expect(toNamedNode({ properties: { node_name: "제주공항" }, geometry: { type: "MultiPoint", coordinates: [[126.49, 33.51]] } })).toEqual({ name: "제주공항", at: { lng: 126.49, lat: 33.51 } });
    const name = createNodeNamer([
      { name: "먼 곳", at: { lng: 126.502, lat: 33.5 } },
      { name: "가까운 곳", at: { lng: 126.5005, lat: 33.5 } },
    ]);
    expect(name({ lng: 126.5, lat: 33.5 })).toBe("가까운 곳");
    // 격자 경계를 넘어도 찾는다(약 93m)
    expect(name({ lng: 126.4995, lat: 33.5 })).toBe("가까운 곳");
    expect(name({ lng: 126.51, lat: 33.5 })).toBe("");
  });

  it("도로명별 묶음: 구간이 많은 순, 같으면 느린 순, 도로명 없음은 맨 아래", () => {
    const l = (id: string, name: string, kmh: number) => ({ id, name, points: [], kmh, travelSeconds: 0, status: speedStatus(kmh) });
    const groups = groupByRoad([l("1", "", 5), l("2", "", 6), l("3", "", 7), l("4", "노형로", 10), l("5", "노형로", 14), l("6", "연북로", 9), l("7", "평화로", 12)]);
    expect(groups.map((g) => [g.label, g.count, g.avgKmh])).toEqual([
      ["노형로", 2, 12],
      ["연북로", 1, 9],
      ["평화로", 1, 12],
      ["도로명 없음", 3, 6],
    ]);
    expect(groups[0]!.ids).toEqual(["4", "5"]);
  });

  it("화면용 결합: 속도가 없는 구간은 그리지 않는다", () => {
    const enc = encodePolyline([{ lat: 33.5, lng: 126.5 }, { lat: 33.4, lng: 126.6 }]);
    const lines = joinSpeedLines([["a", "가", enc, "노형오거리", "제주시청"], ["b", "나", enc, "", ""]], { a: [12, 300] });
    expect(lines).toEqual([{ id: "a", name: "가", points: decodePolyline(enc), kmh: 12, travelSeconds: 300, status: "congested", from: "노형오거리", to: "제주시청" }]);
  });

  it("실시간 정체구간: 같은 도로·같은 상태로 이어진 구간을 진행 방향으로 한 줄, 정체 먼저 느린 순", () => {
    const P = (i: number) => ({ lat: 33.5, lng: 126.5 + i / 1000 });
    const l = (id: string, name: string, kmh: number, a: number, b: number, from = `지점${a}`, to = `지점${b}`) => ({ id, name, points: [P(a), P(b)], kmh, travelSeconds: 0, status: speedStatus(kmh), from, to });
    const rows = buildCongestionRows([
      // 노형로 정체: 2 → 3 → 4 를 순서와 상관없이 잇는다. 반대 방향(4 → 3)은 따로.
      l("c", "노형로", 10, 3, 4),
      l("a", "노형로", 6, 2, 3),
      l("r", "노형로", 12, 4, 3),
      // 같은 도로라도 서행은 따로
      l("s", "노형로", 20, 4, 5),
      // 원활은 제외
      l("g", "노형로", 50, 5, 6),
      // 이어지지 않은 같은 도로 정체는 다른 줄
      l("x", "연북로", 3, 10, 11, "", ""),
    ]);
    expect(rows.map((r) => [r.label, r.status, r.ids.join(""), r.avgKmh, sectionText(r)])).toEqual([
      ["연북로", "congested", "x", 3, "1구간"],
      ["노형로", "congested", "ac", 8, "지점2 → 지점4"],
      ["노형로", "congested", "r", 12, "지점4 → 지점3"],
      ["노형로", "slow", "s", 20, "지점4 → 지점5"],
    ]);
    expect(rows[1]!.key).toBe("a");
    expect(sectionText({ from: "지점1", to: "", count: 2 })).toBe("지점1 부근 · 2구간");
    expect(sectionText({ from: "지점1", to: "지점1", count: 3 })).toBe("지점1 부근 · 3구간");
  });
});

function setup(links = createMockLinkProvider() as TrafficLinksDeps["links"]) {
  const speeds = createMockSpeedProvider(() => NOW);
  const guard = new QuotaGuard(new MemoryQuotaStore(), DEFAULT_BUDGETS, () => NOW);
  const deps: TrafficLinksDeps = {
    speeds,
    speedCache: new TtlCache<SpeedSnapshot>(60_000, () => NOW.getTime()),
    links,
    linkCache: new TtlCache<LinkBuild>(86_400_000, () => NOW.getTime()),
    guard,
    limiter: new RateLimiter(10, 60_000, () => NOW.getTime()),
    now: () => NOW,
  };
  const req = (path: string, ip = "1.1.1.1") => new Request(`http://localhost${path}`, { headers: { "x-real-ip": ip } });
  return { deps, speeds, guard, req };
}

describe("GET /api/traffic/speeds·links (TASK-012)", () => {
  it("speeds: 구간 속도·가공 시각, no-store, 60초 캐시(ITS 사용량 1)", async () => {
    const { deps, speeds, guard, req } = setup();
    const res = await handleTrafficSpeeds(req("/api/traffic/speeds"), deps);
    expect(res.headers.get("cache-control")).toBe("no-store");
    const body = await res.json();
    expect(body.status).toBe("ok");
    expect(body.source).toBe("mock");
    expect(Object.keys(body.speeds)).toHaveLength(4);
    expect(body.observedAt).toBe("2026-10-20T01:00:00.000Z");
    await handleTrafficSpeeds(req("/api/traffic/speeds", "2.2.2.2"), deps);
    expect(speeds.calls).toBe(1);
    expect((await guard.status("jejuIts")).used).toBe(1);
  });

  it("speeds: ITS 한도면 200 + quotaBlocked·재사용 시각", async () => {
    const { deps, guard, req } = setup();
    await guard.reserve("jejuIts", { cost: 6000 });
    const body = await (await handleTrafficSpeeds(req("/api/traffic/speeds"), deps)).json();
    expect([body.status, body.retryAfter]).toEqual(["quotaBlocked", "2026-10-20T15:00:00.000Z"]);
    expect(body.speeds).toEqual({});
  });

  it("links: 속도가 있는 구간 모양, CDN 30일 보관 헤더, 두 번째는 메모리 캐시", async () => {
    const { deps, req } = setup();
    const links = deps.links as ReturnType<typeof createMockLinkProvider>;
    const res = await handleTrafficLinks(req("/api/traffic/links"), deps);
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("public, max-age=86400, s-maxage=2592000, stale-while-revalidate=604800");
    const body = await res.json();
    expect(body.source).toBe("mock");
    expect(body.links.map((l: LinkShape) => l[0])).toEqual(["4050000001", "4050000002", "4050000003", "4060000001"]);
    expect(body.named).toBe(true);
    expect(body.links[0].slice(3)).toEqual(["모의 공항", "모의 노형"]);
    await handleTrafficLinks(req("/api/traffic/links", "3.3.3.3"), deps);
    expect(links.calls).toBe(1);
  });

  it("links: 지점 이름을 받지 못했으면 1시간만 보관", async () => {
    const partial: TrafficLinksDeps["links"] = { id: "vworld", source: "vworld", fetchLinks: async () => ({ links: [], named: false }) };
    const { deps, req } = setup(partial);
    const res = await handleTrafficLinks(req("/api/traffic/links"), deps);
    expect(res.headers.get("cache-control")).toBe("public, max-age=3600, s-maxage=3600");
    expect((await res.json()).named).toBe(false);
  });

  it("links: 모양을 받지 못하면 503(보관 안 함)", async () => {
    const failing: TrafficLinksDeps["links"] = {
      id: "vworld",
      source: "vworld",
      fetchLinks: async () => {
        throw new Error("down");
      },
    };
    const { deps, req } = setup(failing);
    const res = await handleTrafficLinks(req("/api/traffic/links"), deps);
    expect(res.status).toBe(503);
    expect(res.headers.get("cache-control")).not.toContain("s-maxage");
  });

  it("공급자 선택: 실시간 교통정보 전용 키·브이월드 키가 있을 때만 실제", () => {
    expect("calls" in selectSpeedProvider({ TRAFFIC_PROVIDER: "jejuIts", JEJU_ITS_API_KEY: "k" })).toBe(true);
    expect("calls" in selectSpeedProvider({ TRAFFIC_PROVIDER: "jejuIts", JEJU_ITS_TRAFFIC_API_KEY: "k" })).toBe(false);
    expect(selectLinkProvider({}).source).toBe("mock");
    expect(selectLinkProvider({ VWORLD_API_KEY: "k" }).source).toBe("vworld");
  });
});
