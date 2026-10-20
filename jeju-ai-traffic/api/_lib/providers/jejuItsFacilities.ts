import type { FacilityType } from "../../../shared/contracts/traffic.js";
import { isInJeju } from "../../../shared/rules/geo.js";
import { ProviderError } from "../errors.js";

/** 시설물 유형 7가지(TASK-013, 안내 페이지 기준). */
export const FACILITY_TYPES: FacilityType[] = ["FTY01", "FTY02", "FTY03", "FTY07", "FTY09", "FTY17", "FTY23"];

export type FacilityRow = [string, FacilityType, string, string, number, number];

export interface FacilitySnapshot {
  facilities: FacilityRow[];
  failedTypes: FacilityType[];
  source: "jejuIts" | "mock";
}

export interface FacilityProvider {
  readonly id: "jejuIts";
  fetchFacilities(): Promise<FacilitySnapshot>;
}

/** 제주 ITS 교통시설물정보. 파라미터는 fcltType(안내 페이지의 fdtType은 오기, TASK-013 시험 확인). */
const URL_BASE = "http://api.jejuits.go.kr/api/getFacilityInfo";
const TIMEOUT_MS = 15_000;

/**
 * 응답 하나 → 시설물. result가 success가 아니면 장애.
 * 좌표 이름이 반대다: x_crdn = 위도, y_crdn = 경도(시험 확인). 제주 밖·0 좌표는 버린다. 모델명 "-"는 없음("").
 */
export function normalizeFacilityResponse(body: unknown, type: FacilityType): FacilityRow[] {
  const b = body as { result?: unknown; info?: unknown; Info?: unknown } | null;
  if (!b || b.result !== "success") throw new ProviderError("unavailable", `jejuIts facilities ${type}: result ${String(b?.result)}`);
  const items = (Array.isArray(b.info) ? b.info : Array.isArray(b.Info) ? b.Info : []) as Record<string, unknown>[];
  const rows: FacilityRow[] = [];
  for (const item of items) {
    const id = String(item.fclt_id ?? "").trim();
    const location = { lat: Number(item.x_crdn), lng: Number(item.y_crdn) };
    if (!id || !isInJeju(location)) continue;
    const model = String(item.mdl_nm ?? "").trim();
    rows.push([id, type, String(item.fclt_lctn ?? "").trim(), model === "-" ? "" : model, location.lat, location.lng]);
  }
  return rows;
}

/** 7개 유형을 1건씩 부른다. 일부만 실패하면 받은 것과 실패한 유형을 함께 돌려주고, 모두 실패하면 장애. */
export function createJejuItsFacilityProvider(apiKey: string, fetchImpl: typeof fetch = fetch): FacilityProvider {
  return {
    id: "jejuIts",
    async fetchFacilities() {
      const settled = await Promise.allSettled(
        FACILITY_TYPES.map(async (type) => {
          const res = await fetchImpl(`${URL_BASE}?code=${encodeURIComponent(apiKey)}&fcltType=${type}`, { signal: AbortSignal.timeout(TIMEOUT_MS) });
          if (res.status === 429) throw new ProviderError("rate_limited", "jejuIts facilities 429");
          if (!res.ok) throw new ProviderError("unavailable", `jejuIts facilities ${res.status}`);
          return normalizeFacilityResponse(await res.json(), type);
        }),
      );
      const ok = settled.filter((r): r is PromiseFulfilledResult<FacilityRow[]> => r.status === "fulfilled");
      if (ok.length === 0) {
        const limited = settled.some((r) => r.status === "rejected" && r.reason instanceof ProviderError && r.reason.kind === "rate_limited");
        throw new ProviderError(limited ? "rate_limited" : "unavailable", "jejuIts facilities 전체 실패");
      }
      const seen = new Set<string>();
      const facilities = ok.flatMap((r) => r.value).filter(([id]) => !seen.has(id) && Boolean(seen.add(id)));
      const failedTypes = FACILITY_TYPES.filter((_, i) => settled[i]!.status === "rejected");
      return { facilities, failedTypes, source: "jejuIts" };
    },
  };
}

/** 개발용 모의 시설물(모의 추천 경로 부근). 실제 시설물이 아니다. */
export function createMockFacilityProvider(): FacilityProvider & { calls: number } {
  const rows: FacilityRow[] = [
    ["MOCK-VMS-1", "FTY01", "모의 공항입구", "", 33.5, 126.495],
    ["MOCK-VMS-2", "FTY01", "모의 노형오거리", "", 33.48, 126.48],
    ["MOCK-CCTV-1", "FTY02", "모의 신광사거리", "MOCK-1", 33.47, 126.502],
    ["MOCK-CCTV-2", "FTY02", "모의 평화로 입구", "MOCK-1", 33.44, 126.51],
    ["MOCK-CCTV-3", "FTY02", "모의 중문입구", "MOCK-2", 33.3, 126.55],
    ["MOCK-RWIS-1", "FTY23", "모의 1100고지", "", 33.36, 126.46],
  ];
  return {
    id: "jejuIts",
    calls: 0,
    async fetchFacilities() {
      this.calls += 1;
      return { facilities: rows, failedTypes: [], source: "mock" };
    },
  };
}
