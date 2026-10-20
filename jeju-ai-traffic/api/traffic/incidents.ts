import { defaultTrafficIncidentsDeps, handleTrafficIncidents } from "../_lib/incidents.js";

// Vercel Function: GET /api/traffic/incidents. 제주 전체 돌발·통제·공사(TASK-012). 기본은 모의 공급자(외부 호출 없음).
export function GET(request: Request): Promise<Response> {
  return handleTrafficIncidents(request, defaultTrafficIncidentsDeps);
}
