import { defaultTrafficSpeedsDeps, handleTrafficSpeeds } from "../_lib/trafficLayers.js";

// Vercel Function: GET /api/traffic/speeds. 제주 ITS 구간별 평균속도(TASK-012). 기본은 모의 공급자(외부 호출 없음).
export function GET(request: Request): Promise<Response> {
  return handleTrafficSpeeds(request, defaultTrafficSpeedsDeps);
}
