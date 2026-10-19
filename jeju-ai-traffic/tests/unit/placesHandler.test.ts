import { describe, expect, it } from "vitest";
import { handlePlaces, selectPlaceProvider, type PlacesDeps } from "../../api/_lib/places";
import { DEFAULT_BUDGETS, MemoryQuotaStore, QuotaGuard } from "../../api/_lib/policies/quota";
import { RateLimiter } from "../../api/_lib/policies/rateLimit";
import { createMockPlaceProvider, MOCK_PLACES } from "../../api/_lib/providers/mockPlaces";
import type { Place } from "../../shared/contracts/place";

const NOW = new Date("2026-10-19T03:00:00.000Z");

function setup(places?: Place[]) {
  const provider = createMockPlaceProvider(places);
  const guard = new QuotaGuard(new MemoryQuotaStore(), DEFAULT_BUDGETS, () => NOW);
  const deps: PlacesDeps = { provider, guard, limiter: new RateLimiter(20, 60_000, () => NOW.getTime()), now: () => NOW };
  const get = (q: string | null, ip = "1.1.1.1") =>
    handlePlaces(
      new Request(`http://localhost/api/places${q === null ? "" : `?q=${encodeURIComponent(q)}`}`, {
        headers: { "x-real-ip": ip },
      }),
      deps,
    );
  return { provider, guard, get };
}

describe("GET /api/places", () => {
  it("검색어에 맞는 제주 장소와 기준 시각을 돌려준다", async () => {
    const { get } = setup();
    const res = await get(" 성산 ");
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    const body = await res.json();
    expect(body.query).toBe("성산");
    expect(body.places.map((p: Place) => p.name)).toEqual(["성산일출봉"]);
    expect(body.observedAt).toBe(NOW.toISOString());
  });

  it("결과가 없으면 빈 목록(200)", async () => {
    const { get } = setup();
    const body = await (await get("없는장소이름")).json();
    expect(body.places).toEqual([]);
  });

  it("검색어가 비었거나 50자를 넘으면 400 INVALID_INPUT, 공급자 호출 없음", async () => {
    const { get, provider } = setup();
    for (const q of [null, "", "   ", "가".repeat(51)]) {
      const res = await get(q);
      expect(res.status).toBe(400);
      expect((await res.json()).error.code).toBe("INVALID_INPUT");
    }
    expect((await get("가".repeat(50))).status).toBe(200);
    expect(provider.calls).toBe(1);
  });

  it("같은 IP의 분당 21번째 요청은 429, 다른 IP는 허용", async () => {
    const { get, provider } = setup();
    for (let i = 0; i < 20; i++) expect((await get("공항")).status).toBe(200);
    const res = await get("공항");
    expect(res.status).toBe(429);
    expect((await res.json()).error.retryAfter).toBe("2026-10-19T03:01:00.000Z");
    expect(provider.calls).toBe(20);
    expect((await get("공항", "2.2.2.2")).status).toBe(200);
  });

  it("일일 한도 3,000건에 도달하면 429, 공급자 호출 0회", async () => {
    const { get, guard, provider } = setup();
    await guard.reserve("kakaoLocal", { cost: 3000 });
    const res = await get("공항");
    expect(res.status).toBe(429);
    expect(res.headers.get("retry-after")).toBe(String(12 * 3600));
    expect(provider.calls).toBe(0);
  });

  it("공급자가 제주 밖 장소를 주더라도 응답에서 뺀다", async () => {
    const busan: Place = {
      id: "x",
      name: "공항 부산",
      address: "부산 강서구",
      roadAddress: null,
      location: { lat: 35.17, lng: 128.95 },
      provider: "mock",
    };
    const { get } = setup([...MOCK_PLACES, busan]);
    const body = await (await get("공항")).json();
    expect(body.places.map((p: Place) => p.id)).toEqual(["mock-airport"]);
  });

  it("공급자 장애는 503 PROVIDER_UNAVAILABLE", async () => {
    const { get, provider } = setup();
    provider.search = async () => {
      throw new Error("down");
    };
    const res = await get("공항");
    expect(res.status).toBe(503);
    expect((await res.json()).error.code).toBe("PROVIDER_UNAVAILABLE");
  });
});

describe("selectPlaceProvider", () => {
  it("PLACES_PROVIDER=kakao와 키가 모두 있을 때만 실제 공급자, 그 외는 모의", async () => {
    const isMock = async (env: Record<string, string | undefined>) =>
      (await selectPlaceProvider(env).search("성산")).every((p) => p.provider === "mock");
    expect(await isMock({})).toBe(true);
    expect(await isMock({ KAKAO_REST_API_KEY: "k" })).toBe(true);
    expect(await isMock({ PLACES_PROVIDER: "kakao" })).toBe(true);
    expect("calls" in selectPlaceProvider({ PLACES_PROVIDER: "kakao", KAKAO_REST_API_KEY: "k" })).toBe(false);
  });
});
