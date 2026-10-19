import type { IncidentKind, TrafficIncident } from "../../../shared/contracts/traffic.js";
import { isInJeju } from "../../../shared/rules/geo.js";
import { ProviderError } from "../errors.js";
import type { TrafficProvider } from "./types.js";

/** 제주 ITS 오픈API(국외 IP 차단 → icn1 함수에서만 호출). 안내 페이지 기준 http 주소. */
const BASE = "http://api.jejuits.go.kr/api";
const TIMEOUT_MS = 8000;

export const ITS_ENDPOINTS: Record<Exclude<IncidentKind, "weather">, string> = {
  event: "infoRoadEventList",
  closure: "infoRoadCloseList",
  roadwork: "infoRoadWorkList",
};

/** 한 번 조회에 쓰는 호출 수(돌발·통제·공사). */
export const ITS_CALLS_PER_LOAD = Object.keys(ITS_ENDPOINTS).length;

const KIND_LABEL: Record<IncidentKind, string> = {
  event: "돌발 상황",
  closure: "도로 통제",
  roadwork: "도로 공사",
  weather: "교통기상",
};

/** 돌발 유형 코드(제주 ITS 오픈API 안내 페이지 기준, TASK-001). 그 밖의 코드는 "기타(코드 N)"(화면에서 "돌발 기타(코드 N)"). */
const EVENT_CODES: Record<number, string> = {
  534: "정지차량",
  258: "지정체구간",
};

/**
 * 항목 필드(TASK-006 실호출 확인, 2026-10-19):
 * - 돌발: ocrr_id, latitude, longitude, heading, link_id, code
 * - 공사: ocrr_id, latitude, longitude, heading, link_id, whole_lane, block_lane, text
 * - 통제: 확인 시점 0건이라 필드 미확인(공사와 같은 형식으로 가정)
 * 세 API 모두 시각 필드가 없어 sourceTime은 null이고, 화면에는 조회 시각을 표시한다.
 */
function describe(item: Record<string, unknown>, kind: IncidentKind): string {
  const text = typeof item.text === "string" ? item.text.trim() : "";
  if (text) return text;
  if (kind === "event" && typeof item.code === "number") {
    return EVENT_CODES[item.code] ?? `기타(코드 ${item.code})`;
  }
  return KIND_LABEL[kind];
}

/** 제주 ITS 응답 하나 → TrafficIncident[]. result가 success가 아니면 장애. 무효·범위 밖 좌표는 버린다. */
export function normalizeItsResponse(body: unknown, kind: IncidentKind, observedAt: string): TrafficIncident[] {
  const b = body as { result?: unknown; info?: unknown; Info?: unknown } | null;
  if (!b || b.result !== "success") throw new ProviderError("unavailable", `jejuIts: result ${String(b?.result)}`);
  const items = Array.isArray(b.info) ? b.info : Array.isArray(b.Info) ? b.Info : [];
  const incidents: TrafficIncident[] = [];
  items.forEach((raw, index) => {
    const item = raw as Record<string, unknown>;
    const location = { lat: Number(item.latitude ?? item.lat), lng: Number(item.longitude ?? item.lng) };
    if (!isInJeju(location)) return;
    const id = typeof item.ocrr_id === "string" && item.ocrr_id ? item.ocrr_id : `${String(item.link_id ?? "x")}-${index}`;
    incidents.push({
      id: `${kind}-${id}`,
      kind,
      description: describe(item, kind),
      location,
      observedAt,
      sourceTime: null,
      source: "jejuIts",
    });
  });
  return incidents;
}

/** 제주 ITS 어댑터: 돌발·통제·공사를 각각 호출한다. 일부만 실패하면 성공분을 돌려주고, 모두 실패하면 장애. */
export function createJejuItsProvider(
  apiKey: string,
  fetchImpl: typeof fetch = fetch,
  now: () => Date = () => new Date(),
): TrafficProvider {
  return {
    id: "jejuIts",
    async fetchIncidents(): Promise<TrafficIncident[]> {
      const observedAt = now().toISOString();
      const results = await Promise.allSettled(
        Object.entries(ITS_ENDPOINTS).map(async ([kind, name]) => {
          const res = await fetchImpl(`${BASE}/${name}?code=${encodeURIComponent(apiKey)}`, {
            signal: AbortSignal.timeout(TIMEOUT_MS),
          });
          if (res.status === 429) throw new ProviderError("rate_limited", "jejuIts 429");
          if (!res.ok) throw new ProviderError("unavailable", `jejuIts ${res.status}`);
          return normalizeItsResponse(await res.json(), kind as IncidentKind, observedAt);
        }),
      );
      const ok = results.filter((r): r is PromiseFulfilledResult<TrafficIncident[]> => r.status === "fulfilled");
      if (ok.length === 0) {
        const limited = results.some((r) => r.status === "rejected" && r.reason instanceof ProviderError && r.reason.kind === "rate_limited");
        throw new ProviderError(limited ? "rate_limited" : "unavailable", "jejuIts 전체 실패");
      }
      return ok.flatMap((r) => r.value);
    },
  };
}
