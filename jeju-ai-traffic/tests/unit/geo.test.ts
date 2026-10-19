import { describe, expect, it } from "vitest";
import { checkTrip, distanceMeters, isInJeju, isJejuAddress, isValidCoordinate } from "../../shared/rules/geo";

const AIRPORT = { lat: 33.5066, lng: 126.4929 };
const SEONGSAN = { lat: 33.4581, lng: 126.9425 };

describe("좌표·제주 범위", () => {
  it("유한한 숫자와 위경도 범위만 유효하다", () => {
    expect(isValidCoordinate(AIRPORT)).toBe(true);
    expect(isValidCoordinate({ lat: Number.NaN, lng: 126 })).toBe(false);
    expect(isValidCoordinate({ lat: 91, lng: 126 })).toBe(false);
    expect(isValidCoordinate({ lat: 33, lng: Number.POSITIVE_INFINITY })).toBe(false);
  });

  it("제주 범위는 위도 33.0~34.0, 경도 126.0~127.0 (추자도·마라도 포함, 경계 포함)", () => {
    expect(isInJeju(AIRPORT)).toBe(true);
    expect(isInJeju({ lat: 33.96, lng: 126.3 })).toBe(true); // 추자도
    expect(isInJeju({ lat: 33.12, lng: 126.27 })).toBe(true); // 마라도
    expect(isInJeju({ lat: 33.0, lng: 127.0 })).toBe(true);
    expect(isInJeju({ lat: 35.1151, lng: 129.0414 })).toBe(false); // 부산
    expect(isInJeju({ lat: 34.0001, lng: 126.5 })).toBe(false);
    expect(isInJeju({ lat: 90, lng: 180 })).toBe(false);
  });

  it("주소는 '제주특별자치도'로 시작해야 한다", () => {
    expect(isJejuAddress("제주특별자치도 제주시 공항로 2")).toBe(true);
    expect(isJejuAddress("  제주특별자치도 서귀포시")).toBe(true);
    expect(isJejuAddress("부산 동구 초량동")).toBe(false);
    expect(isJejuAddress("")).toBe(false);
  });

  it("거리 계산(하버사인)", () => {
    expect(distanceMeters(AIRPORT, AIRPORT)).toBe(0);
    const d = distanceMeters(AIRPORT, SEONGSAN);
    expect(d).toBeGreaterThan(41_000);
    expect(d).toBeLessThan(43_000);
  });
});

describe("checkTrip", () => {
  it("출발지·목적지가 없거나 무효하면 문제를 돌려준다", () => {
    expect(checkTrip(null, SEONGSAN)).toBe("originMissing");
    expect(checkTrip({ lat: 37.5, lng: 127 }, SEONGSAN)).toBe("originInvalid");
    expect(checkTrip(AIRPORT, null)).toBe("destinationMissing");
    expect(checkTrip(AIRPORT, { lat: Number.NaN, lng: 126.5 })).toBe("destinationInvalid");
  });

  it("30m 이내는 같은 곳, 30m 초과는 허용", () => {
    const north = (m: number) => ({ lat: AIRPORT.lat + m / 111_195, lng: AIRPORT.lng });
    expect(checkTrip(AIRPORT, north(29))).toBe("samePlace");
    expect(checkTrip(AIRPORT, north(31))).toBeNull();
    expect(checkTrip(AIRPORT, SEONGSAN)).toBeNull();
  });
});
