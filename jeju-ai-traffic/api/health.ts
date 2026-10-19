import { buildHealth } from "./_lib/health.js";

// Vercel Function: GET /api/health. 실행 리전은 vercel.json의 regions(icn1)로 고정한다.
export function GET(): Response {
  return Response.json(buildHealth(process.env.VERCEL_REGION, new Date()), {
    headers: { "Cache-Control": "no-store" },
  });
}
