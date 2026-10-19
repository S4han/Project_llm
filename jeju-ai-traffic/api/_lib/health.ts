import type { HealthResponse } from "../../shared/contracts/health.js";

/** 외부 호출 없이 서버 상태만 만든다. 환경 변수 중 리전 이름 외에는 읽지 않는다. */
export function buildHealth(region: string | undefined, now: Date): HealthResponse {
  return {
    status: "ok",
    service: "jeju-ai-traffic",
    region: region || "local",
    checkedAt: now.toISOString(),
  };
}
