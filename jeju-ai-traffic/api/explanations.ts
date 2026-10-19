import { defaultExplanationDeps, handleExplanation } from "./_lib/explanations/handler.js";

// Vercel Function: POST /api/explanations. AI 미설정이면 규칙 기반 설명만 돌려준다(외부 호출 없음).
export function POST(request: Request): Promise<Response> {
  return handleExplanation(request, defaultExplanationDeps);
}
