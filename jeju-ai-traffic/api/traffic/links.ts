import { defaultTrafficLinksDeps, handleTrafficLinks } from "../_lib/trafficLayers.js";

// Vercel Function: GET /api/traffic/links. 브이월드 교통링크 모양(제주 ITS 속도가 있는 구간, TASK-012). CDN 30일 보관. 기본은 모의.
export function GET(request: Request): Promise<Response> {
  return handleTrafficLinks(request, defaultTrafficLinksDeps);
}
