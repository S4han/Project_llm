// TASK-029 일회성 확인용(계획 승인 "5. 승인", 최대 4건). 확인 후 삭제한다. main에 넣지 않는다.
// 1) 비짓제주 관광지(c1) 1쪽 2) 비짓제주 음식점(c4) 1쪽 3) 한국관광공사 제주 음식점(39) 1건 4) 카카오 로컬 카페(CE7) 1건.
// 건수·쪽 수·항목 이름·표본 2개만 돌려준다. 인스턴스당 1번만 연다. 키 값은 응답에 넣지 않는다.
// 사용: 미리보기 주소 + /api/search-probe 를 한 번만 연다.
import { serviceKeyParam } from "./_lib/providers/jejuCityEnforcement.js";

let opened = false;

function clip(v: unknown, n = 160): unknown {
  if (typeof v === "string") return v.length > n ? `${v.slice(0, n)}…` : v;
  if (Array.isArray(v)) return v.slice(0, 3).map((x) => clip(x, n));
  if (v && typeof v === "object") return Object.fromEntries(Object.entries(v as Record<string, unknown>).map(([k, x]) => [k, clip(x, n)]));
  return v;
}

async function attempt(name: string, url: string, init: RequestInit, pick: (body: Record<string, unknown>) => Record<string, unknown>) {
  const out: Record<string, unknown> = { name };
  try {
    const res = await fetch(url, { ...init, signal: AbortSignal.timeout(20_000) });
    out.status = res.status;
    const text = await res.text();
    out.length = text.length;
    Object.assign(out, pick(JSON.parse(text) as Record<string, unknown>));
  } catch (e) {
    out.error = String(e);
    const cause = (e as { cause?: { code?: unknown; message?: unknown } }).cause;
    if (cause) out.cause = { code: cause.code, message: cause.message };
  }
  return out;
}

function visitJeju(key: string, cat: string) {
  return attempt(`visitJeju ${cat}`, `https://api.visitjeju.net/vsjApi/contents/searchList?apiKey=${encodeURIComponent(key)}&locale=kr&category=${cat}&page=1`, {}, (b) => {
    const items = (Array.isArray(b.items) ? b.items : []) as Record<string, unknown>[];
    const code = (i: Record<string, unknown>) => String((i.contentscd as { value?: unknown } | undefined)?.value ?? "");
    return {
      result: b.result,
      totalCount: b.totalCount,
      pageCount: b.pageCount,
      codes: items.reduce<Record<string, number>>((m, i) => ((m[code(i)] = (m[code(i)] ?? 0) + 1), m), {}),
      itemKeys: [...new Set(items.flatMap((i) => Object.keys(i)))],
      withPhone: items.filter((i) => String(i.phoneno ?? "").trim()).length,
      withPhoto: items.filter((i) => (i.repPhoto as { photoid?: { imgpath?: unknown } } | undefined)?.photoid?.imgpath).length,
      tagSamples: items.slice(0, 8).map((i) => String(i.alltag ?? "").slice(0, 80)),
      samples: items.slice(0, 2).map((i) => clip(i)),
    };
  });
}

export async function GET(): Promise<Response> {
  const headers = { "Cache-Control": "no-store", "Content-Type": "application/json; charset=utf-8" };
  if (opened) return Response.json({ stopped: "이 서버에서는 이미 한 번 열었습니다" }, { headers });
  opened = true;
  const vj = (process.env.VISITJEJU_API_KEY ?? "").trim();
  const kto = (process.env.DATA_GO_KR_API_KEY ?? "").trim();
  const kakao = (process.env.KAKAO_REST_API_KEY ?? "").trim();
  const keys = [vj, encodeURIComponent(vj), kto, serviceKeyParam(kto), encodeURIComponent(kto), kakao].filter((k) => k.length >= 8);
  const redact = (s: string) => keys.reduce((acc, k) => acc.split(k).join("[KEY]"), s);
  const attempts: Record<string, unknown>[] = [];
  if (vj) attempts.push(await visitJeju(vj, "c1"), await visitJeju(vj, "c4"));
  if (kto)
    attempts.push(
      await attempt(
        "kto 39",
        `https://apis.data.go.kr/B551011/KorService2/areaBasedList2?serviceKey=${serviceKeyParam(kto)}&MobileOS=ETC&MobileApp=JejuTraffic&_type=json&areaCode=39&contentTypeId=39&numOfRows=5&pageNo=1&arrange=A`,
        {},
        (b) => {
          const r = b.response as { header?: unknown; body?: { totalCount?: unknown; items?: { item?: unknown } } } | undefined;
          const items = (Array.isArray(r?.body?.items?.item) ? r.body.items.item : []) as Record<string, unknown>[];
          return { header: r?.header, totalCount: r?.body?.totalCount, itemKeys: [...new Set(items.flatMap((i) => Object.keys(i)))], samples: items.slice(0, 2).map((i) => clip(i)) };
        },
      ),
    );
  if (kakao)
    attempts.push(
      await attempt(
        "kakao CE7",
        "https://dapi.kakao.com/v2/local/search/category.json?category_group_code=CE7&x=126.5312&y=33.4996&radius=2000&size=15",
        { headers: { Authorization: `KakaoAK ${kakao}` } },
        (b) => {
          const docs = (Array.isArray(b.documents) ? b.documents : []) as Record<string, unknown>[];
          return { meta: b.meta, count: docs.length, itemKeys: [...new Set(docs.flatMap((d) => Object.keys(d)))], categories: docs.slice(0, 6).map((d) => d.category_name), samples: docs.slice(0, 2).map((d) => clip(d)) };
        },
      ),
    );
  const body = { region: process.env.VERCEL_REGION ?? null, checkedAt: new Date().toISOString(), keyPresent: { visitJeju: Boolean(vj), kto: Boolean(kto), kakao: Boolean(kakao) }, calls: attempts.length, attempts };
  return new Response(redact(JSON.stringify(body, null, 1)), { headers });
}
