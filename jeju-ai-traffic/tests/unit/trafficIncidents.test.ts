import { describe, expect, it } from "vitest";
import { handleTrafficIncidents, selectTrafficProvider, type TrafficIncidentsDeps } from "../../api/_lib/incidents";
import { DEFAULT_BUDGETS, MemoryQuotaStore, QuotaGuard } from "../../api/_lib/policies/quota";
import { RateLimiter } from "../../api/_lib/policies/rateLimit";
import { TtlCache } from "../../api/_lib/policies/ttlCache";
import { createMockTrafficProvider } from "../../api/_lib/providers/mockTraffic";

const NOW = new Date("2026-10-20T03:00:00.000Z");

function setup() {
  let clock = NOW.getTime();
  const traffic = createMockTrafficProvider(() => new Date(clock));
  const guard = new QuotaGuard(new MemoryQuotaStore(), DEFAULT_BUDGETS, () => new Date(clock));
  const deps: TrafficIncidentsDeps = {
    traffic,
    incidentCache: new TtlCache(60_000, () => clock),
    guard,
    limiter: new RateLimiter(20, 60_000, () => clock),
    now: () => new Date(clock),
  };
  const get = (ip = "1.1.1.1") => handleTrafficIncidents(new Request("http://localhost/api/traffic/incidents", { headers: { "x-real-ip": ip } }), deps);
  return { traffic, guard, get, advance: (ms: number) => (clock += ms) };
}

describe("GET /api/traffic/incidents (TASK-012)", () => {
  it("제주 전체 사건을 경로와 상관없이 돌려준다(no-store, 조회 시각)", async () => {
    const { get } = setup();
    const res = await get();
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    const body = await res.json();
    expect(body.status).toBe("ok");
    expect(body.incidents.map((i: { id: string }) => i.id)).toEqual(["mock-event-1", "mock-roadwork-1"]);
    expect(body.observedAt).toBe(NOW.toISOString());
    expect(body.retryAfter).toBeNull();
  });

  it("60초 안의 재조회는 캐시(ITS 호출 1회·사용량 3), 60초가 지나면 다시 호출", async () => {
    const { get, traffic, guard, advance } = setup();
    await get();
    await get("2.2.2.2");
    expect(traffic.calls).toBe(1);
    expect((await guard.status("jejuIts")).used).toBe(3);
    advance(61_000);
    await get();
    expect(traffic.calls).toBe(2);
  });

  it("ITS 한도면 200 + quotaBlocked·재사용 시각, ITS 호출 0회", async () => {
    const { get, traffic, guard } = setup();
    await guard.reserve("jejuIts", { cost: 6000 });
    const body = await (await get()).json();
    expect(body.status).toBe("quotaBlocked");
    expect(body.incidents).toEqual([]);
    expect(body.observedAt).toBeNull();
    expect(body.retryAfter).toBe("2026-10-20T15:00:00.000Z");
    expect(traffic.calls).toBe(0);
  });

  it("ITS 장애면 200 + unavailable (정보 없음을 '사건 없음'으로 보내지 않음)", async () => {
    const { get, traffic } = setup();
    traffic.fetchIncidents = async () => {
      throw new Error("down");
    };
    const body = await (await get()).json();
    expect(body.status).toBe("unavailable");
    expect(body.observedAt).toBeNull();
  });

  it("같은 IP 분당 21번째 요청은 429", async () => {
    const { get } = setup();
    for (let i = 0; i < 20; i++) expect((await get()).status).toBe(200);
    const res = await get();
    expect(res.status).toBe(429);
    expect((await res.json()).error.code).toBe("QUOTA_BLOCKED");
    expect((await get("3.3.3.3")).status).toBe(200);
  });

  it("TRAFFIC_PROVIDER=jejuIts와 키가 모두 있을 때만 실제 제주 ITS", () => {
    expect("calls" in selectTrafficProvider({})).toBe(true);
    expect("calls" in selectTrafficProvider({ JEJU_ITS_API_KEY: "k" })).toBe(true);
    expect("calls" in selectTrafficProvider({ TRAFFIC_PROVIDER: "jejuIts", JEJU_ITS_API_KEY: "k" })).toBe(false);
  });
});
