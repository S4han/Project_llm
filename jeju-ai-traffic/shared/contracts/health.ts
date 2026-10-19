/** GET /api/health 응답 계약. 외부 공급자 상태는 포함하지 않는다(TASK-003 이후). */
export interface HealthResponse {
  status: "ok";
  service: "jeju-ai-traffic";
  /** Vercel 실행 리전(예: icn1). 로컬 실행 시 "local". */
  region: string;
  /** 응답 생성 시각(ISO 8601, UTC). */
  checkedAt: string;
}
