import { describe, expect, it } from "vitest";
import { ProviderError } from "../../api/_lib/errors";
import { createKakaoLocalProvider, normalizeKakaoKeyword } from "../../api/_lib/providers/kakaoLocal";
import { KAKAO_KEYWORD_BODY } from "../fixtures/kakaoLocal";

describe("normalizeKakaoKeyword", () => {
  it("제주 주소·유효 좌표만 남기고 빈 도로명 주소는 null로 바꾼다", () => {
    expect(normalizeKakaoKeyword(KAKAO_KEYWORD_BODY)).toEqual([
      {
        id: "1001",
        name: "성산일출봉",
        address: "제주특별자치도 서귀포시 성산읍 성산리 1",
        roadAddress: null,
        location: { lat: 33.4581, lng: 126.9425 },
        provider: "kakaoLocal",
      },
      {
        id: "1002",
        name: "제주국제공항",
        address: "제주특별자치도 제주시 용담이동 2002",
        roadAddress: "제주특별자치도 제주시 공항로 2",
        location: { lat: 33.5066, lng: 126.4929 },
        provider: "kakaoLocal",
      },
    ]);
  });

  it("documents가 없으면 공급자 장애로 본다", () => {
    expect(() => normalizeKakaoKeyword({})).toThrow(ProviderError);
    expect(() => normalizeKakaoKeyword(null)).toThrow(ProviderError);
  });
});

describe("createKakaoLocalProvider (모의 fetch, 실제 호출 없음)", () => {
  function fakeFetch(status: number, body: unknown) {
    const calls: { url: URL; init?: RequestInit }[] = [];
    const impl = (async (url: URL, init?: RequestInit) => {
      calls.push({ url, init });
      return Response.json(body, { status });
    }) as unknown as typeof fetch;
    return { impl, calls };
  }

  it("제주 범위(rect)와 KakaoAK 인증 헤더로 요청한다", async () => {
    const { impl, calls } = fakeFetch(200, KAKAO_KEYWORD_BODY);
    const places = await createKakaoLocalProvider("test-key", impl).search("성산");
    expect(places).toHaveLength(2);
    const { url, init } = calls[0]!;
    expect(url.origin + url.pathname).toBe("https://dapi.kakao.com/v2/local/search/keyword.json");
    expect(url.searchParams.get("query")).toBe("성산");
    expect(url.searchParams.get("rect")).toBe("126,33,127,34");
    expect(new Headers(init?.headers).get("authorization")).toBe("KakaoAK test-key");
  });

  it("429는 rate_limited, 그 밖의 실패는 unavailable", async () => {
    for (const [status, kind] of [
      [429, "rate_limited"],
      [500, "unavailable"],
      [401, "unavailable"],
    ] as const) {
      const { impl } = fakeFetch(status, { errorType: "x" });
      const err = await createKakaoLocalProvider("test-key", impl)
        .search("성산")
        .then(
          () => undefined,
          (e: unknown) => e,
        );
      expect(err).toBeInstanceOf(ProviderError);
      expect((err as ProviderError).kind).toBe(kind);
    }
  });
});
