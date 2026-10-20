import { defaultTrafficEnforcementDeps, handleTrafficEnforcement } from "../_lib/trafficEnforcement.js";

// Vercel Function: GET /api/traffic/enforcement. 제주시 주정차 단속 CCTV(공공데이터포털, TASK-016). 서버 하루·CDN 7일 보관. 키가 없으면 모의.
export function GET(request: Request): Promise<Response> {
  return handleTrafficEnforcement(request, defaultTrafficEnforcementDeps);
}
