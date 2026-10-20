import type { TrafficEnforcementResponse } from "../../../shared/contracts/traffic.js";
import { isInJeju } from "../../../shared/rules/geo.js";
import { ProviderError } from "../errors.js";

export type EnforcementRow = TrafficEnforcementResponse["cameras"][number];

export interface EnforcementSnapshot {
  cameras: EnforcementRow[];
  source: "dataGoKr" | "mock";
}

export interface EnforcementProvider {
  readonly id: "dataGoKr";
  fetchCameras(): Promise<EnforcementSnapshot>;
}

/** 제주시 주정차 단속 CCTV 조회(공공데이터포털 15109175, 포털 페이지의 명세). TASK-016 시험: 370곳, 1쪽. */
const URL_BASE = "https://apis.data.go.kr/6510000/parkingControlCctvService/getParkingControlCctvList";
const PAGE_SIZE = 1000;
const TIMEOUT_MS = 15_000;

/**
 * 인증키를 주소에 붙인다. 포털의 인코딩 키('%' 포함)는 그대로, 일반(Decoding) 키는 인코딩해서.
 * 인코딩 키를 한 번 더 인코딩하면 "등록되지 않은 서비스키"가 된다(TASK-016 시험 확인).
 */
export function serviceKeyParam(key: string): string {
  const k = key.trim();
  return k.includes("%") ? k : encodeURIComponent(k);
}

const count = (v: unknown): number | null => {
  const n = Number(String(v ?? "").trim());
  return String(v ?? "").trim() !== "" && Number.isFinite(n) ? n : null;
};

/** 응답 → 단속 CCTV. 결과코드 00이 아니면 장애. 제주 밖·잘못된 좌표는 버린다. 장소 앞 번호("12. ")는 뗀다. */
export function normalizeEnforcementResponse(body: unknown): { cameras: EnforcementRow[]; totalCount: number } {
  const b = body as {
    response?: { header?: { resultCode?: unknown; resultMsg?: unknown }; body?: { totalCount?: unknown; items?: unknown } };
    OpenAPI_ServiceResponse?: { cmmMsgHeader?: { errMsg?: unknown } };
  } | null;
  const r = b?.response;
  if (!r || String(r.header?.resultCode) !== "00") {
    throw new ProviderError("unavailable", `dataGoKr enforcement: ${String(r?.header?.resultMsg ?? b?.OpenAPI_ServiceResponse?.cmmMsgHeader?.errMsg ?? "응답 없음")}`);
  }
  const raw = (r.body?.items as { item?: unknown } | undefined)?.item ?? r.body?.items;
  const items = (Array.isArray(raw) ? raw : raw && typeof raw === "object" ? [raw] : []) as Record<string, unknown>[];
  const cameras: EnforcementRow[] = [];
  for (const i of items) {
    const id = String(i.dataCd ?? "").trim();
    const location = { lat: Number(i.laCrdnt), lng: Number(i.loCrdnt) };
    if (!id || !isInJeju(location)) continue;
    const place = String(i.instlPlaceNm ?? "").trim().replace(/^\d+\.\s*/, "");
    const oper = String(i.operTimeInfo ?? "")
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean)
      .join("\n");
    cameras.push([id, place, String(i.instlAdres ?? "").trim(), count(i.rtateCctvCnt), count(i.auditCctvCnt), oper, location.lat, location.lng]);
  }
  return { cameras, totalCount: Number(r.body?.totalCount) || cameras.length };
}

/** 1쪽에 1,000곳씩. 지금은 1쪽(370곳)이지만 늘어나면 다음 쪽까지 받는다(최대 5쪽). */
export function createJejuCityEnforcementProvider(apiKey: string, fetchImpl: typeof fetch = fetch): EnforcementProvider {
  const page = async (n: number) => {
    const res = await fetchImpl(`${URL_BASE}?serviceKey=${serviceKeyParam(apiKey)}&pageNo=${n}&numOfRows=${PAGE_SIZE}`, { signal: AbortSignal.timeout(TIMEOUT_MS) });
    if (res.status === 429) throw new ProviderError("rate_limited", "dataGoKr 429");
    if (!res.ok) throw new ProviderError("unavailable", `dataGoKr ${res.status}`);
    return normalizeEnforcementResponse(await res.json());
  };
  return {
    id: "dataGoKr",
    async fetchCameras() {
      const first = await page(1);
      const cameras = [...first.cameras];
      const pages = Math.min(5, Math.ceil(first.totalCount / PAGE_SIZE));
      for (let n = 2; n <= pages; n++) cameras.push(...(await page(n)).cameras);
      const seen = new Set<string>();
      return { cameras: cameras.filter(([id]) => !seen.has(id) && Boolean(seen.add(id))), source: "dataGoKr" };
    },
  };
}

/** 개발용 모의 단속 CCTV(제주시청 부근). 실제 장소가 아니다. */
export function createMockEnforcementProvider(): EnforcementProvider & { calls: number } {
  const rows: EnforcementRow[] = [
    ["M1", "모의 시청 부근(중앙로)", "제주시 모의동 1", 1, 4, "07시30분 ~ 23시", 33.4988, 126.5305],
    ["M2", "모의 신설오름 부근(고마로)", "제주시 모의동 2", 1, 2, "평일 07시30분 ~ 22시\n공휴일 09시 ~ 18시", 33.5055, 126.5412],
    ["M3", "모의 노형 부근", "제주시 모의동 3", 2, null, "07시30분 ~ 17시\n(평일만 운영)", 33.485, 126.48],
  ];
  return {
    id: "dataGoKr",
    calls: 0,
    async fetchCameras() {
      this.calls += 1;
      return { cameras: rows, source: "mock" };
    },
  };
}
