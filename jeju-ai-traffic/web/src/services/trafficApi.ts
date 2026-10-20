import type { ApiError, ApiErrorBody } from "../../../shared/contracts/common";
import type { TrafficIncidentsResponse } from "../../../shared/contracts/traffic";

export type TrafficIncidentsResult = { ok: true; data: TrafficIncidentsResponse } | { ok: false; error: ApiError };

const NETWORK_ERROR: ApiError = {
  code: "PROVIDER_UNAVAILABLE",
  message: "네트워크 연결을 확인한 뒤 다시 시도하세요.",
};

/** GET /api/traffic/incidents(TASK-012). 네트워크 오류도 ApiError 형식으로 돌려준다. */
export async function fetchTrafficIncidents(signal?: AbortSignal): Promise<TrafficIncidentsResult> {
  let res: Response;
  try {
    res = await fetch("/api/traffic/incidents", { signal });
  } catch {
    return { ok: false, error: NETWORK_ERROR };
  }
  const body = (await res.json().catch(() => null)) as TrafficIncidentsResponse | ApiErrorBody | null;
  if (res.ok && body && "incidents" in body) return { ok: true, data: body };
  if (body && "error" in body) return { ok: false, error: body.error };
  return { ok: false, error: NETWORK_ERROR };
}
