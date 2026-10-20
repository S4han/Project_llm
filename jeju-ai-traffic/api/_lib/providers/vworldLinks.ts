import type { Coordinate } from "../../../shared/contracts/route.js";
import { encodePolyline, simplifyLine } from "../../../shared/rules/polyline.js";
import { ProviderError } from "../errors.js";
import { MOCK_LINK_IDS } from "./jejuItsSpeeds.js";

/** [link_id, 도로명, polyline]. */
export type LinkShape = [string, string, string];

export interface LinkProvider {
  readonly id: "vworld";
  readonly source: "vworld" | "mock";
  /** 제주 범위 교통링크 중 ids에 있는 구간만. reserve는 쪽 수를 알게 된 뒤 남은 호출 수를 사용량에 예약한다. */
  fetchLinks(ids: Set<string>, reserve: (calls: number) => Promise<void>): Promise<LinkShape[]>;
}

/** 브이월드 2D 데이터 API 교통링크(TASK-012 시험 확인: 제주 범위 37,087개, 쪽당 최대 1,000개). */
const URL_BASE = "https://api.vworld.kr/req/data";
const JEJU_BOX = "BOX(126.1,33.1,127.0,33.6)";
const PAGE_SIZE = 1000;
const CONCURRENCY = 6;
const TIMEOUT_MS = 20_000;
/** 모양 단순화 허용 오차(m). 지도에서 구분되지 않는 점을 버려 응답을 줄인다. */
const SIMPLIFY_METERS = 3;

interface VworldFeature {
  properties?: { link_id?: unknown; road_name?: unknown };
  geometry?: { type?: string; coordinates?: unknown };
}

interface VworldPage {
  status: string;
  totalPages: number;
  features: VworldFeature[];
}

/** 응답 한 쪽 → 상태·전체 쪽 수·구간. ERROR면 장애, NOT_FOUND면 빈 쪽. */
export function parseVworldPage(body: unknown): VworldPage {
  const r = (body as { response?: { status?: string; page?: { total?: string }; result?: { featureCollection?: { features?: VworldFeature[] } }; error?: { text?: string } } } | null)?.response;
  if (!r || (r.status !== "OK" && r.status !== "NOT_FOUND")) throw new ProviderError("unavailable", `vworld: ${r?.status ?? "응답 없음"} ${r?.error?.text ?? ""}`.trim());
  return { status: r.status, totalPages: Number(r.page?.total) || 0, features: r.result?.featureCollection?.features ?? [] };
}

/** 교통링크 하나 → 모양. MultiLineString은 조각을 이어 붙인다. 좌표가 2개 미만이면 null. */
export function toLinkShape(f: VworldFeature): LinkShape | null {
  const id = String(f.properties?.link_id ?? "");
  const g = f.geometry;
  const lines = (g?.type === "MultiLineString" ? g.coordinates : g?.type === "LineString" ? [g.coordinates] : []) as number[][][];
  const points: Coordinate[] = lines.flat().filter((c) => Array.isArray(c) && Number.isFinite(c[0]) && Number.isFinite(c[1])).map((c) => ({ lng: c[0]!, lat: c[1]! }));
  if (!id || points.length < 2) return null;
  return [id, String(f.properties?.road_name ?? "").trim(), encodePolyline(simplifyLine(points, SIMPLIFY_METERS))];
}

export function createVworldLinkProvider(apiKey: string, domain: string, fetchImpl: typeof fetch = fetch): LinkProvider {
  const page = async (n: number): Promise<VworldPage> => {
    const q = new URLSearchParams({
      service: "data",
      version: "2.0",
      request: "GetFeature",
      format: "json",
      errorformat: "json",
      size: String(PAGE_SIZE),
      page: String(n),
      data: "LT_L_MOCTLINK",
      geomFilter: JEJU_BOX,
      geometry: "true",
      attribute: "true",
      crs: "EPSG:4326",
      domain,
      key: apiKey,
    });
    const res = await fetchImpl(`${URL_BASE}?${q}`, { signal: AbortSignal.timeout(TIMEOUT_MS) });
    if (res.status === 429) throw new ProviderError("rate_limited", "vworld 429");
    if (!res.ok) throw new ProviderError("unavailable", `vworld ${res.status}`);
    return parseVworldPage(await res.json());
  };
  return {
    id: "vworld",
    source: "vworld",
    async fetchLinks(ids, reserve) {
      const first = await page(1);
      const rest = Array.from({ length: Math.max(0, first.totalPages - 1) }, (_, i) => i + 2);
      if (rest.length) await reserve(rest.length);
      const pages = [first];
      for (let i = 0; i < rest.length; i += CONCURRENCY) {
        pages.push(...(await Promise.all(rest.slice(i, i + CONCURRENCY).map(page))));
      }
      const out: LinkShape[] = [];
      for (const f of pages.flatMap((p) => p.features)) {
        if (!ids.has(String(f.properties?.link_id ?? ""))) continue;
        const shape = toLinkShape(f);
        if (shape) out.push(shape);
      }
      return out;
    },
  };
}

/** 모의 교통링크: 공항 → 서귀포시청 직선(모의 추천 경로)을 넷으로 나눈 구간과 같은 ID. 실제 도로가 아니다. */
export function createMockLinkProvider(): LinkProvider & { calls: number } {
  const a = { lat: 33.5066, lng: 126.4929 };
  const b = { lat: 33.2541, lng: 126.5601 };
  const at = (t: number) => ({ lat: a.lat + (b.lat - a.lat) * t, lng: a.lng + (b.lng - a.lng) * t });
  const names = ["모의 공항로", "모의 평화로", "모의 평화로", "모의 중앙로"];
  return {
    id: "vworld",
    source: "mock",
    calls: 0,
    async fetchLinks(ids) {
      this.calls += 1;
      return MOCK_LINK_IDS.map((id, i): LinkShape => [id, names[i]!, encodePolyline([at(i / 4), at((i + 1) / 4)])]).filter(([id]) => ids.has(id));
    },
  };
}
