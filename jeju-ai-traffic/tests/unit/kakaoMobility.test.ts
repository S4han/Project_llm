import { describe, expect, it } from "vitest";
import { ProviderError } from "../../api/_lib/errors";
import { createKakaoMobilityProvider, normalizeKakaoDirections } from "../../api/_lib/providers/kakaoMobility";
import type { RouteQuery } from "../../shared/rules/route";
import { DIRECTIONS_OK, directionsNoRoute } from "../fixtures/kakaoMobility";

const AT = "2026-10-19T00:00:00.000Z";
const RECOMMEND: RouteQuery = { kind: "recommend", label: "카카오 추천" };
const REQUEST = { origin: { lat: 33.5066, lng: 126.4929 }, destination: { lat: 33.2541, lng: 126.5601 } };

describe("normalizeKakaoDirections", () => {
  it("요약값을 그대로 쓰고 vertexes를 좌표로 바꾼다", () => {
    expect(normalizeKakaoDirections(DIRECTIONS_OK, RECOMMEND, AT)).toEqual({
      ok: true,
      route: {
        id: "recommend",
        provider: "kakao",
        label: "카카오 추천",
        durationSeconds: 4166,
        distanceMeters: 52300,
        geometry: [
          { lat: 33.5066, lng: 126.4929 },
          { lat: 33.45, lng: 126.49 },
          { lat: 33.35, lng: 126.52 },
          { lat: 33.2541, lng: 126.5601 },
        ],
        observedAt: AT,
        trafficStatus: "unknown",
      },
    });
  });

  it("result_code 102·103·그 외는 경로 없음과 이유", () => {
    expect(normalizeKakaoDirections(directionsNoRoute(102, "시작 지점"), RECOMMEND, AT)).toEqual({
      ok: false,
      reason: "originUnreachable",
    });
    expect(normalizeKakaoDirections(directionsNoRoute(103, "도착 지점"), RECOMMEND, AT)).toEqual({
      ok: false,
      reason: "destinationUnreachable",
    });
    expect(normalizeKakaoDirections(directionsNoRoute(1, "실패"), RECOMMEND, AT)).toEqual({ ok: false, reason: "notFound" });
  });

  it("형식이 맞지 않으면 공급자 장애", () => {
    expect(() => normalizeKakaoDirections({}, RECOMMEND, AT)).toThrow(ProviderError);
    expect(() => normalizeKakaoDirections({ routes: [{}] }, RECOMMEND, AT)).toThrow(ProviderError);
    expect(() => normalizeKakaoDirections({ routes: [{ result_code: 0, summary: {} }] }, RECOMMEND, AT)).toThrow(
      ProviderError,
    );
  });
});

describe("createKakaoMobilityProvider (모의 fetch, 실제 호출 없음)", () => {
  function fakeFetch(status: number, body: unknown) {
    const calls: { url: string; init?: RequestInit }[] = [];
    const impl = (async (url: URL | string, init?: RequestInit) => {
      calls.push({ url: String(url), init });
      return Response.json(body, { status });
    }) as unknown as typeof fetch;
    return { impl, calls };
  }

  it("우선순위 호출은 GET /v1/directions, origin·destination은 '경도,위도'", async () => {
    const { impl, calls } = fakeFetch(200, DIRECTIONS_OK);
    const provider = createKakaoMobilityProvider("test-key", impl, () => new Date(AT));
    await provider.fetchRoute(REQUEST, RECOMMEND);
    await provider.fetchRoute(REQUEST, { kind: "distance", label: "최단거리" });
    const first = new URL(calls[0]!.url);
    expect(first.origin + first.pathname).toBe("https://apis-navi.kakaomobility.com/v1/directions");
    expect(first.searchParams.get("origin")).toBe("126.4929,33.5066");
    expect(first.searchParams.get("destination")).toBe("126.5601,33.2541");
    expect(first.searchParams.get("priority")).toBe("RECOMMEND");
    expect(new URL(calls[1]!.url).searchParams.get("priority")).toBe("DISTANCE");
    expect(new Headers(calls[0]!.init?.headers).get("authorization")).toBe("KakaoAK test-key");
  });

  it("경유지 호출은 POST /v1/waypoints/directions", async () => {
    const { impl, calls } = fakeFetch(200, DIRECTIONS_OK);
    const via = { lat: 33.3575, lng: 126.463 };
    const result = await createKakaoMobilityProvider("test-key", impl).fetchRoute(REQUEST, {
      kind: "via1100",
      label: "1100도로 경유",
      via,
    });
    expect(result.ok && result.route.id).toBe("via1100");
    expect(calls[0]!.url).toBe("https://apis-navi.kakaomobility.com/v1/waypoints/directions");
    expect(calls[0]!.init?.method).toBe("POST");
    expect(JSON.parse(String(calls[0]!.init?.body))).toEqual({
      origin: { x: 126.4929, y: 33.5066 },
      destination: { x: 126.5601, y: 33.2541 },
      waypoints: [{ x: 126.463, y: 33.3575 }],
      priority: "RECOMMEND",
    });
  });

  it("429는 rate_limited, 그 밖의 실패는 unavailable", async () => {
    for (const [status, kind] of [
      [429, "rate_limited"],
      [500, "unavailable"],
      [401, "unavailable"],
    ] as const) {
      const { impl } = fakeFetch(status, {});
      const err = await createKakaoMobilityProvider("test-key", impl)
        .fetchRoute(REQUEST, RECOMMEND)
        .then(
          () => undefined,
          (e: unknown) => e,
        );
      expect((err as ProviderError).kind).toBe(kind);
    }
  });
});
