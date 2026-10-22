// TASK-028 일회성 확인용(범위 변경: "범위 변경: TASK-028 (b) 시험 4건 승인 신청 완료", 시험 호출 4건 이내). 확인 후 삭제한다. main에 넣지 않는다.
// 제주관광공사 비짓제주 관광정보 오픈 API 숙박(category c3) 목록 1쪽을 부른다.
// 1차 시험(2건): 공공데이터포털 키는 "apiKey is invalid" → 비짓제주에서 따로 받은 키(VISITJEJU_API_KEY)로만, https가 안 되면 http로(남은 2건).
// 건수·항목 이름·표본(앞 2곳)·사진/전화/좌표가 있는 수만 돌려준다. 인스턴스당 1번만 연다. 키 값은 응답에 넣지 않는다.
// 사용: 미리보기 주소 + /api/visitjeju-probe 를 한 번만 연다.
let opened = false;
const PATH = "api.visitjeju.net/vsjApi/contents/searchlist";

function clip(v: unknown, n = 200): unknown {
  if (typeof v === "string") return v.length > n ? `${v.slice(0, n)}…` : v;
  if (v && typeof v === "object") return Object.fromEntries(Object.entries(v as Record<string, unknown>).map(([k, x]) => [k, clip(x, n)]));
  return v;
}

export async function GET(): Promise<Response> {
  const headers = { "Cache-Control": "no-store", "Content-Type": "application/json; charset=utf-8" };
  if (opened) return Response.json({ stopped: "이 서버에서는 이미 한 번 열었습니다" }, { headers });
  opened = true;
  const keys = (["VISITJEJU_API_KEY"] as const).map((name) => ({ name, key: (process.env[name] ?? "").trim() })).filter((k) => k.key);
  if (!keys.length) return Response.json({ keyPresent: false }, { headers });
  const redact = (s: string) => keys.reduce((acc, k) => acc.split(k.key).join("[KEY]").split(encodeURIComponent(k.key)).join("[KEY]"), s);
  const attempts: Record<string, unknown>[] = [];
  let summary: Record<string, unknown> = {};
  outer: for (const k of keys) {
    for (const scheme of ["https", "http"]) {
      if (attempts.length >= 2) break outer;
      const out: Record<string, unknown> = { key: k.name, scheme };
      attempts.push(out);
      try {
        const res = await fetch(`${scheme}://${PATH}?apiKey=${encodeURIComponent(k.key)}&locale=kr&category=c3&page=1`, { signal: AbortSignal.timeout(20_000) });
        out.status = res.status;
        out.contentType = res.headers.get("content-type");
        const text = await res.text();
        out.length = text.length;
        let body: Record<string, unknown>;
        try {
          body = JSON.parse(text) as Record<string, unknown>;
        } catch {
          out.notJson = text.slice(0, 300).replace(/\s+/g, " ");
          continue;
        }
        out.topKeys = Object.keys(body);
        for (const f of ["result", "resultMessage", "totalCount", "resultCount", "pageSize", "pageCount", "currentPage"]) out[f] = body[f];
        const items = (Array.isArray(body.items) ? body.items : []) as Record<string, unknown>[];
        out.itemCount = items.length;
        if (!items.length) continue;
        out.itemKeys = [...new Set(items.flatMap((i) => Object.keys(i)))];
        out.samples = items.slice(0, 2).map((i) => clip(i));
        const has = (f: (i: Record<string, unknown>) => unknown) => items.filter((i) => String(f(i) ?? "").trim()).length;
        summary = {
          totalCount: body.totalCount,
          pageItems: items.length,
          withLatLng: items.filter((i) => Number(i.latitude) > 33 && Number(i.latitude) < 34 && Number(i.longitude) > 126 && Number(i.longitude) < 127).length,
          withPhone: has((i) => i.phoneno),
          withPhoto: has((i) => (i.repPhoto as { photoid?: { imgpath?: unknown } } | undefined)?.photoid?.imgpath),
          withTag: has((i) => i.tag),
          labels: [...new Set(items.map((i) => JSON.stringify((i.contentscd as { label?: unknown } | undefined)?.label ?? "")))].slice(0, 10),
        };
        break outer;
      } catch (e) {
        out.error = String(e);
      }
    }
  }
  return new Response(redact(JSON.stringify({ region: process.env.VERCEL_REGION ?? null, checkedAt: new Date().toISOString(), calls: attempts.length, summary, attempts }, null, 1)), { headers });
}
