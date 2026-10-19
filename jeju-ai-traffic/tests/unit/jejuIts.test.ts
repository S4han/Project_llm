import { describe, expect, it } from "vitest";
import { ProviderError } from "../../api/_lib/errors";
import { createJejuItsProvider, normalizeItsResponse, parseKstTime } from "../../api/_lib/providers/jejuIts";
import { ITS_EMPTY, ITS_EVENTS, ITS_NOT_REGISTERED, ITS_WORKS } from "../fixtures/jejuIts";

const AT = "2026-10-19T07:00:00.000Z";

describe("parseKstTime", () => {
  it("KST 시각 문자열을 ISO(UTC)로", () => {
    expect(parseKstTime("2026-10-19 15:58:00")).toBe("2026-10-19T06:58:00.000Z");
    expect(parseKstTime("202610190930")).toBe("2026-10-19T00:30:00.000Z");
    expect(parseKstTime("2026-10-19")).toBeNull();
    expect(parseKstTime(null)).toBeNull();
  });
});

describe("normalizeItsResponse", () => {
  it("좌표를 읽고 무효 좌표(90,180)는 버리며, 원천 시각이 없으면 null", () => {
    expect(normalizeItsResponse(ITS_EVENTS, "event", AT)).toEqual([
      {
        id: "event-e1",
        kind: "event",
        description: "정지차량",
        location: { lat: 33.4366, lng: 126.4242 },
        observedAt: AT,
        sourceTime: "2026-10-19T06:58:00.000Z",
        source: "jejuIts",
      },
      {
        id: "event-e2",
        kind: "event",
        description: "정지차량",
        location: { lat: 33.4366, lng: 126.4242 },
        observedAt: AT,
        sourceTime: null,
        source: "jejuIts",
      },
    ]);
  });

  it("설명 필드가 없으면 종류 이름, ID가 없으면 link_id와 순번", () => {
    const [work] = normalizeItsResponse(ITS_WORKS, "roadwork", AT);
    expect(work).toMatchObject({ id: "roadwork-4070002-0", description: "도로 공사", sourceTime: "2026-10-19T00:30:00.000Z" });
  });

  it("result가 success가 아니면 장애(키 미등록 등)", () => {
    expect(() => normalizeItsResponse(ITS_NOT_REGISTERED, "event", AT)).toThrow(ProviderError);
    expect(() => normalizeItsResponse(null, "event", AT)).toThrow(ProviderError);
  });
});

describe("createJejuItsProvider (모의 fetch, 실제 호출 없음)", () => {
  function fakeFetch(byName: Record<string, { status: number; body: unknown }>) {
    const urls: string[] = [];
    const impl = (async (url: string) => {
      urls.push(url);
      const name = new URL(url).pathname.split("/").pop()!;
      const r = byName[name]!;
      return Response.json(r.body, { status: r.status });
    }) as unknown as typeof fetch;
    return { impl, urls };
  }
  const ok = (body: unknown) => ({ status: 200, body });

  it("돌발·통제·공사 3회를 http 주소와 code 파라미터로 호출하고 합친다", async () => {
    const { impl, urls } = fakeFetch({
      infoRoadEventList: ok(ITS_EVENTS),
      infoRoadCloseList: ok(ITS_EMPTY),
      infoRoadWorkList: ok(ITS_WORKS),
    });
    const incidents = await createJejuItsProvider("test-key", impl, () => new Date(AT)).fetchIncidents();
    expect(urls.sort()).toEqual([
      "http://api.jejuits.go.kr/api/infoRoadCloseList?code=test-key",
      "http://api.jejuits.go.kr/api/infoRoadEventList?code=test-key",
      "http://api.jejuits.go.kr/api/infoRoadWorkList?code=test-key",
    ]);
    expect(incidents.map((i) => i.kind)).toEqual(["event", "event", "roadwork"]);
  });

  it("일부 실패는 성공분, 모두 실패는 장애, 모두 429는 rate_limited", async () => {
    const partial = fakeFetch({
      infoRoadEventList: ok(ITS_EVENTS),
      infoRoadCloseList: { status: 500, body: {} },
      infoRoadWorkList: ok(ITS_NOT_REGISTERED),
    });
    expect(await createJejuItsProvider("k", partial.impl).fetchIncidents()).toHaveLength(2);

    const allFail = fakeFetch({
      infoRoadEventList: { status: 500, body: {} },
      infoRoadCloseList: ok(ITS_NOT_REGISTERED),
      infoRoadWorkList: { status: 503, body: {} },
    });
    await expect(createJejuItsProvider("k", allFail.impl).fetchIncidents()).rejects.toMatchObject({ kind: "unavailable" });

    const limited = fakeFetch({
      infoRoadEventList: { status: 429, body: {} },
      infoRoadCloseList: { status: 429, body: {} },
      infoRoadWorkList: { status: 429, body: {} },
    });
    await expect(createJejuItsProvider("k", limited.impl).fetchIncidents()).rejects.toMatchObject({ kind: "rate_limited" });
  });
});
