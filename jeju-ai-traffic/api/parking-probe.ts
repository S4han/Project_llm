// TASK-017 일회성 확인용(승인: "계획 승인: TASK-017 ...", "시험 한도 8건 승인"). 확인 후 삭제한다. main에 넣지 않는다.
// 1~4차(누적 5건): 제주 ITS 주차장 기본정보는 실시간 교통정보 키·돌발 키 모두 "code not registered".
// 5차(최대 3건, 누적 최대 8건):
//  ① 제주 ITS 주차장 기본정보를 실시간 교통정보 키로 1건(사용자 "JEJU_ITS_TRAFFIC_API_KEY 사용해봐")
//  ② 전국주차장정보표준데이터(공공데이터포털 15012896, 사용자 활용신청·승인 완료)를 제주시·서귀포시 기관코드로 1건씩
// 건수·항목 이름·좌표 범위·표본만 돌려준다. 인스턴스당 1번만 연다. 키 값은 응답에 넣지 않는다. 사용: 미리보기 주소 + /api/parking-probe
let opened = false;

function clip(v: unknown, n = 160): unknown {
  return typeof v === "string" && v.length > n ? `${v.slice(0, n)}…` : v;
}

function range(values: number[]) {
  const ok = values.filter(Number.isFinite);
  return ok.length ? { min: Math.min(...ok), max: Math.max(...ok), n: ok.length } : null;
}

async function getText(url: string, out: Record<string, unknown>): Promise<unknown> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(20_000) });
    out.status = res.status;
    out.contentType = res.headers.get("content-type");
    const text = await res.text();
    out.length = text.length;
    try {
      return JSON.parse(text);
    } catch {
      out.notJson = text.slice(0, 400).replace(/\s+/g, " ");
    }
  } catch (e) {
    out.error = String(e);
  }
  return null;
}

export async function GET(): Promise<Response> {
  const headers = { "Cache-Control": "no-store", "Content-Type": "application/json; charset=utf-8" };
  if (opened) return Response.json({ stopped: "이 서버에서는 이미 한 번 열었습니다" }, { headers });
  opened = true;
  const its = process.env.JEJU_ITS_TRAFFIC_API_KEY ?? "";
  const dg = (process.env.DATA_GO_KR_API_KEY ?? "").trim();
  const redact = (s: string) => [its, dg].filter(Boolean).reduce((acc, k) => acc.split(k).join("[KEY]").split(encodeURIComponent(k)).join("[KEY]"), s);
  const attempts: Record<string, unknown>[] = [];

  if (its) {
    const out: Record<string, unknown> = { source: "jejuIts infoParkingInfoList", key: "JEJU_ITS_TRAFFIC_API_KEY" };
    const body = (await getText(`http://api.jejuits.go.kr/api/infoParkingInfoList?code=${encodeURIComponent(its)}`, out)) as { result?: unknown; info_cnt?: unknown; info?: unknown; Info?: unknown } | null;
    if (body) {
      out.result = clip(body.result);
      out.info_cnt = body.info_cnt;
      const items = (Array.isArray(body.info) ? body.info : Array.isArray(body.Info) ? body.Info : []) as Record<string, unknown>[];
      out.itemCount = items.length;
      out.itemKeys = [...new Set(items.flatMap((i) => Object.keys(i)))];
      out.xRange = range(items.map((i) => Number(i.x_crdn)));
      out.yRange = range(items.map((i) => Number(i.y_crdn)));
      out.samples = items.slice(0, 2).map((i) => Object.fromEntries(Object.entries(i).map(([k, v]) => [k, clip(v)])));
    }
    attempts.push(out);
  }

  if (dg) {
    const keyParam = dg.includes("%") ? dg : encodeURIComponent(dg);
    for (const [label, code] of [["제주시", "6510000"], ["서귀포시", "6520000"]] as const) {
      const out: Record<string, unknown> = { source: "data.go.kr tn_pubr_prkplce_info_api", label, instt_code: code };
      const body = (await getText(`http://api.data.go.kr/openapi/tn_pubr_prkplce_info_api?serviceKey=${keyParam}&pageNo=1&numOfRows=1000&type=json&instt_code=${code}`, out)) as {
        response?: { header?: unknown; body?: { totalCount?: unknown; items?: unknown } };
      } | null;
      if (body) {
        out.topKeys = Object.keys(body);
        if (!body.response) out.rawBody = JSON.stringify(body).slice(0, 400);
        out.header = body.response?.header;
        out.totalCount = body.response?.body?.totalCount;
        const raw = (body.response?.body?.items as { item?: unknown } | undefined)?.item ?? body.response?.body?.items;
        const items = (Array.isArray(raw) ? raw : raw ? [raw] : []) as Record<string, unknown>[];
        out.itemCount = items.length;
        out.itemKeys = [...new Set(items.flatMap((i) => Object.keys(i)))];
        out.latRange = range(items.map((i) => Number(i.latitude)));
        out.lngRange = range(items.map((i) => Number(i.longitude)));
        out.coordsInJeju = items.filter((i) => Number(i.latitude) > 33.1 && Number(i.latitude) < 33.6 && Number(i.longitude) > 126.1 && Number(i.longitude) < 127.0).length;
        out.prkplceSeValues = [...new Set(items.map((i) => String(i.prkplceSe ?? "")))].slice(0, 6);
        out.prkplceTypeValues = [...new Set(items.map((i) => String(i.prkplceType ?? "")))].slice(0, 6);
        out.insttNmValues = [...new Set(items.map((i) => String(i.instt_nm ?? i.institutionNm ?? "")))].slice(0, 4);
        out.referenceDates = [...new Set(items.map((i) => String(i.referenceDate ?? "")))].slice(0, 4);
        out.samples = items.slice(0, 2).map((i) => Object.fromEntries(Object.entries(i).map(([k, v]) => [k, clip(v)])));
      }
      attempts.push(out);
    }
  }

  return new Response(redact(JSON.stringify({ region: process.env.VERCEL_REGION ?? null, checkedAt: new Date().toISOString(), calls: attempts.length, attempts }, null, 1)), { headers });
}
