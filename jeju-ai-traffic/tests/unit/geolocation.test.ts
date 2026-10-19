import { describe, expect, it } from "vitest";
import { getCurrentLocation } from "../../web/src/services/geolocation";

function fakeGeo(outcome: { coords?: { latitude: number; longitude: number; accuracy: number }; errorCode?: number }) {
  let options: PositionOptions | undefined;
  const geo = {
    getCurrentPosition(ok: PositionCallback, fail?: PositionErrorCallback | null, opts?: PositionOptions) {
      options = opts;
      if (outcome.coords) ok({ coords: outcome.coords } as GeolocationPosition);
      else fail?.({ code: outcome.errorCode } as GeolocationPositionError);
    },
  } as unknown as Geolocation;
  return { geo, options: () => options };
}

const AIRPORT = { latitude: 33.5066, longitude: 126.4929 };

describe("getCurrentLocation", () => {
  it("정확도 200m 이하 + 제주 안이면 ok, 10초 시간 제한·고정밀로 요청한다", async () => {
    const { geo, options } = fakeGeo({ coords: { ...AIRPORT, accuracy: 200 } });
    expect(await getCurrentLocation(geo)).toEqual({
      kind: "ok",
      location: { lat: 33.5066, lng: 126.4929 },
      accuracyMeters: 200,
    });
    expect(options()).toEqual({ enableHighAccuracy: true, timeout: 10_000, maximumAge: 0 });
  });

  it("정확도 200m 초과면 inaccurate", async () => {
    const { geo } = fakeGeo({ coords: { ...AIRPORT, accuracy: 201 } });
    expect(await getCurrentLocation(geo)).toEqual({ kind: "inaccurate", accuracyMeters: 201 });
  });

  it("제주 밖이면 outsideJeju", async () => {
    const { geo } = fakeGeo({ coords: { latitude: 37.57, longitude: 126.98, accuracy: 10 } });
    expect((await getCurrentLocation(geo)).kind).toBe("outsideJeju");
  });

  it("오류 코드 1·2·3 → denied·unavailable·timeout, 위치 기능 없음 → unsupported", async () => {
    expect((await getCurrentLocation(fakeGeo({ errorCode: 1 }).geo)).kind).toBe("denied");
    expect((await getCurrentLocation(fakeGeo({ errorCode: 2 }).geo)).kind).toBe("unavailable");
    expect((await getCurrentLocation(fakeGeo({ errorCode: 3 }).geo)).kind).toBe("timeout");
    expect((await getCurrentLocation(undefined)).kind).toBe("unsupported");
  });
});
