import type { ApiError, ApiErrorBody } from "../../../shared/contracts/common";
import type { RouteCompareRequest, RouteCompareResponse } from "../../../shared/contracts/route";

export type RouteCompareResult = { ok: true; data: RouteCompareResponse } | { ok: false; error: ApiError };

const NETWORK_ERROR: ApiError = {
  code: "PROVIDER_UNAVAILABLE",
  message: "네트워크 연결을 확인한 뒤 다시 시도하세요.",
};

/** POST /api/routes/compare. 네트워크 오류도 ApiError 형식으로 돌려준다. */
export async function compareRoutes(request: RouteCompareRequest, signal?: AbortSignal): Promise<RouteCompareResult> {
  let res: Response;
  try {
    res = await fetch("/api/routes/compare", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(request),
      signal,
    });
  } catch {
    return { ok: false, error: NETWORK_ERROR };
  }
  const body = (await res.json().catch(() => null)) as RouteCompareResponse | ApiErrorBody | null;
  if (res.ok && body && "routes" in body) return { ok: true, data: body };
  if (body && "error" in body) return { ok: false, error: body.error };
  return { ok: false, error: NETWORK_ERROR };
}
