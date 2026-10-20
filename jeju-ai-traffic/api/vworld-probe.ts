// TASK-012 일회성 확인용(승인: "계획 승인: TASK-012 브이월드 (A)", 시험 호출 1~2건). 확인 후 삭제한다. main에 넣지 않는다.
// 브이월드 2D 데이터 API 교통링크(LT_L_MOCTLINK)를 제주 전체 범위로 3건만 요청해 전체 건수·속성 이름·모양 형식만 돌려준다.
// 실패하면 domain 값 없이 1번 더 시도한다(최대 2건). 인스턴스당 1번만 연다. 키 값은 응답에 넣지 않는다.
// 사용: 미리보기 주소 + /api/vworld-probe 를 한 번만 연다(Vercel icn1).
let opened = false;
const DOMAIN = "https://jeju-its-probe.vercel.app";

function clip(v: unknown): unknown {
  return typeof v === "string" && v.length > 60 ? `${v.slice(0, 60)}…` : v;
}

export async function GET(): Promise<Response> {
  const key = process.env.VWORLD_API_KEY ?? "";
  const headers = { "Cache-Control": "no-store", "Content-Type": "application/json; charset=utf-8" };
  if (!key) return Response.json({ keyPresent: false }, { headers });
  if (opened) return Response.json({ stopped: "이 서버에서는 이미 한 번 열었습니다" }, { headers });
  opened = true;
  const redact = (s: string) => s.split(key).join("[KEY]");
  const attempts: Record<string, unknown>[] = [];
  for (const domain of [DOMAIN, null]) {
    const q = new URLSearchParams({
      service: "data",
      version: "2.0",
      request: "GetFeature",
      format: "json",
      errorformat: "json",
      size: "3",
      page: "1",
      data: "LT_L_MOCTLINK",
      geomFilter: "BOX(126.1,33.1,127.0,33.6)",
      geometry: "true",
      attribute: "true",
      crs: "EPSG:4326",
      key,
    });
    if (domain) q.set("domain", domain);
    const out: Record<string, unknown> = { withDomain: Boolean(domain) };
    const t = Date.now();
    try {
      const res = await fetch(`https://api.vworld.kr/req/data?${q}`, { signal: AbortSignal.timeout(20_000) });
      out.status = res.status;
      const text = await res.text();
      out.bytes = text.length;
      out.ms = Date.now() - t;
      const body = JSON.parse(text) as {
        response?: {
          status?: string;
          error?: unknown;
          record?: { total?: string; current?: string };
          page?: unknown;
          result?: { featureCollection?: { features?: { properties?: Record<string, unknown>; geometry?: { type?: string; coordinates?: unknown } }[] } };
        };
      };
      const r = body.response;
      out.apiStatus = r?.status;
      out.apiError = r?.error;
      out.record = r?.record;
      out.page = r?.page;
      const features = r?.result?.featureCollection?.features ?? [];
      out.propertyKeys = [...new Set(features.flatMap((f) => Object.keys(f.properties ?? {})))];
      out.samples = features.map((f) => ({
        properties: Object.fromEntries(Object.entries(f.properties ?? {}).map(([k, v]) => [k, clip(v)])),
        geometryType: f.geometry?.type,
        firstCoords: clip(JSON.stringify(f.geometry?.coordinates).slice(0, 120)),
      }));
    } catch (e) {
      const err = e as { message?: string; cause?: { code?: string; message?: string } };
      out.error = { message: err.message, causeCode: err.cause?.code, cause: err.cause?.message };
    }
    attempts.push(out);
    if (out.apiStatus === "OK") break;
  }
  const text = redact(JSON.stringify({ region: process.env.VERCEL_REGION ?? null, checkedAt: new Date().toISOString(), attempts }, null, 1));
  return new Response(text, { headers });
}
