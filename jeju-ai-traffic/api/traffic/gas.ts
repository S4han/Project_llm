import { defaultTrafficGasDeps, handleTrafficGas } from "../_lib/trafficGas.js";

// Vercel Function: GET /api/traffic/gas. 제주 주유소·휘발유·경유 가격(오피넷, TASK-018). 서버·CDN 6시간 보관. 키가 없으면 모의.
export function GET(request: Request): Promise<Response> {
  return handleTrafficGas(request, defaultTrafficGasDeps);
}
