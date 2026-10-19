import type { ApiError, ApiErrorBody } from "../../../shared/contracts/common";
import type { PlaceSearchResponse } from "../../../shared/contracts/place";

export type PlaceSearchResult = { ok: true; data: PlaceSearchResponse } | { ok: false; error: ApiError };

const NETWORK_ERROR: ApiError = {
  code: "PROVIDER_UNAVAILABLE",
  message: "네트워크 연결을 확인한 뒤 다시 시도하세요.",
};

/** GET /api/places 호출. 네트워크 오류도 ApiError 형식으로 돌려준다. */
export async function searchPlaces(query: string, signal?: AbortSignal): Promise<PlaceSearchResult> {
  let res: Response;
  try {
    res = await fetch(`/api/places?q=${encodeURIComponent(query)}`, { signal });
  } catch {
    return { ok: false, error: NETWORK_ERROR };
  }
  const body = (await res.json().catch(() => null)) as PlaceSearchResponse | ApiErrorBody | null;
  if (res.ok && body && "places" in body) return { ok: true, data: body };
  if (body && "error" in body) return { ok: false, error: body.error };
  return { ok: false, error: NETWORK_ERROR };
}
