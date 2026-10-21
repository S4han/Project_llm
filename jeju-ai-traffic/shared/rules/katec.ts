import type { Coordinate } from "../contracts/route.js";

/**
 * 위도·경도(WGS84) ↔ KATEC(오피넷 좌표, TASK-018) 변환.
 * KATEC = Bessel 타원체, 원점 북위 38°·동경 128°, 축척 0.9999, 가산 x 400,000·y 600,000 m 횡메르카토르.
 * 측지계 변환은 proj4의 KATEC 정의와 같은 7변수(towgs84 -115.80,474.99,674.11,1.16,-2.31,-1.63,6.43).
 */
export interface Katec {
  x: number;
  y: number;
}

const WGS84 = { a: 6378137, f: 1 / 298.257223563 };
const BESSEL = { a: 6377397.155, f: 1 / 299.1528128 };
const LAT0 = (38 * Math.PI) / 180;
const LON0 = (128 * Math.PI) / 180;
const K0 = 0.9999;
const FE = 400000;
const FN = 600000;
const SEC = Math.PI / (180 * 3600);
const T = { dx: -115.8, dy: 474.99, dz: 674.11, rx: 1.16 * SEC, ry: -2.31 * SEC, rz: -1.63 * SEC, s: 6.43e-6 };

type Ellipsoid = { a: number; f: number };
const e2 = (el: Ellipsoid) => el.f * (2 - el.f);

function toEcef(lat: number, lon: number, el: Ellipsoid): [number, number, number] {
  const es = e2(el);
  const n = el.a / Math.sqrt(1 - es * Math.sin(lat) ** 2);
  return [n * Math.cos(lat) * Math.cos(lon), n * Math.cos(lat) * Math.sin(lon), n * (1 - es) * Math.sin(lat)];
}

function fromEcef([x, y, z]: [number, number, number], el: Ellipsoid): [number, number] {
  const es = e2(el);
  const p = Math.hypot(x, y);
  let lat = Math.atan2(z, p * (1 - es));
  for (let i = 0; i < 6; i++) {
    const n = el.a / Math.sqrt(1 - es * Math.sin(lat) ** 2);
    lat = Math.atan2(z + es * n * Math.sin(lat), p);
  }
  return [lat, Math.atan2(y, x)];
}

/** Bessel → WGS84(위치 벡터 방식, proj4 towgs84와 같음). inverse면 반대 방향(작은 각 근사로 부호를 뒤집는다). */
function helmert([x, y, z]: [number, number, number], inverse: boolean): [number, number, number] {
  if (!inverse) {
    const m = 1 + T.s;
    return [T.dx + m * (x - T.rz * y + T.ry * z), T.dy + m * (T.rz * x + y - T.rx * z), T.dz + m * (-T.ry * x + T.rx * y + z)];
  }
  const m = 1 / (1 + T.s);
  const [u, v, w] = [x - T.dx, y - T.dy, z - T.dz];
  return [m * (u + T.rz * v - T.ry * w), m * (-T.rz * u + v + T.rx * w), m * (T.ry * u - T.rx * v + w)];
}

/** 자오선 호 길이(Snyder 3-21). */
function meridian(lat: number, es: number, a: number): number {
  const e4 = es * es;
  const e6 = e4 * es;
  return a * ((1 - es / 4 - (3 * e4) / 64 - (5 * e6) / 256) * lat - ((3 * es) / 8 + (3 * e4) / 32 + (45 * e6) / 1024) * Math.sin(2 * lat) + ((15 * e4) / 256 + (45 * e6) / 1024) * Math.sin(4 * lat) - ((35 * e6) / 3072) * Math.sin(6 * lat));
}

function tmForward(lat: number, lon: number): Katec {
  const { a } = BESSEL;
  const es = e2(BESSEL);
  const ep2 = es / (1 - es);
  const n = a / Math.sqrt(1 - es * Math.sin(lat) ** 2);
  const t = Math.tan(lat) ** 2;
  const c = ep2 * Math.cos(lat) ** 2;
  const A = (lon - LON0) * Math.cos(lat);
  const m = meridian(lat, es, a);
  const m0 = meridian(LAT0, es, a);
  const x = K0 * n * (A + ((1 - t + c) * A ** 3) / 6 + ((5 - 18 * t + t * t + 72 * c - 58 * ep2) * A ** 5) / 120);
  const y = K0 * (m - m0 + n * Math.tan(lat) * (A ** 2 / 2 + ((5 - t + 9 * c + 4 * c * c) * A ** 4) / 24 + ((61 - 58 * t + t * t + 600 * c - 330 * ep2) * A ** 6) / 720));
  return { x: x + FE, y: y + FN };
}

function tmInverse({ x, y }: Katec): [number, number] {
  const { a } = BESSEL;
  const es = e2(BESSEL);
  const ep2 = es / (1 - es);
  const m = meridian(LAT0, es, a) + (y - FN) / K0;
  const mu = m / (a * (1 - es / 4 - (3 * es * es) / 64 - (5 * es ** 3) / 256));
  const e1 = (1 - Math.sqrt(1 - es)) / (1 + Math.sqrt(1 - es));
  const lat1 = mu + ((3 * e1) / 2 - (27 * e1 ** 3) / 32) * Math.sin(2 * mu) + ((21 * e1 ** 2) / 16 - (55 * e1 ** 4) / 32) * Math.sin(4 * mu) + ((151 * e1 ** 3) / 96) * Math.sin(6 * mu) + ((1097 * e1 ** 4) / 512) * Math.sin(8 * mu);
  const c1 = ep2 * Math.cos(lat1) ** 2;
  const t1 = Math.tan(lat1) ** 2;
  const n1 = a / Math.sqrt(1 - es * Math.sin(lat1) ** 2);
  const r1 = (a * (1 - es)) / (1 - es * Math.sin(lat1) ** 2) ** 1.5;
  const d = (x - FE) / (n1 * K0);
  const lat = lat1 - ((n1 * Math.tan(lat1)) / r1) * (d ** 2 / 2 - ((5 + 3 * t1 + 10 * c1 - 4 * c1 * c1 - 9 * ep2) * d ** 4) / 24 + ((61 + 90 * t1 + 298 * c1 + 45 * t1 * t1 - 252 * ep2 - 3 * c1 * c1) * d ** 6) / 720);
  const lon = LON0 + (d - ((1 + 2 * t1 + c1) * d ** 3) / 6 + ((5 - 2 * c1 + 28 * t1 - 3 * c1 * c1 + 8 * ep2 + 24 * t1 * t1) * d ** 5) / 120) / Math.cos(lat1);
  return [lat, lon];
}

const rad = (d: number) => (d * Math.PI) / 180;
const deg = (r: number) => (r * 180) / Math.PI;

export function wgs84ToKatec(c: Coordinate): Katec {
  const [lat, lon] = fromEcef(helmert(toEcef(rad(c.lat), rad(c.lng), WGS84), true), BESSEL);
  return tmForward(lat, lon);
}

export function katecToWgs84(k: Katec): Coordinate {
  const [lat, lon] = tmInverse(k);
  const [la, lo] = fromEcef(helmert(toEcef(lat, lon, BESSEL), false), WGS84);
  return { lat: deg(la), lng: deg(lo) };
}
