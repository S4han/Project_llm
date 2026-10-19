import type { Coordinate, RouteCompareRequest } from "../../../shared/contracts/route.js";
import type { RouteQuery, RouteResult } from "../../../shared/rules/route.js";
import { ProviderError } from "../errors.js";
import type { RouteProvider } from "./types.js";

const BASE = "https://apis-navi.kakaomobility.com/v1";
const TIMEOUT_MS = 8000;

interface KakaoRoad {
  vertexes?: unknown;
}
interface KakaoRoute {
  result_code?: unknown;
  summary?: { distance?: unknown; duration?: unknown };
  sections?: { roads?: KakaoRoad[] }[];
}

function xy(c: Coordinate): string {
  return `${c.lng},${c.lat}`;
}

/** vertexes [x1, y1, x2, y2, ...] → 좌표 목록. */
function toGeometry(route: KakaoRoute): Coordinate[] {
  const points: Coordinate[] = [];
  for (const section of route.sections ?? []) {
    for (const road of section.roads ?? []) {
      const v = Array.isArray(road.vertexes) ? road.vertexes : [];
      for (let i = 0; i + 1 < v.length; i += 2) {
        const lng = Number(v[i]);
        const lat = Number(v[i + 1]);
        if (Number.isFinite(lat) && Number.isFinite(lng)) points.push({ lat, lng });
      }
    }
  }
  return points;
}

/**
 * 카카오모빌리티 길찾기 응답 → RouteResult. result_code가 0이 아니면 경로 없음(102 출발지, 103 도착지 주변 도로 없음).
 * 형식이 맞지 않으면 공급자 장애로 본다. 교통 상태는 TASK-006에서 연결하므로 unknown.
 */
export function normalizeKakaoDirections(body: unknown, query: RouteQuery, observedAt: string): RouteResult {
  const routes = (body as { routes?: unknown } | null)?.routes;
  if (!Array.isArray(routes) || routes.length === 0) throw new ProviderError("unavailable", "kakao: routes 없음");
  const route = routes[0] as KakaoRoute;
  if (typeof route.result_code !== "number") throw new ProviderError("unavailable", "kakao: result_code 없음");
  if (route.result_code === 102) return { ok: false, reason: "originUnreachable" };
  if (route.result_code === 103) return { ok: false, reason: "destinationUnreachable" };
  if (route.result_code !== 0) return { ok: false, reason: "notFound" };
  const distance = Number(route.summary?.distance);
  const duration = Number(route.summary?.duration);
  if (!Number.isFinite(distance) || !Number.isFinite(duration) || duration <= 0) {
    throw new ProviderError("unavailable", "kakao: summary 형식 오류");
  }
  return {
    ok: true,
    route: {
      id: query.kind,
      provider: "kakao",
      label: query.label,
      durationSeconds: duration,
      distanceMeters: distance,
      geometry: toGeometry(route),
      observedAt,
      trafficStatus: "unknown",
    },
  };
}

/** 카카오모빌리티 자동차 길찾기·경유지 길찾기 어댑터. 키는 서버 환경 변수로만 받고 출력하지 않는다. */
export function createKakaoMobilityProvider(
  apiKey: string,
  fetchImpl: typeof fetch = fetch,
  now: () => Date = () => new Date(),
): RouteProvider {
  const headers = { Authorization: `KakaoAK ${apiKey}` };
  return {
    id: "kakao",
    async fetchRoute(request: RouteCompareRequest, query: RouteQuery): Promise<RouteResult> {
      const priority = query.kind === "distance" ? "DISTANCE" : "RECOMMEND";
      let res: Response;
      if (query.via) {
        res = await fetchImpl(`${BASE}/waypoints/directions`, {
          method: "POST",
          headers: { ...headers, "Content-Type": "application/json" },
          body: JSON.stringify({
            origin: { x: request.origin.lng, y: request.origin.lat },
            destination: { x: request.destination.lng, y: request.destination.lat },
            waypoints: [{ x: query.via.lng, y: query.via.lat }],
            priority,
          }),
          signal: AbortSignal.timeout(TIMEOUT_MS),
        });
      } else {
        const url = new URL(`${BASE}/directions`);
        url.searchParams.set("origin", xy(request.origin));
        url.searchParams.set("destination", xy(request.destination));
        url.searchParams.set("priority", priority);
        res = await fetchImpl(url, { headers, signal: AbortSignal.timeout(TIMEOUT_MS) });
      }
      if (res.status === 429) throw new ProviderError("rate_limited", "kakao 429");
      if (!res.ok) throw new ProviderError("unavailable", `kakao ${res.status}`);
      return normalizeKakaoDirections(await res.json(), query, now().toISOString());
    },
  };
}
