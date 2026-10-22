// TASK-028 일회성 확인용(범위 변경 (b), 1차 4건 사용. 이 함수의 추가 2건은 사용자 승인 뒤에만 연다). 확인 후 삭제한다. main에 넣지 않는다.
// 비짓제주 OPEN API 활용가이드 V1.1(사용자 구글 드라이브 Visit_jeju_api.pdf): GET http://api.visitjeju.net/vsjApi/contents/searchList
// ?apiKey=&locale=kr&page=(&cid=). 분류(category) 요청 항목은 문서에 없다 → 1) category=c3를 붙여 걸러지는지, 2) 붙이지 않은 1쪽(전체)의 분류 분포.
// 건수·쪽 수·분류 분포·숙박(c3) 표본·항목 이름만 돌려준다. 인스턴스당 1번만 연다. 키 값은 응답에 넣지 않는다.
// 사용: 미리보기 주소 + /api/visitjeju-probe 를 한 번만 연다.
let opened = false;
const BASE = "http://api.visitjeju.net/vsjApi/contents/searchList";

function clip(v: unknown, n = 200): unknown {
  if (typeof v === "string") return v.length > n ? `${v.slice(0, n)}…` : v;
  if (v && typeof v === "object") return Object.fromEntries(Object.entries(v as Record<string, unknown>).map(([k, x]) => [k, clip(x, n)]));
  return v;
}

async function call(key: string, extra: string) {
  const out: Record<string, unknown> = { params: `locale=kr&page=1${extra}` };
  try {
    const res = await fetch(`${BASE}?apiKey=${encodeURIComponent(key)}&locale=kr&page=1${extra}`, { signal: AbortSignal.timeout(20_000) });
    out.status = res.status;
    const text = await res.text();
    out.length = text.length;
    const body = JSON.parse(text) as Record<string, unknown>;
    for (const f of ["result", "resultMessage", "totalCount", "resultCount", "pageSize", "pageCount", "currentPage"]) out[f] = body[f];
    const items = (Array.isArray(body.items) ? body.items : []) as Record<string, unknown>[];
    const code = (i: Record<string, unknown>) => `${(i.contentscd as { value?: unknown } | undefined)?.value ?? ""}:${(i.contentscd as { label?: unknown } | undefined)?.label ?? ""}`;
    out.codes = items.reduce<Record<string, number>>((m, i) => ((m[code(i)] = (m[code(i)] ?? 0) + 1), m), {});
    out.itemKeys = [...new Set(items.flatMap((i) => Object.keys(i)))];
    const stays = items.filter((i) => code(i).startsWith("c3"));
    out.stayCount = stays.length;
    out.staySamples = stays.slice(0, 2).map((i) => clip(i));
    out.withParkingTag = stays.filter((i) => /주차/.test(String(i.alltag ?? ""))).length;
    out.withPhone = stays.filter((i) => String(i.phoneno ?? "").trim()).length;
    out.withPhoto = stays.filter((i) => (i.repPhoto as { photoid?: { imgpath?: unknown } } | undefined)?.photoid?.imgpath).length;
  } catch (e) {
    out.error = String(e);
  }
  return out;
}

export async function GET(): Promise<Response> {
  const headers = { "Cache-Control": "no-store", "Content-Type": "application/json; charset=utf-8" };
  if (opened) return Response.json({ stopped: "이 서버에서는 이미 한 번 열었습니다" }, { headers });
  opened = true;
  const key = (process.env.VISITJEJU_API_KEY ?? "").trim();
  if (!key) return Response.json({ keyPresent: false }, { headers });
  const redact = (s: string) => s.split(key).join("[KEY]").split(encodeURIComponent(key)).join("[KEY]");
  const attempts = [await call(key, "&category=c3"), await call(key, "")];
  return new Response(redact(JSON.stringify({ region: process.env.VERCEL_REGION ?? null, checkedAt: new Date().toISOString(), calls: attempts.length, attempts }, null, 1)), { headers });
}
