import type { TrafficGasResponse } from "../../../shared/contracts/traffic.js";
import { isInJeju } from "../../../shared/rules/geo.js";
import { katecToWgs84 } from "../../../shared/rules/katec.js";
import { ProviderError } from "../errors.js";

export type GasRow = TrafficGasResponse["stations"][number];

export interface GasSnapshot {
  stations: GasRow[];
  source: "jejuIts" | "mock";
}

export interface GasProvider {
  readonly id: "jejuIts";
  /** 부를 호출 수(사용량 예약용). */
  readonly calls: number;
  fetchStations(): Promise<GasSnapshot>;
}

/**
 * 제주 ITS(C-ITS) 주유소 기본정보·가격(TASK-018 범위 변경). 돌발 키(JEJU_ITS_API_KEY)로 열림(시험: 224곳, 두 목록 ID 모두 일치).
 * 좌표는 오피넷 KATEC(gisxcoor·gisycoor), 가격은 없으면 0. 제주 전체를 한 번에 준다(호출 2건).
 */
const URL_BASE = "http://api.jejuits.go.kr/api";
const TIMEOUT_MS = 15_000;

const text = (v: unknown) => String(v ?? "").trim();
const price = (v: unknown): number | null => {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? Math.round(n) : null;
};

function items(body: unknown, path: string): Record<string, unknown>[] {
  const b = body as { result?: unknown; info?: unknown; Info?: unknown } | null;
  if (!b || b.result !== "success") throw new ProviderError("unavailable", `jejuIts ${path}: result ${String(b?.result)}`);
  return (Array.isArray(b.info) ? b.info : Array.isArray(b.Info) ? b.Info : []) as Record<string, unknown>[];
}

/** 기본정보 + 가격 → 주유소. 좌표가 없거나 제주 밖이면 버린다. 상표는 주유소 상표, 없으면 충전소 상표. */
export function joinGas(info: unknown, prices: unknown): GasRow[] {
  const byId = new Map(items(prices, "infoGasPriceList").map((p) => [text(p.id), p]));
  const out: GasRow[] = [];
  for (const i of items(info, "infoGasInfoList")) {
    const id = text(i.id);
    const x = Number(i.gisxcoor);
    const y = Number(i.gisycoor);
    if (!id || !(x > 0) || !(y > 0)) continue;
    const at = katecToWgs84({ x, y });
    if (!isInJeju(at)) continue;
    const p = byId.get(id) ?? {};
    out.push([id, text(i.poll) || text(i.gpoll), text(i.osnm), price(p.gasoline), price(p.diesel), Number(at.lat.toFixed(6)), Number(at.lng.toFixed(6)), price(p.lpg), text(i.adr), text(i.tel)]);
  }
  return out;
}

export function createJejuItsGasProvider(apiKey: string, fetchImpl: typeof fetch = fetch): GasProvider {
  const get = async (path: string) => {
    const res = await fetchImpl(`${URL_BASE}/${path}?code=${encodeURIComponent(apiKey)}`, { signal: AbortSignal.timeout(TIMEOUT_MS) });
    if (res.status === 429) throw new ProviderError("rate_limited", "jejuIts gas 429");
    if (!res.ok) throw new ProviderError("unavailable", `jejuIts ${path} ${res.status}`);
    return res.json();
  };
  return {
    id: "jejuIts",
    calls: 2,
    async fetchStations() {
      const [info, prices] = await Promise.all([get("infoGasInfoList"), get("infoGasPriceList")]);
      return { stations: joinGas(info, prices), source: "jejuIts" };
    },
  };
}

/** 개발용 모의 주유소(제주시청 부근 3곳 + 먼 곳 1곳 + LPG 충전소 1곳). 실제 주유소·가격이 아니다. */
export function createMockGasProvider(): GasProvider & { fetches: number } {
  const rows: GasRow[] = [
    ["MOCK-G1", "SKE", "모의 도남주유소", 1867, 1845, 33.4918, 126.5273, null, "제주시 모의동 1", "064-000-0001"],
    ["MOCK-G2", "RTO", "모의 알뜰주유소", 1849, 1829, 33.505, 126.55, null, "제주시 모의동 2", ""],
    ["MOCK-G3", "SOL", "모의 S-OIL 셀프주유소", 1889, null, 33.515, 126.53, null, "제주시 모의동 3", ""],
    ["MOCK-G4", "GSC", "모의 중문주유소", 1899, 1879, 33.25, 126.41, null, "서귀포시 모의동 4", ""],
    ["MOCK-L1", "SKG", "모의 LPG충전소", null, null, 33.498, 126.52, 1178, "제주시 모의동 5", ""],
  ];
  return {
    id: "jejuIts",
    calls: 1,
    fetches: 0,
    async fetchStations() {
      this.fetches += 1;
      return { stations: rows, source: "mock" };
    },
  };
}
