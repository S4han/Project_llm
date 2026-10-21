import type { TrafficEvResponse } from "../../../shared/contracts/traffic.js";
import { isInJeju } from "../../../shared/rules/geo.js";
import { ProviderError } from "../errors.js";

/** 충전소 기본(충전 가능 수 제외): [ID, 이름, 주소, 위도, 경도, 급속 수, 완속 수, 이용 시간, 운영기관, 전화, 주차 무료]. */
export type EvStation = [string, string, string, number, number, number, number, string, string, string, string];
/** 충전소 ID → [급속 가능, 완속 가능]. */
export type EvStatus = Map<string, [number, number]>;
export type EvRow = TrafficEvResponse["stations"][number];

export interface EvProvider {
  readonly id: "jejuIts";
  readonly source: "jejuIts" | "mock";
  fetchStations(): Promise<EvStation[]>;
  fetchStatus(): Promise<EvStatus>;
}

/**
 * 제주 ITS(C-ITS) 전기차 충전소. 돌발 키(JEJU_ITS_API_KEY)로 열림(TASK-018·019 시험: 충전기 8,781대·충전소 3,219곳, 충전 가능 2,674곳).
 * 기본정보는 충전기 한 대가 한 줄이고 x_crdn=위도·y_crdn=경도(주유소 API와 반대). 일부 좌표가 제주 밖이라 버린다.
 */
const URL_BASE = "http://api.jejuits.go.kr/api";
const TIMEOUT_MS = 25_000;
/** 완속 충전기 종류(환경공단 코드: 02 AC완속, 08 DC콤보 완속). 그 밖은 급속으로 센다. */
const SLOW_TYPES = new Set(["02", "08"]);

const text = (v: unknown) => String(v ?? "").trim();

function items(body: unknown, path: string): Record<string, unknown>[] {
  const b = body as { result?: unknown; info?: unknown; Info?: unknown } | null;
  if (!b || b.result !== "success") throw new ProviderError("unavailable", `jejuIts ${path}: result ${String(b?.result)}`);
  return (Array.isArray(b.info) ? b.info : Array.isArray(b.Info) ? b.Info : []) as Record<string, unknown>[];
}

/** 충전기 목록 → 충전소(ID로 묶어 급속·완속 수를 센다). 주소는 도로명, 없으면 지번(+상세). */
export function groupEvStations(body: unknown): EvStation[] {
  const byId = new Map<string, EvStation>();
  for (const c of items(body, "infoEvInfoList")) {
    const id = text(c.id);
    const lat = Number(c.x_crdn);
    const lng = Number(c.y_crdn);
    if (!id || !isInJeju({ lat, lng })) continue;
    let st = byId.get(id);
    if (!st) {
      const addr = [text(c.daddr) || text(c.addr), text(c.daddr) ? text(c.daddr_dtl) : text(c.addr_dtl)].filter(Boolean).join(" ");
      st = [id, text(c.name), addr, Number(lat.toFixed(6)), Number(lng.toFixed(6)), 0, 0, text(c.use_time), text(c.b_name), text(c.b_call), text(c.free)];
      byId.set(id, st);
    }
    if (SLOW_TYPES.has(text(c.type))) st[6] += 1;
    else st[5] += 1;
  }
  return [...byId.values()];
}

export function parseEvStatus(body: unknown): EvStatus {
  const out: EvStatus = new Map();
  for (const s of items(body, "infoEvList")) {
    const id = text(s.id);
    if (id) out.set(id, [Math.max(0, Number(s.fast) || 0), Math.max(0, Number(s.slow) || 0)]);
  }
  return out;
}

/** 기본 + 충전 가능 → 응답 줄. 충전 가능 정보가 없는 충전소는 null. */
export function joinEv(stations: EvStation[], status: EvStatus | null): EvRow[] {
  return stations.map(([id, name, addr, lat, lng, fast, slow, use, biz, call, free]) => {
    const s = status?.get(id);
    return [id, name, addr, lat, lng, fast, slow, s ? Math.min(s[0], fast) : null, s ? Math.min(s[1], slow) : null, use, biz, call, free];
  });
}

export function createJejuItsEvProvider(apiKey: string, fetchImpl: typeof fetch = fetch): EvProvider {
  const get = async (path: string) => {
    const res = await fetchImpl(`${URL_BASE}/${path}?code=${encodeURIComponent(apiKey)}`, { signal: AbortSignal.timeout(TIMEOUT_MS) });
    if (res.status === 429) throw new ProviderError("rate_limited", "jejuIts ev 429");
    if (!res.ok) throw new ProviderError("unavailable", `jejuIts ${path} ${res.status}`);
    return res.json();
  };
  return {
    id: "jejuIts",
    source: "jejuIts",
    async fetchStations() {
      return groupEvStations(await get("infoEvInfoList"));
    },
    async fetchStatus() {
      return parseEvStatus(await get("infoEvList"));
    },
  };
}

/** 개발용 모의 충전소(제주시청 부근 3곳 + 먼 곳 1곳). 실제 충전소가 아니다. */
export function createMockEvProvider(): EvProvider & { calls: number } {
  const stations: EvStation[] = [
    ["MOCK-E1", "모의 시청 공영주차장 충전소", "제주시 모의동 1", 33.5, 126.531, 2, 4, "24시간 이용가능", "환경부", "1661-9408", "Y"],
    ["MOCK-E2", "모의 신설오름 충전소", "제주시 모의동 2", 33.504, 126.54, 0, 2, "09:00~18:00", "모의 운영사", "", "N"],
    ["MOCK-E3", "모의 노형 급속충전소", "제주시 모의동 3", 33.503, 126.533, 3, 0, "24시간 이용가능", "모의 운영사", "", ""],
    ["MOCK-E4", "모의 중문 충전소", "서귀포시 모의동 4", 33.25, 126.41, 1, 1, "24시간 이용가능", "환경부", "", "Y"],
  ];
  const status: EvStatus = new Map([
    ["MOCK-E1", [1, 2]],
    ["MOCK-E2", [0, 0]],
    ["MOCK-E4", [1, 1]],
  ]);
  return {
    id: "jejuIts",
    source: "mock",
    calls: 0,
    async fetchStations() {
      this.calls += 1;
      return stations;
    },
    async fetchStatus() {
      this.calls += 1;
      return status;
    },
  };
}
