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

/**
 * 항목 필드 이름은 TASK-001에서 좌표(latitude·longitude)와 link_id만 확인됐다.
 * 설명·시각 필드는 아래 후보 중 처음 값이 있는 것을 쓴다(TASK-006 실호출로 확인 후 정리).
 */
const DESCRIPTION_KEYS = ["event_name", "eventName", "incident_name", "type_name", "title", "contents", "content", "descr", "message", "road_name"];
const TIME_KEYS = ["update_time", "updateTime", "reg_date", "regDate", "regdate", "occur_time", "start_time", "startTime", "created_at", "date"];
const ID_KEYS = ["id", "event_id", "eventId", "incident_id", "seq", "idx"];

function firstString(item: Record<string, unknown>, keys: string[]): string | null {
  for (const key of keys) {
    const v = item[key];
    if ((typeof v === "string" && v.trim()) || typeof v === "number") return String(v).trim();
  }
  return null;
}

/** "YYYY-MM-DD HH:MM(:SS)" 또는 "YYYYMMDDHHMM(SS)"를 KST로 보고 ISO로 바꾼다. 해석할 수 없으면 null. */
export function parseKstTime(raw: string | null): string | null {
  if (!raw) return null;
  const digits = raw.replace(/\D/g, "");
  if (digits.length < 12) return null;
  const [y, mo, d, h, mi, s] = [
    digits.slice(0, 4),
    digits.slice(4, 6),
    digits.slice(6, 8),
    digits.slice(8, 10),
    digits.slice(10, 12),
    digits.slice(12, 14) || "00",
  ];
  const ms = Date.parse(`${y}-${mo}-${d}T${h}:${mi}:${s}+09:00`);
  return Number.isNaN(ms) ? null : new Date(ms).toISOString();
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
    const id = firstString(item, ID_KEYS) ?? `${firstString(item, ["link_id"]) ?? "x"}-${index}`;
    incidents.push({
      id: `${kind}-${id}`,
      kind,
      description: firstString(item, DESCRIPTION_KEYS) ?? KIND_LABEL[kind],
      location,
      observedAt,
      sourceTime: parseKstTime(firstString(item, TIME_KEYS)),
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
