import type { Coordinate } from "../../../shared/contracts/route.js";
import { encodePolyline, simplifyLine } from "../../../shared/rules/polyline.js";
import { ProviderError } from "../errors.js";
import { MOCK_LINK_IDS } from "./jejuItsSpeeds.js";

/** [link_id, 도로명, polyline, 시작 지점 이름, 끝 지점 이름]. 지점 이름을 모르면 "". */
export type LinkShape = [string, string, string, string, string];

/** named가 false면 교통노드를 받지 못해 지점 이름이 모두 비어 있다(짧게만 보관). */
export interface LinkBuild {
  links: LinkShape[];
  named: boolean;
}

export interface LinkProvider {
  readonly id: "vworld";
  readonly source: "vworld" | "mock";
  /** 제주 범위 교통링크 중 ids에 있는 구간만. reserve는 쪽 수를 알게 된 뒤 남은 호출 수를 사용량에 예약한다. */
  fetchLinks(ids: Set<string>, reserve: (calls: number) => Promise<void>): Promise<LinkBuild>;
}

/** 브이월드 2D 데이터 API 교통링크(TASK-012 시험 확인: 제주 범위 37,087개, 쪽당 최대 1,000개). */
const URL_BASE = "https://api.vworld.kr/req/data";
const JEJU_BOX = "BOX(126.1,33.1,127.0,33.6)";
const PAGE_SIZE = 1000;
const CONCURRENCY = 6;
const TIMEOUT_MS = 20_000;
/** 모양 단순화 허용 오차(m). 지도에서 구분되지 않는 점을 버려 응답을 줄인다. */
const SIMPLIFY_METERS = 3;
/** 구간 끝점에서 이 거리 안의 가장 가까운 이름 있는 교통노드를 지점 이름으로 쓴다(TASK-015). */
export const NODE_NAME_METERS = 300;
/** 이름 없는 형상 점. 지점 이름으로 쓰지 않는다(TASK-015 교통노드 시험). */
const UNNAMED_NODE = "최소노드배치점";

interface VworldFeature {
  properties?: { link_id?: unknown; road_name?: unknown; node_name?: unknown };
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

/** 교통링크 하나 → [link_id, 도로명, polyline]. MultiLineString은 조각을 이어 붙인다. 좌표가 2개 미만이면 null. */
export function toLinkShape(f: VworldFeature): [string, string, string] | null {
  const id = String(f.properties?.link_id ?? "");
  const g = f.geometry;
  const lines = (g?.type === "MultiLineString" ? g.coordinates : g?.type === "LineString" ? [g.coordinates] : []) as number[][][];
  const points: Coordinate[] = lines.flat().filter((c) => Array.isArray(c) && Number.isFinite(c[0]) && Number.isFinite(c[1])).map((c) => ({ lng: c[0]!, lat: c[1]! }));
  if (!id || points.length < 2) return null;
  return [id, String(f.properties?.road_name ?? "").trim(), encodePolyline(simplifyLine(points, SIMPLIFY_METERS))];
}

/** 교통링크 좌표(경도, 위도)의 첫 점·끝 점. */
function endpoints(f: VworldFeature): [Coordinate, Coordinate] | null {
  const g = f.geometry;
  const lines = (g?.type === "MultiLineString" ? g.coordinates : g?.type === "LineString" ? [g.coordinates] : []) as number[][][];
  const pts = lines.flat().filter((c) => Array.isArray(c) && Number.isFinite(c[0]) && Number.isFinite(c[1]));
  if (pts.length < 2) return null;
  return [{ lng: pts[0]![0]!, lat: pts[0]![1]! }, { lng: pts.at(-1)![0]!, lat: pts.at(-1)![1]! }];
}

/** 교통노드 하나 → 이름 있는 지점. 최소노드배치점·빈 이름·좌표 없음은 null. */
export function toNamedNode(f: VworldFeature): { name: string; at: Coordinate } | null {
  const name = String(f.properties?.node_name ?? "").trim();
  if (!name || name.includes(UNNAMED_NODE)) return null;
  const g = f.geometry;
  const c = (g?.type === "Point" ? g.coordinates : g?.type === "MultiPoint" ? (g.coordinates as unknown[])[0] : null) as number[] | null;
  if (!Array.isArray(c) || !Number.isFinite(c[0]) || !Number.isFinite(c[1])) return null;
  return { name, at: { lng: c[0]!, lat: c[1]! } };
}

/** 격자(약 300m) 색인으로 가장 가까운 이름 있는 지점을 찾는다. */
export function createNodeNamer(nodes: { name: string; at: Coordinate }[], maxMeters = NODE_NAME_METERS): (p: Coordinate) => string {
  const cell = 0.003;
  const key = (x: number, y: number) => `${x},${y}`;
  const grid = new Map<string, { name: string; at: Coordinate }[]>();
  for (const n of nodes) {
    const k = key(Math.floor(n.at.lng / cell), Math.floor(n.at.lat / cell));
    const arr = grid.get(k);
    if (arr) arr.push(n);
    else grid.set(k, [n]);
  }
  return (p) => {
    const cx = Math.floor(p.lng / cell);
    const cy = Math.floor(p.lat / cell);
    let best = "";
    let bestD = maxMeters;
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        for (const n of grid.get(key(cx + dx, cy + dy)) ?? []) {
          const d = Math.hypot((n.at.lng - p.lng) * 93_000, (n.at.lat - p.lat) * 111_000);
          if (d <= bestD) [best, bestD] = [n.name, d];
        }
      }
    }
    return best;
  };
}

export function createVworldLinkProvider(apiKey: string, domain: string, fetchImpl: typeof fetch = fetch): LinkProvider {
  const page = async (n: number, data = "LT_L_MOCTLINK"): Promise<VworldPage> => {
    const q = new URLSearchParams({
      service: "data",
      version: "2.0",
      request: "GetFeature",
      format: "json",
      errorformat: "json",
      size: String(PAGE_SIZE),
      page: String(n),
      data,
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
  /** 한 데이터의 모든 쪽. 첫 쪽에서 전체 쪽 수를 알고 남은 쪽을 예약한다. */
  const allPages = async (data: string, reserve: (calls: number) => Promise<void>): Promise<VworldFeature[]> => {
    const first = await page(1, data);
    const rest = Array.from({ length: Math.max(0, first.totalPages - 1) }, (_, i) => i + 2);
    if (rest.length) await reserve(rest.length);
    const pages = [first];
    for (let i = 0; i < rest.length; i += CONCURRENCY) {
      pages.push(...(await Promise.all(rest.slice(i, i + CONCURRENCY).map((n) => page(n, data)))));
    }
    return pages.flatMap((p) => p.features);
  };
  return {
    id: "vworld",
    source: "vworld",
    async fetchLinks(ids, reserve) {
      // 교통노드(지점 이름)는 링크와 함께 받는다. 받지 못해도 구간 모양은 보여 준다(TASK-015).
      const nodesP = (async () => {
        await reserve(1);
        return allPages("LT_P_MOCTNODE", reserve);
      })().then(
        (fs) => fs.map(toNamedNode).filter((n) => n !== null),
        () => null,
      );
      const features = await allPages("LT_L_MOCTLINK", reserve);
      const nodes = await nodesP;
      const name = nodes ? createNodeNamer(nodes) : () => "";
      const links: LinkShape[] = [];
      for (const f of features) {
        if (!ids.has(String(f.properties?.link_id ?? ""))) continue;
        const shape = toLinkShape(f);
        const ends = endpoints(f);
        if (shape && ends) links.push([shape[0], shape[1], shape[2], name(ends[0]), name(ends[1])]);
      }
      return { links, named: nodes !== null };
    },
  };
}

/** 모의 교통링크: 공항 → 서귀포시청 직선(모의 추천 경로)을 넷으로 나눈 구간과 같은 ID. 실제 도로가 아니다. */
export function createMockLinkProvider(): LinkProvider & { calls: number } {
  const a = { lat: 33.5066, lng: 126.4929 };
  const b = { lat: 33.2541, lng: 126.5601 };
  const at = (t: number) => ({ lat: a.lat + (b.lat - a.lat) * t, lng: a.lng + (b.lng - a.lng) * t });
  const names = ["모의 공항로", "모의 평화로", "모의 평화로", "모의 중앙로"];
  const points = ["모의 공항", "모의 노형", "모의 어승생", "모의 서귀포", "모의 서귀포시청"];
  return {
    id: "vworld",
    source: "mock",
    calls: 0,
    async fetchLinks(ids) {
      this.calls += 1;
      const links = MOCK_LINK_IDS.map((id, i): LinkShape => [id, names[i]!, encodePolyline([at(i / 4), at((i + 1) / 4)]), points[i]!, points[i + 1]!]);
      return { links: links.filter(([id]) => ids.has(id)), named: true };
    },
  };
}
