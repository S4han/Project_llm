// TASK-029 범위 변경 일회성 확인용(시험 호출 최대 2건). 확인 후 삭제한다. main에 넣지 않는다.
// 한국관광공사 소개정보(detailIntro2) 음식점(39): 1) 카페 "가는곶 세화"(2850913) 2) 음식점 "가람돌솥밥"(2755053).
// 항목 이름과 값(앞부분)만 돌려준다. 인스턴스당 1번만 연다. 키 값은 응답에 넣지 않는다.
// 사용: 미리보기 주소 + /api/search-probe 를 한 번만 연다.
import { serviceKeyParam } from "./_lib/providers/jejuCityEnforcement.js";

let opened = false;

async function intro(key: string, id: string) {
  const out: Record<string, unknown> = { id };
  try {
    const res = await fetch(`https://apis.data.go.kr/B551011/KorService2/detailIntro2?serviceKey=${serviceKeyParam(key)}&MobileOS=ETC&MobileApp=JejuTraffic&_type=json&contentId=${id}&contentTypeId=39`, { signal: AbortSignal.timeout(20_000) });
    out.status = res.status;
    const b = (await res.json()) as { response?: { header?: unknown; body?: { items?: { item?: unknown } } } };
    out.header = b.response?.header;
    const raw = b.response?.body?.items?.item;
    const item = (Array.isArray(raw) ? raw[0] : raw) as Record<string, unknown> | undefined;
    out.fields = item ? Object.fromEntries(Object.entries(item).map(([k, v]) => [k, String(v ?? "").slice(0, 80)])) : null;
  } catch (e) {
    out.error = String(e);
  }
  return out;
}

export async function GET(): Promise<Response> {
  const headers = { "Cache-Control": "no-store", "Content-Type": "application/json; charset=utf-8" };
  if (opened) return Response.json({ stopped: "이 서버에서는 이미 한 번 열었습니다" }, { headers });
  opened = true;
  const key = (process.env.DATA_GO_KR_API_KEY ?? "").trim();
  if (!key) return Response.json({ keyPresent: false }, { headers });
  const keys = [key, serviceKeyParam(key), encodeURIComponent(key)].filter((k) => k.length >= 8);
  const redact = (s: string) => keys.reduce((acc, k) => acc.split(k).join("[KEY]"), s);
  const attempts = [await intro(key, "2850913"), await intro(key, "2755053")];
  return new Response(redact(JSON.stringify({ checkedAt: new Date().toISOString(), calls: attempts.length, attempts }, null, 1)), { headers });
}
