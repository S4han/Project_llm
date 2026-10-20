import type { Coordinate } from "../../../shared/contracts/route";
import { isInJeju, MAX_GPS_ACCURACY_METERS } from "../../../shared/rules/geo";

export type LocationResult =
  | { kind: "ok"; location: Coordinate; accuracyMeters: number }
  | { kind: "inaccurate"; accuracyMeters: number }
  | { kind: "outsideJeju" }
  | { kind: "denied" }
  | { kind: "timeout" }
  | { kind: "unavailable" }
  | { kind: "unsupported" };

/** 위치 요청 시간 제한 10초 (DECISIONS 2026-10-19 TASK-004 "3. 승인"). */
export const LOCATION_TIMEOUT_MS = 10_000;

/** 현재 위치를 한 번 요청한다. 좌표는 호출한 쪽 메모리에만 두고 저장하지 않는다. maxAccuracyMeters보다 부정확하면 inaccurate. */
export function getCurrentLocation(
  geo: Geolocation | undefined = typeof navigator === "undefined" ? undefined : navigator.geolocation,
  maxAccuracyMeters = MAX_GPS_ACCURACY_METERS,
): Promise<LocationResult> {
  if (!geo) return Promise.resolve({ kind: "unsupported" });
  return new Promise((resolve) => {
    geo.getCurrentPosition(
      (pos) => {
        const accuracyMeters = Math.round(pos.coords.accuracy);
        const location = { lat: pos.coords.latitude, lng: pos.coords.longitude };
        if (accuracyMeters > maxAccuracyMeters) resolve({ kind: "inaccurate", accuracyMeters });
        else if (!isInJeju(location)) resolve({ kind: "outsideJeju" });
        else resolve({ kind: "ok", location, accuracyMeters });
      },
      (err) => {
        // GeolocationPositionError: 1 PERMISSION_DENIED, 2 POSITION_UNAVAILABLE, 3 TIMEOUT
        if (err.code === 1) resolve({ kind: "denied" });
        else if (err.code === 3) resolve({ kind: "timeout" });
        else resolve({ kind: "unavailable" });
      },
      { enableHighAccuracy: true, timeout: LOCATION_TIMEOUT_MS, maximumAge: 0 },
    );
  });
}
