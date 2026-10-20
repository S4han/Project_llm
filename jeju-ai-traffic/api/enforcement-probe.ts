// TASK-016 일회성 확인용(승인: "계획 승인: TASK-016 1. (a) 2. (a) 3. 승인", 시험 호출 5건 이내). 확인 후 삭제한다. main에 넣지 않는다.
// 제주시 주정차 단속 CCTV 조회(공공데이터포털 15109175, 명세: apis.data.go.kr/6510000/parkingControlCctvService/getParkingControlCctvList)를
// 1,000개(1쪽)만 받아 응답 형식·전체 건수·칸 이름·좌표 유효 비율·표본을 돌려준다. 항목이 없으면 오류 본문(키 가림)을 보여 준다.
// 첫 시도가 실패하고 키에 '%'가 있으면(인코딩 키를 넣은 경우) 키를 그대로 붙여 1번 더(최대 2건). 키 형식(길이·'%' 유무)만 알려 준다.
// 인스턴스당 1번만 연다. 키 값은 응답에 넣지 않는다. 사용: 미리보기 주소 + /api/enforcement-probe 를 한 번만 연다.
let opened = false;
const URL_BASE = "https://apis.data.go.kr/6510000/parkingControlCctvService/getParkingControlCctvList";

function clip(v: unknown): unknown {
  return typeof v === "string" && v.length > 60 ? `${v.slice(0, 60)}…` : v;
}

export async function GET(): Promise<Response> {
  const headers = { "Cache-Control": "no-store", "Content-Type": "application/json; charset=utf-8" };
  if (opened) return Response.json({ stopped: "이 서버에서는 이미 한 번 열었습니다" }, { headers });
  opened = true;
  const key = process.env.DATA_GO_KR_API_KEY ?? "";
  if (!key) return Response.json({ keyPresent: false }, { headers });
  const redact = (s: string) => s.split(key).join("[KEY]").split(encodeURIComponent(key)).join("[KEY]");
  const attempts: Record<string, unknown>[] = [];
  const keyShape = { length: key.length, hasPercent: key.includes("%"), hasPlusOrSlash: /[+/=]/.test(key), trimmedDiffers: key.trim() !== key };
  const modes = key.includes("%") ? ["encoded", "raw"] : ["encoded"];
  for (const mode of modes) {
    const q = new URLSearchParams({ pageNo: "1", numOfRows: "1000" });
    const url = mode === "raw" ? `${URL_BASE}?serviceKey=${key.trim()}&${q}` : `${URL_BASE}?serviceKey=${encodeURIComponent(key.trim())}&${q}`;
    const out: Record<string, unknown> = { mode };
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(20_000) });
      out.status = res.status;
      out.contentType = res.headers.get("content-type");
      const text = await res.text();
      out.length = text.length;
      let body: unknown;
      try {
        body = JSON.parse(text);
      } catch {
        out.notJson = text.slice(0, 600).replace(/\s+/g, " ");
      }
      if (body && !(body as { response?: unknown }).response) out.rawBody = text.slice(0, 600);
      if (body) {
        const root = (body as { response?: unknown }).response ?? body;
        const r = root as { header?: unknown; body?: { totalCount?: unknown; numOfRows?: unknown; pageNo?: unknown; items?: unknown } };
        out.topKeys = Object.keys(body as object);
        out.header = r.header;
        out.totalCount = r.body?.totalCount;
        out.numOfRows = r.body?.numOfRows;
        out.pageNo = r.body?.pageNo;
        const raw = (r.body?.items as { item?: unknown } | undefined)?.item ?? r.body?.items;
        const items = (Array.isArray(raw) ? raw : raw ? [raw] : []) as Record<string, unknown>[];
        out.itemsShape = Array.isArray(raw) ? "array" : typeof raw;
        out.itemCount = items.length;
        out.itemKeys = [...new Set(items.flatMap((i) => Object.keys(i)))];
        const lat = (i: Record<string, unknown>) => Number(i.laCrdnt);
        const lng = (i: Record<string, unknown>) => Number(i.loCrdnt);
        out.coordsInJeju = items.filter((i) => lat(i) > 33.1 && lat(i) < 33.6 && lng(i) > 126.1 && lng(i) < 127.0).length;
        out.coordsSwappedLike = items.filter((i) => lng(i) > 33.1 && lng(i) < 33.6 && lat(i) > 126.1 && lat(i) < 127.0).length;
        out.distinctDataCd = new Set(items.map((i) => String(i.dataCd ?? ""))).size;
        out.rotateValues = [...new Set(items.map((i) => String(i.rtateCctvCnt ?? "")))].slice(0, 10);
        out.auditValues = [...new Set(items.map((i) => String(i.auditCctvCnt ?? "")))].slice(0, 10);
        out.operTimeValues = [...new Set(items.map((i) => String(i.operTimeInfo ?? "")))].slice(0, 8);
        out.samples = items.slice(0, 3).map((i) => Object.fromEntries(Object.entries(i).map(([k, v]) => [k, clip(v)])));
      }
    } catch (e) {
      out.error = String(e);
    }
    attempts.push(out);
    if (typeof out.itemCount === "number" && out.itemCount > 0) break;
  }
  return new Response(redact(JSON.stringify({ region: process.env.VERCEL_REGION ?? null, keyShape, checkedAt: new Date().toISOString(), calls: attempts.length, attempts }, null, 1)), { headers });
}
