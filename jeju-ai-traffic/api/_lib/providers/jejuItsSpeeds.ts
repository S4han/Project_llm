import { ProviderError } from "../errors.js";

/** 구간 속도 한 번 조회 결과. speeds[link_id] = [평균속도 km/h, 통행시간 초]. */
export interface SpeedSnapshot {
  /** 원천 가공 시각(prcn_dt 중 가장 늦은 값, ISO). 없으면 null. */
  observedAt: string | null;
  speeds: Record<string, [number, number]>;
  source: "jejuIts" | "mock";
}

export interface SpeedProvider {
  readonly id: "jejuIts";
  fetchSpeeds(): Promise<SpeedSnapshot>;
}

/** 제주 ITS 실시간 교통정보(TASK-012 시험 확인: 약 12,000개 구간, 약 1.2MB, 5분 단위 갱신 추정). 국외 IP 차단 → icn1에서만. */
const URL_BASE = "http://api.jejuits.go.kr/api/getFrafficInfo";
const TIMEOUT_MS = 15_000;

/** "20261020095000"(KST) → ISO. 형식이 다르면 null. */
export function prcnToIso(text: string): string | null {
  const m = /^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})$/.exec(text);
  if (!m) return null;
  const d = new Date(`${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}+09:00`);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

/** 응답 → 구간 속도. result가 success가 아니면 장애. 구간 ID가 10자리가 아니거나 속도가 0 이하·200 초과면 버린다. */
export function normalizeSpeedResponse(body: unknown): SpeedSnapshot {
  const b = body as { result?: unknown; info?: unknown; Info?: unknown } | null;
  if (!b || b.result !== "success") throw new ProviderError("unavailable", `jejuIts speeds: result ${String(b?.result)}`);
  const items = (Array.isArray(b.info) ? b.info : Array.isArray(b.Info) ? b.Info : []) as Record<string, unknown>[];
  const speeds: Record<string, [number, number]> = {};
  let latest = "";
  for (const item of items) {
    const id = String(item.link_id ?? "");
    const sped = Number(item.sped);
    const trvl = Number(item.trvl_hh);
    if (!/^\d{10}$/.test(id) || !(sped > 0 && sped <= 200)) continue;
    speeds[id] = [Math.round(sped), Number.isFinite(trvl) && trvl >= 0 ? Math.round(trvl) : 0];
    const t = String(item.prcn_dt ?? "");
    if (t > latest) latest = t;
  }
  return { observedAt: prcnToIso(latest), speeds, source: "jejuIts" };
}

export function createJejuItsSpeedProvider(apiKey: string, fetchImpl: typeof fetch = fetch): SpeedProvider {
  return {
    id: "jejuIts",
    async fetchSpeeds() {
      const res = await fetchImpl(`${URL_BASE}?code=${encodeURIComponent(apiKey)}&type=L`, { signal: AbortSignal.timeout(TIMEOUT_MS) });
      if (res.status === 429) throw new ProviderError("rate_limited", "jejuIts speeds 429");
      if (!res.ok) throw new ProviderError("unavailable", `jejuIts speeds ${res.status}`);
      return normalizeSpeedResponse(await res.json());
    },
  };
}

/** 모의 구간 ID(모의 교통링크와 같은 ID). 실제 교통이 아니다. */
export const MOCK_LINK_IDS = ["4050000001", "4050000002", "4050000003", "4060000001"];

/** 개발용 모의 구간 속도(원활·서행·정체·원활). 외부 호출 없음. */
export function createMockSpeedProvider(now: () => Date = () => new Date()): SpeedProvider & { calls: number } {
  return {
    id: "jejuIts",
    calls: 0,
    async fetchSpeeds() {
      this.calls += 1;
      const at = new Date(Math.floor(now().getTime() / 300_000) * 300_000).toISOString();
      const values: [number, number][] = [
        [52, 40],
        [22, 95],
        [9, 240],
        [41, 60],
      ];
      return { observedAt: at, speeds: Object.fromEntries(MOCK_LINK_IDS.map((id, i) => [id, values[i]!])), source: "mock" };
    },
  };
}
