import { defaultRoutesDeps, handleRouteCompare } from "../_lib/routes.js";

// Vercel Function: POST /api/routes/compare { origin, destination }. 기본은 모의 공급자(외부 호출 없음).
export function POST(request: Request): Promise<Response> {
  return handleRouteCompare(request, defaultRoutesDeps);
}
