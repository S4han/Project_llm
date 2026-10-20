import { describe, expect, it } from "vitest";
import { MockRouteProvider } from "../../api/_lib/providers/mock";
import { DEFAULT_BUDGETS, MemoryQuotaStore, QuotaGuard } from "../../api/_lib/policies/quota";
import { RateLimiter } from "../../api/_lib/policies/rateLimit";
import { TtlCache } from "../../api/_lib/policies/ttlCache";
import { createMockTrafficProvider } from "../../api/_lib/providers/mockTraffic";
import { handleRouteCompare, selectRouteProvider, type RoutesDeps } from "../../api/_lib/routes";
import type { RouteCompareRequest, RouteOption } from "../../shared/contracts/route";
import type { RouteQuery, RouteResult } from "../../shared/rules/route";

const NOW = new Date("2026-10-19T03:00:00.000Z");
const AIRPORT = { lat: 33.5066, lng: 126.4929 };
const SEOGWIPO = { lat: 33.2541, lng: 126.5601 };
const SEONGSAN = { lat: 33.4613, lng: 126.9367 };
// 한라산을 넘는 이동과 같은 쪽 이동 모두 카카오 추천 1회(TASK-011 경로방식 (a))
const CROSS = { origin: AIRPORT, destination: SEOGWIPO };
const SAME_SIDE = { origin: AIRPORT, destination: SEONGSAN };

function route(id: string, durationSeconds: number, distanceMeters: number): RouteOption {
  return { id, provider: "kakao", label: id, durationSeconds, distanceMeters, geometry: [], observedAt: NOW.toISOString(), trafficStatus: "unknown", segments: [], incidentIds: [] };
}

// 실호출 요약값(공항→서귀포시청)을 본뜬 합성 값
const ROUTES = [route("recommend", 4166, 52300)];

function setup(routes: RouteOption[] = ROUTES) {
  const provider = new MockRouteProvider(routes);
  const guard = new QuotaGuard(new MemoryQuotaStore(), DEFAULT_BUDGETS, () => NOW);
  const traffic = createMockTrafficProvider(() => NOW);
  const deps: RoutesDeps = {
    provider,
    traffic,
    incidentCache: new TtlCache(60_000, () => NOW.getTime()),
    guard,
    limiter: new RateLimiter(10, 60_000, () => NOW.getTime()),
    now: () => NOW,
  };
  const post = (body: unknown, ip = "1.1.1.1") =>
    handleRouteCompare(
      new Request("http://localhost/api/routes/compare", {
        method: "POST",
        headers: { "content-type": "application/json", "x-real-ip": ip },
        body: typeof body === "string" ? body : JSON.stringify(body),
      }),
      deps,
    );
  return { provider, traffic, guard, post };
}

describe("POST /api/routes/compare", () => {
  it("횡단도 카카오 추천 1회 호출·사용량 1, 추천 표시, 기준 시각 (AC-003-05, AC-004-02)", async () => {
    const { post, provider, guard } = setup();
    const res = await post(CROSS);
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    const body = await res.json();
    expect(body.routes.map((r: RouteOption) => r.id)).toEqual(["recommend"]);
    expect(body.recommendedRouteId).toBe("recommend");
    expect(body.tiedRouteIds).toEqual([]);
    expect(body.observedAt).toBe(NOW.toISOString());
    expect(body.stale).toBe(false);
    expect(provider.calls).toBe(1);
    expect((await guard.status("kakao")).used).toBe(1);
  });

  it("같은 쪽 이동도 1회만 호출", async () => {
    const { post, provider, guard } = setup();
    expect((await post(SAME_SIDE)).status).toBe(200);
    expect(provider.calls).toBe(1);
    expect((await guard.status("kakao")).used).toBe(1);
  });

  it("경로가 하나면 하나만 돌려준다 (AC-003-03)", async () => {
    const { post } = setup([route("recommend", 4000, 50000)]);
    const body = await (await post(SAME_SIDE)).json();
    expect(body.routes).toHaveLength(1);
    expect(body.recommendedRouteId).toBe("recommend");
  });

  it("잘못된 입력은 400, 외부 호출·사용량 없음 (AC-001-04)", async () => {
    const { post, provider, guard } = setup();
    for (const body of [
      "not json",
      {},
      { origin: AIRPORT },
      { origin: { lat: 37.5, lng: 127 }, destination: SEOGWIPO },
      { origin: AIRPORT, destination: { lat: "33", lng: 126 } },
      { origin: AIRPORT, destination: AIRPORT },
    ]) {
      const res = await post(body);
      expect(res.status).toBe(400);
      expect((await res.json()).error.code).toBe("INVALID_INPUT");
    }
    expect(provider.calls).toBe(0);
    expect((await guard.status("kakao")).used).toBe(0);
  });

  it("같은 IP 분당 11번째 요청은 429", async () => {
    const { post } = setup();
    for (let i = 0; i < 10; i++) expect((await post(SAME_SIDE)).status).toBe(200);
    expect((await post(SAME_SIDE)).status).toBe(429);
    expect((await post(SAME_SIDE, "2.2.2.2")).status).toBe(200);
  });

  it("남은 사용량이 계획한 호출 수보다 적으면 429, 외부 호출 0회", async () => {
    const { post, provider, guard } = setup();
    await guard.reserve("kakao", { cost: 7999 });
    expect((await post(CROSS)).status).toBe(200);
    expect(provider.calls).toBe(1);
    expect((await post(CROSS)).status).toBe(429);
    expect(provider.calls).toBe(1);
  });

  it("모두 장애면 503 (다시 시도 가능, AC-003-04)", async () => {
    const { post, provider } = setup();
    provider.behavior = "unavailable";
    const res = await post(CROSS);
    expect(res.status).toBe(503);
    expect((await res.json()).error.code).toBe("PROVIDER_UNAVAILABLE");
  });

  it("모두 429면 429와 다음 KST 0시까지 차단", async () => {
    const { post, provider, guard } = setup();
    provider.behavior = "rate_limited";
    const res = await post(SAME_SIDE);
    expect(res.status).toBe(429);
    expect((await res.json()).error.retryAfter).toBe("2026-10-19T15:00:00.000Z");
    expect((await guard.status("kakao")).blockedUntil?.toISOString()).toBe("2026-10-19T15:00:00.000Z");
  });

  it("공급자가 경로를 못 찾으면 이유별 안내(400)", async () => {
    const cases: [RouteResult, string][] = [
      [{ ok: false, reason: "destinationUnreachable" }, "목적지 근처에서 도로를 찾을 수 없습니다"],
      [{ ok: false, reason: "originUnreachable" }, "출발지 근처에서 도로를 찾을 수 없습니다"],
      [{ ok: false, reason: "notFound" }, "경로를 찾을 수 없습니다"],
    ];
    for (const [result, text] of cases) {
      const { post, provider } = setup();
      provider.fetchRoute = async (_r: RouteCompareRequest, _q: RouteQuery) => result;
      const res = await post(SAME_SIDE);
      expect(res.status).toBe(400);
      expect((await res.json()).error.message).toContain(text);
    }
  });
});

describe("재평가 요청 (purpose)", () => {
  it("purpose=reevaluation이면 카카오 사용 6,000건 이상에서 429, 직접 조회는 허용 (COST-003)", async () => {
    const { post, provider, guard } = setup();
    await guard.reserve("kakao", { cost: 6000 });
    const res = await post({ ...SAME_SIDE, purpose: "reevaluation" });
    expect(res.status).toBe(429);
    expect((await res.json()).error.message).toContain("자동 재평가");
    expect(provider.calls).toBe(0);
    expect((await post(SAME_SIDE)).status).toBe(200);
  });

  it("알 수 없는 purpose는 직접 조회로 본다", async () => {
    const { post, guard } = setup();
    await guard.reserve("kakao", { cost: 5999 });
    expect((await post({ ...SAME_SIDE, purpose: "anything" })).status).toBe(200);
  });
});

describe("교통 사건 연결 (제주 ITS, 모의)", () => {
  // 모의 정지차량(33.4308, 126.5131)을 지나는 경로와 지나지 않는 경로
  const near = { ...route("recommend", 4166, 52300), geometry: [{ lat: 33.44, lng: 126.51 }, { lat: 33.42, lng: 126.516 }] };
  const far = { ...route("recommend", 4770, 43000), geometry: [{ lat: 33.45, lng: 126.55 }, { lat: 33.3, lng: 126.56 }] };

  it("200m 이내 사건만 경로에 연결하고, 연결된 사건만 응답에 담는다 (AC-005-01·02)", async () => {
    const body = await (await setup([near]).post(SAME_SIDE)).json();
    expect(body.routes[0].incidentIds).toEqual(["mock-event-1"]);
    expect(body.incidents.map((i: { id: string }) => i.id)).toEqual(["mock-event-1"]);
    expect(body.incidentsStatus).toBe("ok");
    expect(body.incidentsObservedAt).toBe(NOW.toISOString());
    const away = await (await setup([far]).post(SAME_SIDE)).json();
    expect(away.routes[0].incidentIds).toEqual([]);
    expect(away.incidents).toEqual([]);
  });

  it("60초 안의 두 번째 조회는 캐시를 쓴다(ITS 호출 1회, 사용량 3)", async () => {
    const { post, traffic, guard } = setup([near]);
    await post(SAME_SIDE);
    await post(SAME_SIDE);
    expect(traffic.calls).toBe(1);
    expect((await guard.status("jejuIts")).used).toBe(3);
  });

  it("ITS 실패면 경로는 그대로 주고 incidentsStatus unavailable (AC-005-04)", async () => {
    const { post, traffic } = setup([near]);
    traffic.fetchIncidents = async () => {
      throw new Error("down");
    };
    const res = await post(SAME_SIDE);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.routes).toHaveLength(1);
    expect(body.incidentsStatus).toBe("unavailable");
    expect(body.incidents).toEqual([]);
    expect(body.incidentsObservedAt).toBeNull();
  });

  it("ITS 한도면 quotaBlocked, ITS 호출 0회", async () => {
    const { post, traffic, guard } = setup([near]);
    await guard.reserve("jejuIts", { cost: 6000 });
    const body = await (await post(SAME_SIDE)).json();
    expect(body.incidentsStatus).toBe("quotaBlocked");
    expect(traffic.calls).toBe(0);
  });
});

describe("selectRouteProvider", () => {
  it("ROUTES_PROVIDER=kakao와 키가 모두 있을 때만 실제 공급자", async () => {
    const isMock = async (env: Record<string, string | undefined>) => {
      const r = await selectRouteProvider(env).fetchRoute(SAME_SIDE, { kind: "recommend", label: "카카오 추천" });
      return r.ok && r.route.provider === "mock";
    };
    expect(await isMock({})).toBe(true);
    expect(await isMock({ KAKAO_REST_API_KEY: "k" })).toBe(true);
    expect(await isMock({ ROUTES_PROVIDER: "kakao" })).toBe(true);
    expect("calls" in selectRouteProvider({ ROUTES_PROVIDER: "kakao", KAKAO_REST_API_KEY: "k" })).toBe(false);
  });
});
