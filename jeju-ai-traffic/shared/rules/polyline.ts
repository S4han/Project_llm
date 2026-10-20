import type { Coordinate } from "../contracts/route.js";

/** Google polyline 인코딩(정밀도 1e5, 약 1m). 구간 모양을 작게 보내는 데 쓴다(TASK-012). */
export function encodePolyline(points: Coordinate[]): string {
  let out = "";
  let prevLat = 0;
  let prevLng = 0;
  const enc = (v: number) => {
    let s = v < 0 ? ~(v << 1) : v << 1;
    let r = "";
    while (s >= 0x20) {
      r += String.fromCharCode((0x20 | (s & 0x1f)) + 63);
      s >>= 5;
    }
    return r + String.fromCharCode(s + 63);
  };
  for (const p of points) {
    const lat = Math.round(p.lat * 1e5);
    const lng = Math.round(p.lng * 1e5);
    out += enc(lat - prevLat) + enc(lng - prevLng);
    prevLat = lat;
    prevLng = lng;
  }
  return out;
}

export function decodePolyline(text: string): Coordinate[] {
  const points: Coordinate[] = [];
  let i = 0;
  let lat = 0;
  let lng = 0;
  const next = () => {
    let result = 0;
    let shift = 0;
    let b: number;
    do {
      b = text.charCodeAt(i++) - 63;
      result |= (b & 0x1f) << shift;
      shift += 5;
    } while (b >= 0x20);
    return result & 1 ? ~(result >> 1) : result >> 1;
  };
  while (i < text.length) {
    lat += next();
    lng += next();
    points.push({ lat: lat / 1e5, lng: lng / 1e5 });
  }
  return points;
}

/** Douglas-Peucker 단순화. tolMeters 안쪽의 점은 버린다(제주 위도에서 경도 1도 ≈ 93km로 근사). */
export function simplifyLine(points: Coordinate[], tolMeters: number): Coordinate[] {
  if (points.length <= 2) return points;
  const kx = 93_000;
  const ky = 111_000;
  const keep = new Array<boolean>(points.length).fill(false);
  keep[0] = keep[points.length - 1] = true;
  const stack: [number, number][] = [[0, points.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop()!;
    const pa = points[a]!;
    const pb = points[b]!;
    const dx = (pb.lng - pa.lng) * kx;
    const dy = (pb.lat - pa.lat) * ky;
    const len = Math.hypot(dx, dy) || 1;
    let max = 0;
    let idx = -1;
    for (let i = a + 1; i < b; i++) {
      const p = points[i]!;
      const px = (p.lng - pa.lng) * kx;
      const py = (p.lat - pa.lat) * ky;
      const d = Math.abs(dx * py - dy * px) / len;
      if (d > max) [max, idx] = [d, i];
    }
    if (max > tolMeters && idx > 0) {
      keep[idx] = true;
      stack.push([a, idx], [idx, b]);
    }
  }
  return points.filter((_, i) => keep[i]);
}
