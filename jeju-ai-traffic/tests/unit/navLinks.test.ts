import { describe, expect, it } from "vitest";
import type { Place } from "../../shared/contracts/place";
import { destinationText, kakaoMapRouteUrl, naverMapRouteUrl, toNavDestination } from "../../shared/rules/navLinks";

const place = (over: Partial<Place> = {}): Place => ({
  id: "p",
  name: "서귀포시청 제1청사",
  address: "제주특별자치도 서귀포시 서귀동 314-1",
  roadAddress: "제주특별자치도 서귀포시 중앙로 105",
  location: { lat: 33.2541, lng: 126.5601 },
  provider: "kakaoLocal",
  ...over,
});

describe("외부 내비 목적지", () => {
  it("이름·좌표·도로명 주소만 담는다", () => {
    expect(toNavDestination(place())).toEqual({ name: "서귀포시청 제1청사", lat: 33.2541, lng: 126.5601, address: "제주특별자치도 서귀포시 중앙로 105" });
    expect(toNavDestination(place({ roadAddress: null }))?.address).toBe("제주특별자치도 서귀포시 서귀동 314-1");
  });

  it("제주 밖·무효 좌표는 넘기지 않는다", () => {
    expect(toNavDestination(place({ location: { lat: 37.5, lng: 127 } }))).toBeNull();
    expect(toNavDestination(place({ location: { lat: Number.NaN, lng: 126.5 } }))).toBeNull();
  });
});

describe("링크 생성", () => {
  const d = toNavDestination(place())!;

  it("카카오맵: /link/to/이름,위도,경도 (이름 인코딩, 좌표 소수 6자리)", () => {
    expect(kakaoMapRouteUrl(d)).toBe(
      `https://map.kakao.com/link/to/${encodeURIComponent("서귀포시청 제1청사")},33.254100,126.560100`,
    );
  });

  it("카카오맵: 이름 속 쉼표는 구분자와 섞이지 않게 공백으로", () => {
    const url = kakaoMapRouteUrl({ ...d, name: "A,B" });
    expect(url).toBe("https://map.kakao.com/link/to/A%20B,33.254100,126.560100");
    expect(decodeURIComponent(url.split("/link/to/")[1]!).split(",")).toHaveLength(3);
  });

  it("네이버지도: nmap://route/car 에 dlat·dlng·dname·appname", () => {
    const url = naverMapRouteUrl({ ...d, name: "동문시장 & 야시장?" }, "jeju-its-probe.vercel.app");
    expect(url.startsWith("nmap://route/car?")).toBe(true);
    const q = new URLSearchParams(url.split("?")[1]);
    expect(Object.fromEntries(q)).toEqual({ dlat: "33.254100", dlng: "126.560100", dname: "동문시장 & 야시장?", appname: "jeju-its-probe.vercel.app" });
  });

  it("출발지는 어떤 링크에도 들어가지 않는다", () => {
    for (const url of [kakaoMapRouteUrl(d), naverMapRouteUrl(d, "x")]) {
      expect(url).not.toMatch(/slat|slng|sname|\/from\//);
    }
  });

  it("복사 문구는 이름과 주소", () => {
    expect(destinationText(d)).toBe("서귀포시청 제1청사\n제주특별자치도 서귀포시 중앙로 105");
  });
});
