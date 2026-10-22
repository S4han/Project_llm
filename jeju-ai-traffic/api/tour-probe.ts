// TASK-026 일회성 확인용(승인: "계획 승인: TASK-026 1. (a) 2. (a) 3. (a) 4. 승인 신청 완료", 시험 호출 5건 이내). 확인 후 삭제한다. main에 넣지 않는다.
// 한국관광공사 국문 관광정보 서비스_GW(KorService2)를 부른다: 제주 관광지 목록(지역 코드 39, 안 되면 법정동 50) → 첫 관광지의 소개정보·공통정보 → 목록 전체(최대 1,000건) 한 번.
// 건수·항목 이름·표본·좌표 범위·사진/전화가 있는 비율만 돌려준다. 인스턴스당 1번만 연다. 키 값은 응답에 넣지 않는다.
// 사용: 미리보기 주소 + /api/tour-probe 를 한 번만 연다.
import { serviceKeyParam } from "./_lib/providers/jejuCityEnforcement.js";

let opened = false;
const BASE = "https://apis.data.go.kr/B551011/KorService2";
const COMMON = "MobileOS=ETC&MobileApp=JejuTraffic&_type=json";

function clip(v: unknown, n = 300): unknown {
  return typeof v === "string" && v.length > n ? `${v.slice(0, n)}…` : v;
}

async function call(op: string, params: string, key: string) {
  const out: Record<string, unknown> = { op, params };
  let items: Record<string, unknown>[] = [];
  try {
    const res = await fetch(`${BASE}/${op}?serviceKey=${serviceKeyParam(key)}&${COMMON}&${params}`, { signal: AbortSignal.timeout(20_000) });
    out.status = res.status;
    out.contentType = res.headers.get("content-type");
    const text = await res.text();
    out.length = text.length;
    try {
      const body = JSON.parse(text) as { response?: { header?: unknown; body?: { totalCount?: unknown; items?: { item?: unknown } | string } } };
      out.header = body.response?.header ?? clip(text, 400);
      out.totalCount = body.response?.body?.totalCount;
      const raw = typeof body.response?.body?.items === "object" ? body.response.body.items.item : undefined;
      items = (Array.isArray(raw) ? raw : raw ? [raw] : []) as Record<string, unknown>[];
      out.itemCount = items.length;
      out.itemKeys = [...new Set(items.flatMap((i) => Object.keys(i)))];
      out.samples = items.slice(0, 2).map((i) => Object.fromEntries(Object.entries(i).map(([k, v]) => [k, clip(v)])));
    } catch {
      out.notJson = text.slice(0, 400).replace(/\s+/g, " ");
    }
  } catch (e) {
    out.error = String(e);
  }
  return { out, items };
}

export async function GET(): Promise<Response> {
  const headers = { "Cache-Control": "no-store", "Content-Type": "application/json; charset=utf-8" };
  if (opened) return Response.json({ stopped: "이 서버에서는 이미 한 번 열었습니다" }, { headers });
  opened = true;
  const key = process.env.DATA_GO_KR_API_KEY ?? "";
  if (!key) return Response.json({ keyPresent: false }, { headers });
  const redact = (s: string) => s.split(key).join("[KEY]").split(encodeURIComponent(key)).join("[KEY]");
  const attempts: Record<string, unknown>[] = [];
  let region = "areaCode=39";
  let first = await call("areaBasedList2", `${region}&contentTypeId=12&numOfRows=3&pageNo=1&arrange=A`, key);
  attempts.push(first.out);
  if (!first.items.length) {
    region = "lDongRegnCd=50";
    first = await call("areaBasedList2", `${region}&contentTypeId=12&numOfRows=3&pageNo=1&arrange=A`, key);
    attempts.push(first.out);
  }
  const summary: Record<string, unknown> = { region };
  const id = first.items[0]?.contentid;
  if (id) {
    attempts.push((await call("detailIntro2", `contentId=${id}&contentTypeId=12`, key)).out);
    attempts.push((await call("detailCommon2", `contentId=${id}`, key)).out);
    if (attempts.length < 5) {
      const all = await call("areaBasedList2", `${region}&contentTypeId=12&numOfRows=1000&pageNo=1&arrange=A`, key);
      attempts.push({ ...all.out, samples: undefined });
      const lat = all.items.map((i) => Number(i.mapy)).filter(Number.isFinite);
      const lng = all.items.map((i) => Number(i.mapx)).filter(Number.isFinite);
      summary.listAll = all.items.length;
      summary.latRange = lat.length ? [Math.min(...lat), Math.max(...lat)] : null;
      summary.lngRange = lng.length ? [Math.min(...lng), Math.max(...lng)] : null;
      summary.withImage = all.items.filter((i) => String(i.firstimage ?? "").trim()).length;
      summary.withTel = all.items.filter((i) => String(i.tel ?? "").trim()).length;
      summary.cpyrht = [...new Set(all.items.map((i) => String(i.cpyrhtDivCd ?? "")))];
      summary.cats = [...new Set(all.items.map((i) => String(i.lclsSystm3 ?? i.cat3 ?? "")))].slice(0, 15);
    }
  }
  return new Response(redact(JSON.stringify({ region: process.env.VERCEL_REGION ?? null, checkedAt: new Date().toISOString(), calls: attempts.length, summary, attempts }, null, 1)), { headers });
}
