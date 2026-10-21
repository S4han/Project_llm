import { defaultTrafficEvDeps, handleTrafficEv } from "../_lib/trafficEv.js";

// Vercel Function: GET /api/traffic/ev. 제주 전기차 충전소·충전 가능 수(제주 ITS, TASK-019). 기본정보 하루·충전 가능 30분 보관. 키가 없으면 모의.
export function GET(request: Request): Promise<Response> {
  return handleTrafficEv(request, defaultTrafficEvDeps);
}
