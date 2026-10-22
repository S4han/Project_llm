import type { TrafficTourDetailResponse, TrafficTourResponse } from "../../../shared/contracts/traffic.js";
import { isInJeju } from "../../../shared/rules/geo.js";
import { ProviderError } from "../errors.js";
import { serviceKeyParam } from "./jejuCityEnforcement.js";

export type TourRow = TrafficTourResponse["spots"][number];
export type TourDetail = Omit<TrafficTourDetailResponse, "builtAt">;

export interface TourSnapshot {
  spots: TourRow[];
  source: "kto" | "mock";
}

export interface TourProvider {
  readonly id: "kto";
  fetchSpots(): Promise<TourSnapshot>;
  fetchDetail(id: string): Promise<TourDetail>;
}

/** 한국관광공사 국문 관광정보 서비스_GW(공공데이터포털 15101578). TASK-026 시험: 제주(areaCode 39) 관광지 194곳, 응답 {response:{header,body:{items:{item}}}}. */
const BASE = "https://apis.data.go.kr/B551011/KorService2";
const COMMON = "MobileOS=ETC&MobileApp=JejuTraffic&_type=json";
const PAGE_SIZE = 1000;
const MAX_PAGES = 3;
const TIMEOUT_MS = 20_000;

const text = (v: unknown) => String(v ?? "").trim();

/** 원천 글자의 HTML(<br>, 링크 등)을 걷어 내고 줄을 정리한다. 화면은 textContent로만 쓴다. */
export function plainText(v: unknown): string {
  return text(v)
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]*>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&")
    .split("\n")
    .map((l) => l.replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .join("\n");
}

/** 대표 사진: 관광공사 사진 서버(visitkorea.or.kr) 주소만, https로 바꿔서(사이트가 https라 http 그림은 막힐 수 있음). 그 밖에는 "". */
export function imageUrl(v: unknown): string {
  const t = text(v);
  const m = /^https?:\/\/([a-z0-9.-]+\.visitkorea\.or\.kr)(\/[^\s"'<>]*)$/i.exec(t);
  return m ? `https://${m[1]}${m[2]}` : "";
}

function items(body: unknown): { list: Record<string, unknown>[]; totalCount: number } {
  const b = body as { response?: { header?: { resultCode?: unknown; resultMsg?: unknown }; body?: { totalCount?: unknown; items?: { item?: unknown } | string } } } | null;
  const code = text(b?.response?.header?.resultCode);
  if (code !== "0000") throw new ProviderError(code === "22" ? "rate_limited" : "unavailable", `관광정보 응답 오류 ${code || "형식"}`);
  const raw = typeof b?.response?.body?.items === "object" ? b.response.body.items.item : undefined;
  const list = (Array.isArray(raw) ? raw : raw ? [raw] : []) as Record<string, unknown>[];
  return { list, totalCount: Number(b?.response?.body?.totalCount) || list.length };
}

/** 목록 한 쪽 → 관광지. 좌표가 없거나 제주 밖(원천 오타 포함)이면 버린다. */
export function normalizeTourPage(body: unknown): { spots: TourRow[]; totalCount: number } {
  const { list, totalCount } = items(body);
  const spots: TourRow[] = [];
  for (const i of list) {
    const id = text(i.contentid);
    const lat = Number(i.mapy);
    const lng = Number(i.mapx);
    if (!id || !text(i.title) || !isInJeju({ lat, lng })) continue;
    const cp = text(i.cpyrhtDivCd);
    spots.push([id, plainText(i.title), [text(i.addr1), text(i.addr2)].filter(Boolean).join(" "), lat, lng, imageUrl(i.firstimage), cp === "Type1" || cp === "Type3" ? cp : ""]);
  }
  return { spots, totalCount };
}

/** 소개정보(detailIntro2, 관광지) → 이용시간·쉬는날·주차·문의. */
export function normalizeTourDetail(id: string, body: unknown): TourDetail {
  const i = items(body).list[0] ?? {};
  return { id, usetime: plainText(i.usetime), restdate: plainText(i.restdate), parking: plainText(i.parking), infocenter: plainText(i.infocenter), source: "kto" };
}

export function createKtoTourProvider(apiKey: string, fetchImpl: typeof fetch = fetch): TourProvider {
  const get = async (op: string, params: string) => {
    let res: Response;
    try {
      res = await fetchImpl(`${BASE}/${op}?serviceKey=${serviceKeyParam(apiKey)}&${COMMON}&${params}`, { signal: AbortSignal.timeout(TIMEOUT_MS) });
    } catch {
      throw new ProviderError("unavailable", "관광정보 연결 실패");
    }
    if (res.status === 429) throw new ProviderError("rate_limited", "관광정보 한도");
    if (!res.ok) throw new ProviderError("unavailable", `관광정보 HTTP ${res.status}`);
    try {
      return await res.json();
    } catch {
      throw new ProviderError("unavailable", "관광정보 응답 형식");
    }
  };
  return {
    id: "kto",
    async fetchSpots() {
      const spots: TourRow[] = [];
      for (let n = 1; n <= MAX_PAGES; n++) {
        const page = normalizeTourPage(await get("areaBasedList2", `areaCode=39&contentTypeId=12&numOfRows=${PAGE_SIZE}&pageNo=${n}&arrange=A`));
        spots.push(...page.spots);
        if (n * PAGE_SIZE >= page.totalCount) break;
      }
      return { spots, source: "kto" };
    },
    async fetchDetail(id) {
      return normalizeTourDetail(id, await get("detailIntro2", `contentId=${encodeURIComponent(id)}&contentTypeId=12`));
    },
  };
}

/** 개발용 모의 관광지(제주시청 부근 2곳 + 서귀포 1곳). 실제 관광지 정보가 아니다. */
export function createMockTourProvider(): TourProvider & { calls: number } {
  const rows: TourRow[] = [
    ["MOCK-T1", "모의 사라봉", "제주시 모의동 20", 33.5135, 126.5445, "", ""],
    ["MOCK-T2", "모의 신산공원", "제주시 모의동 21", 33.5045, 126.5385, "", ""],
    ["MOCK-T3", "모의 천지연폭포", "서귀포시 모의동 22", 33.2465, 126.5545, "", ""],
  ];
  const details: Record<string, Omit<TourDetail, "id" | "source">> = {
    "MOCK-T1": { usetime: "상시 개방", restdate: "연중무휴", parking: "가능 (승용차 30대)", infocenter: "모의 안내소 064-000-0020" },
    "MOCK-T2": { usetime: "06:00~22:00", restdate: "", parking: "불가능", infocenter: "" },
  };
  return {
    id: "kto",
    calls: 0,
    async fetchSpots() {
      this.calls += 1;
      return { spots: rows, source: "mock" };
    },
    async fetchDetail(id) {
      this.calls += 1;
      const d = details[id] ?? { usetime: "", restdate: "", parking: "", infocenter: "" };
      return { id, ...d, source: "mock" };
    },
  };
}
