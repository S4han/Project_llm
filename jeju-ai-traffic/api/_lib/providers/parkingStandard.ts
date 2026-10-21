import type { TrafficParkingResponse } from "../../../shared/contracts/traffic.js";
import { isInJeju } from "../../../shared/rules/geo.js";
import { ProviderError } from "../errors.js";
import { serviceKeyParam } from "./jejuCityEnforcement.js";

export type ParkingRow = TrafficParkingResponse["lots"][number];

export interface ParkingSnapshot {
  lots: ParkingRow[];
  source: "dataGoKr" | "mock";
}

export interface ParkingProvider {
  readonly id: "dataGoKr";
  /** reserve는 첫 쪽에서 전체 쪽 수를 알게 된 뒤 남은 호출 수를 사용량에 예약한다. */
  fetchLots(reserve: (calls: number) => Promise<void>): Promise<ParkingSnapshot>;
}

/** 전국주차장정보표준데이터(공공데이터포털 15012896). TASK-017 시험: 응답 최상위가 {header, body}(response 없이). */
const URL_BASE = "http://api.data.go.kr/openapi/tn_pubr_prkplce_info_api";
/** 제공기관 코드: 제주시·서귀포시(TASK-017 시험 확인). */
export const PARKING_INSTITUTIONS = ["6510000", "6520000"] as const;
const PAGE_SIZE = 1000;
const MAX_PAGES = 5;
const TIMEOUT_MS = 20_000;

const text = (v: unknown) => String(v ?? "").trim();
const num = (v: unknown): number | null => {
  const t = text(v);
  const n = Number(t.replace(/,/g, ""));
  return t !== "" && Number.isFinite(n) ? n : null;
};
const won = (n: number) => `${n.toLocaleString("ko-KR")}원`;

/** "평일 09:00~18:00 · 토 09:00~13:00". 같은 시간이면 묶고, 00:00~23:59(또는 24:00)는 "24시간". */
export function hoursText(i: Record<string, unknown>): string {
  const span = (a: unknown, b: unknown) => {
    const s = text(a);
    const e = text(b);
    if (!s || !e) return "";
    return s === "00:00" && (e === "23:59" || e === "24:00") ? "24시간" : `${s}~${e}`;
  };
  const parts: [string, string][] = [
    ["평일", span(i.weekdayOperOpenHhmm, i.weekdayOperColseHhmm)],
    ["토", span(i.satOperOperOpenHhmm, i.satOperCloseHhmm)],
    ["공휴일", span(i.holidayOperOpenHhmm, i.holidayCloseOpenHhmm)],
  ];
  const known = parts.filter(([, s]) => s);
  if (!known.length) return text(i.operDay);
  if (known.length === 3 && known.every(([, s]) => s === known[0]![1])) return `매일 ${known[0]![1]}`;
  return known.map(([d, s]) => `${d} ${s}`).join(" · ");
}

/** "무료" 또는 "유료 · 기본 30분 1,000원 · 추가 10분 300원". 원천 금액이 없으면 구분만. */
export function feeText(i: Record<string, unknown>): string {
  const kind = text(i.parkingchrgeInfo);
  if (kind === "무료") return "무료";
  const bt = num(i.basicTime);
  const bc = num(i.basicCharge);
  const at = num(i.addUnitTime);
  const ac = num(i.addUnitCharge);
  const parts = [kind || "요금 정보 없음"];
  if (bt !== null && bc !== null && bc > 0) parts.push(`기본 ${bt}분 ${won(bc)}`);
  if (at !== null && ac !== null && ac > 0) parts.push(`추가 ${at}분 ${won(ac)}`);
  return parts.join(" · ");
}

/** 응답 한 쪽 → 주차장. 결과코드 00이 아니면 장애. 좌표가 없거나 제주 밖이면 버린다. */
export function normalizeParkingPage(body: unknown): { lots: ParkingRow[]; totalCount: number } {
  const b = body as { response?: unknown; header?: unknown; body?: unknown; OpenAPI_ServiceResponse?: { cmmMsgHeader?: { errMsg?: unknown } } } | null;
  const root = (b?.response ?? b) as { header?: { resultCode?: unknown; resultMsg?: unknown }; body?: { totalCount?: unknown; items?: unknown } } | null;
  if (!root || text(root.header?.resultCode) !== "00") {
    // 데이터 없음(03)은 빈 쪽으로 본다.
    if (text(root?.header?.resultCode) === "03") return { lots: [], totalCount: 0 };
    throw new ProviderError("unavailable", `dataGoKr parking: ${text(root?.header?.resultMsg) || text(b?.OpenAPI_ServiceResponse?.cmmMsgHeader?.errMsg) || "응답 없음"}`);
  }
  const raw = (root.body?.items as { item?: unknown } | undefined)?.item ?? root.body?.items;
  const items = (Array.isArray(raw) ? raw : raw && typeof raw === "object" ? [raw] : []) as Record<string, unknown>[];
  const lots: ParkingRow[] = [];
  for (const i of items) {
    const id = text(i.prkplceNo);
    const location = { lat: Number(i.latitude), lng: Number(i.longitude) };
    if (!id || !text(i.latitude) || !isInJeju(location)) continue;
    lots.push([id, text(i.prkplceNm), text(i.prkplceSe), text(i.prkplceType), text(i.rdnmadr) || text(i.lnmadr), num(i.prkcmprt), hoursText(i), feeText(i), location.lat, location.lng]);
  }
  return { lots, totalCount: Number(root.body?.totalCount) || lots.length };
}

/** 제주시·서귀포시를 1,000곳씩 쪽으로 받는다. 첫 쪽(기관당 1건)은 호출 쪽에서 예약하고, 남은 쪽은 reserve로 예약한다. */
export function createParkingStandardProvider(apiKey: string, fetchImpl: typeof fetch = fetch): ParkingProvider {
  const page = async (code: string, n: number) => {
    const res = await fetchImpl(`${URL_BASE}?serviceKey=${serviceKeyParam(apiKey)}&pageNo=${n}&numOfRows=${PAGE_SIZE}&type=json&instt_code=${code}`, { signal: AbortSignal.timeout(TIMEOUT_MS) });
    if (res.status === 429) throw new ProviderError("rate_limited", "dataGoKr 429");
    if (!res.ok) throw new ProviderError("unavailable", `dataGoKr ${res.status}`);
    return normalizeParkingPage(await res.json());
  };
  return {
    id: "dataGoKr",
    async fetchLots(reserve) {
      const lots: ParkingRow[] = [];
      for (const code of PARKING_INSTITUTIONS) {
        const first = await page(code, 1);
        lots.push(...first.lots);
        const pages = Math.min(MAX_PAGES, Math.ceil(first.totalCount / PAGE_SIZE));
        if (pages > 1) await reserve(pages - 1);
        for (let n = 2; n <= pages; n++) lots.push(...(await page(code, n)).lots);
      }
      const seen = new Set<string>();
      return { lots: lots.filter(([id]) => !seen.has(id) && Boolean(seen.add(id))), source: "dataGoKr" };
    },
  };
}

/** 개발용 모의 주차장(제주시청 부근 2곳 + 노형 1곳). 실제 주차장이 아니다. */
export function createMockParkingProvider(): ParkingProvider & { calls: number } {
  const rows: ParkingRow[] = [
    ["MOCK-P1", "모의 시청 공영주차장", "공영", "노외", "제주시 모의동 10", 91, "매일 24시간", "유료 · 기본 30분 1,000원 · 추가 15분 500원", 33.5005, 126.5325],
    ["MOCK-P2", "모의 신설오름 주차장", "민영", "부설", "제주시 모의동 11", 20, "평일 09:00~18:00 · 토 09:00~13:00", "유료", 33.5035, 126.539],
    ["MOCK-P3", "모의 노형 공영주차장", "공영", "노상", "제주시 모의동 12", null, "매일 24시간", "무료", 33.485, 126.481],
  ];
  return {
    id: "dataGoKr",
    calls: 0,
    async fetchLots() {
      this.calls += 1;
      return { lots: rows, source: "mock" };
    },
  };
}
