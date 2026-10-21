import type { Coordinate } from "../../../shared/contracts/route.js";
import type { TrafficGasResponse } from "../../../shared/contracts/traffic.js";
import { isInJeju } from "../../../shared/rules/geo.js";
import { katecToWgs84, wgs84ToKatec } from "../../../shared/rules/katec.js";
import { ProviderError } from "../errors.js";

export type GasRow = TrafficGasResponse["stations"][number];

export interface GasSnapshot {
  stations: GasRow[];
  source: "opinet" | "mock";
  /** 진단용: 부른 칸 수, 주유소가 1곳 이상 온 칸 수, 칸별 결과가 서로 다른 가짓수(모두 같으면 1). */
  meta?: { calls: number; nonEmpty: number; distinctResults: number };
}

export interface GasProvider {
  readonly id: "opinet";
  /** 부를 호출 수(사용량 예약용). */
  readonly calls: number;
  fetchStations(): Promise<GasSnapshot>;
}

/** 오피넷 반경 내 주유소(TASK-018 시험: JSON이지만 content-type은 text/html, RESULT.OIL[], 좌표 KATEC). */
const URL_BASE = "https://www.opinet.co.kr/api/aroundAll.do";
const RADIUS_METERS = 5000;
const PRODUCTS = { gasoline: "B027", diesel: "D047" } as const;
/** 동시 호출 수. 오피넷이 몰린 요청을 어떻게 다루는지 확인되지 않아 낮게 둔다. */
const CONCURRENCY = 3;
const TIMEOUT_MS = 15_000;

/** 제주 본섬 해안선을 대강 따라간 다각형(격자 중심을 고르는 데만 쓴다). */
const JEJU_OUTLINE: [number, number][] = [
  [33.52, 126.48], [33.56, 126.76], [33.53, 126.86], [33.46, 126.94], [33.39, 126.88], [33.32, 126.84], [33.26, 126.62], [33.235, 126.51],
  [33.24, 126.42], [33.21, 126.29], [33.24, 126.18], [33.33, 126.16], [33.42, 126.25], [33.46, 126.31], [33.5, 126.4],
];
const KM_LNG = 93;
const KM_LAT = 111;

function insideOutline(lat: number, lng: number): boolean {
  let c = false;
  for (let i = 0, j = JEJU_OUTLINE.length - 1; i < JEJU_OUTLINE.length; j = i++) {
    const [ya, xa] = JEJU_OUTLINE[i]!;
    const [yb, xb] = JEJU_OUTLINE[j]!;
    if (ya > lat !== yb > lat && lng < ((xb - xa) * (lat - ya)) / (yb - ya) + xa) c = !c;
  }
  return c;
}

function kmToOutline(lat: number, lng: number): number {
  let best = Infinity;
  for (let i = 0, j = JEJU_OUTLINE.length - 1; i < JEJU_OUTLINE.length; j = i++) {
    const [ya, xa] = JEJU_OUTLINE[i]!.map((v, k) => v * (k ? KM_LNG : KM_LAT)) as [number, number];
    const [yb, xb] = JEJU_OUTLINE[j]!.map((v, k) => v * (k ? KM_LNG : KM_LAT)) as [number, number];
    const [py, px] = [lat * KM_LAT, lng * KM_LNG];
    const dx = xb - xa;
    const dy = yb - ya;
    const t = Math.max(0, Math.min(1, ((px - xa) * dx + (py - ya) * dy) / (dx * dx + dy * dy)));
    best = Math.min(best, Math.hypot(px - xa - t * dx, py - ya - t * dy));
  }
  return best;
}

/**
 * 반경 5km 원으로 제주를 덮는 중심점들. 약 7km 간격 격자(칸의 대각선 절반 4.95km < 5km) 중
 * 섬 안이거나 해안선에서 6km 안인 점만(약 60곳). 해안선이 대강이라 여유를 둔다.
 */
export function jejuGrid(): Coordinate[] {
  const out: Coordinate[] = [];
  for (let lat = 33.18; lat <= 33.6; lat += 0.063) {
    for (let lng = 126.12; lng <= 127.0; lng += 0.075) {
      if (insideOutline(lat, lng) || kmToOutline(lat, lng) <= 6) out.push({ lat: Number(lat.toFixed(4)), lng: Number(lng.toFixed(4)) });
    }
  }
  return out;
}

/** 응답 한 건 → [ID, 상표, 이름, 가격, 위도, 경도]. 가격 0·좌표 이상은 버리거나 null. */
export function parseAround(body: unknown): { id: string; brand: string; name: string; price: number | null; lat: number; lng: number }[] {
  const oil = (body as { RESULT?: { OIL?: unknown } } | null)?.RESULT?.OIL;
  if (!Array.isArray(oil)) throw new ProviderError("unavailable", "opinet: RESULT.OIL 없음");
  const out = [];
  for (const i of oil as Record<string, unknown>[]) {
    const id = String(i.UNI_ID ?? "").trim();
    const x = Number(i.GIS_X_COOR);
    const y = Number(i.GIS_Y_COOR);
    if (!id || !Number.isFinite(x) || !Number.isFinite(y) || x <= 0 || y <= 0) continue;
    const at = katecToWgs84({ x, y });
    if (!isInJeju(at)) continue;
    const p = Number(i.PRICE);
    out.push({ id, brand: String(i.POLL_DIV_CD ?? "").trim(), name: String(i.OS_NM ?? "").trim(), price: Number.isFinite(p) && p > 0 ? Math.round(p) : null, lat: Number(at.lat.toFixed(6)), lng: Number(at.lng.toFixed(6)) });
  }
  return out;
}

/** 격자 중심마다 휘발유·경유를 1건씩 부르고 주유소 ID로 합친다. 일부 칸이 실패하면 전체 장애(빈칸이 생긴 지도를 보관하지 않음). */
export function createOpinetGasProvider(apiKey: string, fetchImpl: typeof fetch = fetch): GasProvider {
  const grid = jejuGrid().map((c) => wgs84ToKatec(c));
  const jobs = grid.flatMap((k) => (Object.keys(PRODUCTS) as (keyof typeof PRODUCTS)[]).map((fuel) => ({ k, fuel })));
  const one = async ({ k, fuel }: (typeof jobs)[number]) => {
    // 좌표는 정수로(TASK-018 시험에서 확인된 형식. 소수점 좌표로 부르면 모든 칸이 같은 결과(제주 전체 60곳)로 와 의심, 2026-10-21).
    const q = `code=${encodeURIComponent(apiKey)}&x=${Math.round(k.x)}&y=${Math.round(k.y)}&radius=${RADIUS_METERS}&sort=1&prodcd=${PRODUCTS[fuel]}&out=json`;
    const res = await fetchImpl(`${URL_BASE}?${q}`, { signal: AbortSignal.timeout(TIMEOUT_MS) });
    if (res.status === 429) throw new ProviderError("rate_limited", "opinet 429");
    if (!res.ok) throw new ProviderError("unavailable", `opinet ${res.status}`);
    // content-type이 text/html이라 글자로 받아 해석한다.
    const text = await res.text();
    let body: unknown;
    try {
      body = JSON.parse(text);
    } catch {
      throw new ProviderError("unavailable", `opinet: JSON 아님 ${text.slice(0, 60)}`);
    }
    return { fuel, rows: parseAround(body) };
  };
  return {
    id: "opinet",
    calls: jobs.length,
    async fetchStations() {
      const merged = new Map<string, GasRow>();
      let nonEmpty = 0;
      const results = new Set<string>();
      for (let i = 0; i < jobs.length; i += CONCURRENCY) {
        for (const { fuel, rows } of await Promise.all(jobs.slice(i, i + CONCURRENCY).map(one))) {
          if (rows.length) nonEmpty += 1;
          results.add(`${fuel}:${rows.map((r) => r.id).sort().join(",")}`);
          for (const r of rows) {
            const row = merged.get(r.id) ?? [r.id, r.brand, r.name, null, null, r.lat, r.lng];
            if (fuel === "gasoline") row[3] = r.price;
            else row[4] = r.price;
            merged.set(r.id, row);
          }
        }
      }
      const meta = { calls: jobs.length, nonEmpty, distinctResults: results.size };
      // Vercel 로그에서 확인할 수 있게 건수만 남긴다(키·위치 없음).
      console.info("opinet gas", { ...meta, stations: merged.size });
      return { stations: [...merged.values()], source: "opinet", meta };
    },
  };
}

/** 개발용 모의 주유소(제주시청 부근 3곳 + 먼 곳 1곳). 실제 주유소·가격이 아니다. */
export function createMockGasProvider(): GasProvider & { fetches: number } {
  const rows: GasRow[] = [
    ["MOCK-G1", "SKE", "모의 도남주유소", 1867, 1845, 33.4918, 126.5273],
    ["MOCK-G2", "RTO", "모의 알뜰주유소", 1849, 1829, 33.505, 126.55],
    ["MOCK-G3", "SOL", "모의 S-OIL 셀프주유소", 1889, null, 33.515, 126.53],
    ["MOCK-G4", "GSC", "모의 중문주유소", 1899, 1879, 33.25, 126.41],
  ];
  return {
    id: "opinet",
    calls: 1,
    fetches: 0,
    async fetchStations() {
      this.fetches += 1;
      return { stations: rows, source: "mock" };
    },
  };
}
