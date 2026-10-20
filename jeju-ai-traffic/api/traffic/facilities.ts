import { defaultTrafficFacilitiesDeps, handleTrafficFacilities } from "../_lib/trafficFacilities.js";

// Vercel Function: GET /api/traffic/facilities. 제주 ITS 교통시설물 7개 유형(TASK-013). 서버 하루·CDN 7일 보관. 기본은 모의.
export function GET(request: Request): Promise<Response> {
  return handleTrafficFacilities(request, defaultTrafficFacilitiesDeps);
}
