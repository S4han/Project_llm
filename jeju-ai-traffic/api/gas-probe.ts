// TASK-018 일회성 확인용(승인: "계획 승인: TASK-018 1. (a) 2. (a) 3. (a)", 시험 호출 5건 이내). 확인 후 삭제한다. main에 넣지 않는다.
// 오피넷 반경 내 주유소(aroundAll.do)를 제주시청 부근(KATEC 263722, 101365) 반경 5km로 휘발유(B027)·경유(D047) 1건씩,
// 되면 첫 주유소 상세(detailById.do) 1건(최대 3건). 건수·항목 이름·좌표(위도·경도로 바꿔 제주 안인지)·상표·가격 범위·표본만 돌려준다.
// 인스턴스당 1번만 연다. 키 값은 응답에 넣지 않는다. 사용: 미리보기 주소 + /api/gas-probe 를 한 번만 연다.
import { katecToWgs84 } from "../shared/rules/katec.js";
import { isInJeju } from "../shared/rules/geo.js";

let opened = false;
const BASE = "https://www.opinet.co.kr/api";

function clip(v: unknown, n = 120): unknown {
  return typeof v === "string" && v.length > n ? `${v.slice(0, n)}…` : v;
}

async function call(url: string) {
  const out: Record<string, unknown> = {};
  let oil: Record<string, unknown>[] = [];
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(20_000) });
    out.status = res.status;
    out.contentType = res.headers.get("content-type");
    const text = await res.text();
    out.length = text.length;
    try {
      const body = JSON.parse(text) as { RESULT?: { OIL?: unknown } };
      out.topKeys = Object.keys(body);
      oil = (Array.isArray(body.RESULT?.OIL) ? body.RESULT?.OIL : []) as Record<string, unknown>[];
      out.count = oil.length;
      out.itemKeys = [...new Set(oil.flatMap((i) => Object.keys(i)))];
      out.samples = oil.slice(0, 2).map((i) => Object.fromEntries(Object.entries(i).map(([k, v]) => [k, clip(typeof v === "object" ? JSON.stringify(v) : v)])));
      if (!oil.length) out.raw = text.slice(0, 300);
    } catch {
      out.notJson = text.slice(0, 300).replace(/\s+/g, " ");
    }
  } catch (e) {
    out.error = String(e);
  }
  return { out, oil };
}

export async function GET(): Promise<Response> {
  const headers = { "Cache-Control": "no-store", "Content-Type": "application/json; charset=utf-8" };
  if (opened) return Response.json({ stopped: "이 서버에서는 이미 한 번 열었습니다" }, { headers });
  opened = true;
  const key = process.env.OPINET_API_KEY ?? "";
  if (!key) return Response.json({ keyPresent: false }, { headers });
  const redact = (s: string) => s.split(key).join("[KEY]").split(encodeURIComponent(key)).join("[KEY]");
  const attempts: Record<string, unknown>[] = [];
  let first: Record<string, unknown> | undefined;
  for (const prodcd of ["B027", "D047"]) {
    const { out, oil } = await call(`${BASE}/aroundAll.do?code=${encodeURIComponent(key)}&x=263722&y=101365&radius=5000&sort=1&prodcd=${prodcd}&out=json`);
    const coords = oil.map((i) => katecToWgs84({ x: Number(i.GIS_X_COOR), y: Number(i.GIS_Y_COOR) }));
    out.prodcd = prodcd;
    out.inJeju = coords.filter(isInJeju).length;
    out.firstWgs84 = coords[0] ?? null;
    out.brands = [...new Set(oil.map((i) => String(i.POLL_DIV_CD ?? "")))];
    const prices = oil.map((i) => Number(i.PRICE)).filter((p) => p > 0);
    out.priceRange = prices.length ? [Math.min(...prices), Math.max(...prices)] : null;
    attempts.push(out);
    first ??= oil[0];
    if (!oil.length) break;
  }
  if (first?.UNI_ID) {
    const { out } = await call(`${BASE}/detailById.do?code=${encodeURIComponent(key)}&id=${encodeURIComponent(String(first.UNI_ID))}&out=json`);
    attempts.push({ detail: true, ...out });
  }
  return new Response(redact(JSON.stringify({ region: process.env.VERCEL_REGION ?? null, checkedAt: new Date().toISOString(), calls: attempts.length, attempts }, null, 1)), { headers });
}
