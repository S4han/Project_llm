import type { StayKind, TrafficStayResponse } from "../../../shared/contracts/traffic.js";
import { isInJeju } from "../../../shared/rules/geo.js";
import { ProviderError } from "../errors.js";
import { plainText } from "./ktoTour.js";

export type StayRow = TrafficStayResponse["stays"][number];

export interface StaySnapshot {
  stays: StayRow[];
  source: "visitJeju" | "mock";
}

export interface StayProvider {
  readonly id: "visitJeju";
  /** reserve는 첫 쪽에서 전체 쪽 수를 알게 된 뒤 남은 호출 수를 사용량에 예약한다. */
  fetchStays(reserve: (calls: number) => Promise<void>): Promise<StaySnapshot>;
}

/**
 * 비짓제주 관광정보 OPEN API(제주관광공사, 활용가이드 V1.1): GET /vsjApi/contents/searchList?apiKey&locale&page.
 * TASK-028 시험: 문서에 없는 category=c3로 숙박만 걸러진다(916곳·10쪽, 100곳씩). https로만 응답(http는 연결 실패한 적 있음).
 */
const BASE = "https://api.visitjeju.net/vsjApi/contents/searchList";
const MAX_PAGES = 15;
const TIMEOUT_MS = 20_000;

const text = (v: unknown) => String(v ?? "").trim();

/** 태그로 숙소 종류를 나눈다. 게스트하우스·펜션·민박을 먼저 보고, 호텔·리조트·콘도는 호텔로. */
export function stayKind(tags: string): StayKind {
  if (/게스트하우스|게하|호스텔/.test(tags)) return "GUEST";
  if (/펜션|풀빌라|독채/.test(tags)) return "PENSION";
  if (/민박/.test(tags)) return "MINBAK";
  if (/호텔|리조트|콘도/.test(tags)) return "HOTEL";
  return "ETC";
}

/** 사진: 비짓제주 사진 서버(api.cdn.visitjeju.net) https 주소만. */
export function stayPhoto(v: unknown): string {
  const t = text(v);
  return /^https:\/\/api\.cdn\.visitjeju\.net\/[^\s"'<>]+$/i.test(t) ? t : "";
}

/** 목록 한 쪽 → 숙소. 숙박(c3)이 아니거나 좌표가 제주 밖이면 버린다. 결과 코드가 200이 아니면 장애(키 오류 등). */
export function normalizeStayPage(body: unknown): { stays: StayRow[]; pageCount: number } {
  const b = body as { result?: unknown; resultMessage?: unknown; pageCount?: unknown; items?: unknown } | null;
  const code = text(b?.result);
  if (code !== "200") throw new ProviderError(code === "429" ? "rate_limited" : "unavailable", `비짓제주 응답 오류 ${code || "형식"}`);
  const items = (Array.isArray(b?.items) ? b.items : []) as Record<string, unknown>[];
  const stays: StayRow[] = [];
  for (const i of items) {
    const id = text(i.contentsid);
    const lat = Number(i.latitude);
    const lng = Number(i.longitude);
    if ((i.contentscd as { value?: unknown } | undefined)?.value !== "c3" || !id || !text(i.title) || !isInJeju({ lat, lng })) continue;
    const alltag = text(i.alltag);
    const tag = text(i.tag);
    const photo = (i.repPhoto as { photoid?: { thumbnailpath?: unknown; imgpath?: unknown } } | undefined)?.photoid;
    stays.push([
      id,
      plainText(i.title),
      text(i.roadaddress) || text(i.address),
      lat,
      lng,
      stayKind(`${tag},${alltag}`),
      /주차/.test(alltag),
      text(i.phoneno),
      stayPhoto(photo?.imgpath) || stayPhoto(photo?.thumbnailpath),
      plainText(i.introduction),
      tag,
    ]);
  }
  return { stays, pageCount: Number(b?.pageCount) || 1 };
}

export function createVisitJejuStayProvider(apiKey: string, fetchImpl: typeof fetch = fetch): StayProvider {
  const page = async (n: number) => {
    let res: Response;
    try {
      res = await fetchImpl(`${BASE}?apiKey=${encodeURIComponent(apiKey)}&locale=kr&category=c3&page=${n}`, { signal: AbortSignal.timeout(TIMEOUT_MS) });
    } catch {
      throw new ProviderError("unavailable", "비짓제주 연결 실패");
    }
    if (res.status === 429) throw new ProviderError("rate_limited", "비짓제주 한도");
    if (!res.ok) throw new ProviderError("unavailable", `비짓제주 HTTP ${res.status}`);
    try {
      return normalizeStayPage(await res.json());
    } catch (e) {
      throw e instanceof ProviderError ? e : new ProviderError("unavailable", "비짓제주 응답 형식");
    }
  };
  return {
    id: "visitJeju",
    async fetchStays(reserve) {
      const first = await page(1);
      const stays = [...first.stays];
      const pages = Math.min(MAX_PAGES, first.pageCount);
      if (pages > 1) await reserve(pages - 1);
      for (let n = 2; n <= pages; n++) stays.push(...(await page(n)).stays);
      const seen = new Set<string>();
      return { stays: stays.filter(([id]) => !seen.has(id) && Boolean(seen.add(id))), source: "visitJeju" };
    },
  };
}

/** 개발용 모의 숙소(모의 신산공원·사라봉 부근 3곳 + 서귀포 1곳). 실제 숙소가 아니다. */
export function createMockStayProvider(): StayProvider & { calls: number } {
  const rows: StayRow[] = [
    ["MOCK-S1", "모의 신산 호텔", "제주시 모의동 30", 33.5055, 126.5405, "HOTEL", true, "064-000-0030", "", "모의 시내 호텔", "호텔,숙소,조식 포함"],
    ["MOCK-S2", "모의 일도 게스트하우스", "제주시 모의동 31", 33.5085, 126.5345, "GUEST", false, "010-0000-0031", "", "모의 게스트하우스", "게스트하우스,숙소"],
    ["MOCK-S3", "모의 사라봉 펜션", "제주시 모의동 32", 33.5165, 126.5505, "PENSION", true, "", "", "모의 펜션", "펜션,숙소,자연경관"],
    ["MOCK-S4", "모의 서귀포 리조트", "서귀포시 모의동 33", 33.2485, 126.5605, "HOTEL", true, "064-000-0033", "", "", "리조트,숙소"],
  ];
  return {
    id: "visitJeju",
    calls: 0,
    async fetchStays() {
      this.calls += 1;
      return { stays: rows, source: "mock" };
    },
  };
}
