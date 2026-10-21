import { defaultTrafficParkingDeps, handleTrafficParking } from "../_lib/trafficParking.js";

// Vercel Function: GET /api/traffic/parking. 제주시·서귀포시 주차장(전국주차장정보표준데이터, TASK-017). 서버 하루·CDN 7일 보관. 키가 없으면 모의.
export function GET(request: Request): Promise<Response> {
  return handleTrafficParking(request, defaultTrafficParkingDeps);
}
