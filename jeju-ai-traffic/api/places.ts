import { defaultPlacesDeps, handlePlaces } from "./_lib/places.js";

// Vercel Function: GET /api/places?q=검색어. 기본은 모의 공급자(외부 호출 없음).
export function GET(request: Request): Promise<Response> {
  return handlePlaces(request, defaultPlacesDeps);
}
