// TASK-015 일회성 확인용(승인: "계획 승인: TASK-015 1. (a)", 시험 호출 5건 이내). 확인 후 삭제한다. main에 넣지 않는다.
// 브이월드 교통노드(LT_P_MOCTNODE)를 제주 범위로 1,000개(1쪽)만 받아 전체 건수·속성 이름·이름이 채워진 비율·표본을 돌려준다.
// 실패하면 데이터 이름을 바꿔 1번 더(최대 2건). 인스턴스당 1번만 연다. 키 값은 응답에 넣지 않는다.
// 사용: 미리보기 주소 + /api/node-probe 를 한 번만 연다.
let opened = false;
const LAYERS = ["LT_P_MOCTNODE", "LT_P_MOCTNODE_DONG"];

function clip(v: unknown): unknown {
  return typeof v === "string" && v.length > 40 ? `${v.slice(0, 40)}…` : v;
}

export async function GET(): Promise<Response> {
  const headers = { "Cache-Control": "no-store", "Content-Type": "application/json; charset=utf-8" };
  if (opened) return Response.json({ stopped: "이 서버에서는 이미 한 번 열었습니다" }, { headers });
  opened = true;
  const key = process.env.VWORLD_API_KEY ?? "";
  if (!key) return Response.json({ keyPresent: false }, { headers });
  const redact = (s: string) => s.split(key).join("[KEY]");
  const attempts: Record<string, unknown>[] = [];
  for (const data of LAYERS) {
    const q = new URLSearchParams({
      service: "data", version: "2.0", request: "GetFeature", format: "json", errorformat: "json",
      size: "1000", page: "1", data, geomFilter: "BOX(126.1,33.1,127.0,33.6)", geometry: "true", attribute: "true",
      crs: "EPSG:4326", domain: process.env.VWORLD_DOMAIN || "https://jeju-its-probe.vercel.app", key,
    });
    const out: Record<string, unknown> = { data };
    try {
      const res = await fetch(`https://api.vworld.kr/req/data?${q}`, { signal: AbortSignal.timeout(20_000) });
      out.status = res.status;
      const body = (await res.json()) as { response?: { status?: string; error?: unknown; record?: unknown; page?: unknown; result?: { featureCollection?: { features?: { properties?: Record<string, unknown>; geometry?: { type?: string; coordinates?: unknown } }[] } } } };
      const r = body.response;
      out.apiStatus = r?.status;
      out.apiError = r?.error;
      out.record = r?.record;
      out.page = r?.page;
      const features = r?.result?.featureCollection?.features ?? [];
      const keys = [...new Set(features.flatMap((f) => Object.keys(f.properties ?? {})))];
      out.propertyKeys = keys;
      const nameKey = keys.find((k) => /name|nm/i.test(k));
      out.nameKey = nameKey ?? null;
      if (nameKey) {
        const names = features.map((f) => String(f.properties?.[nameKey] ?? "").trim());
        out.named = names.filter(Boolean).length;
        out.numericLike = names.filter((n) => /\d{3,}/.test(n)).length;
        out.nameSamples = names.filter(Boolean).slice(0, 12);
      }
      out.samples = features.slice(0, 3).map((f) => ({
        properties: Object.fromEntries(Object.entries(f.properties ?? {}).map(([k, v]) => [k, clip(v)])),
        geometryType: f.geometry?.type,
        coords: clip(JSON.stringify(f.geometry?.coordinates)),
      }));
    } catch (e) {
      out.error = String(e);
    }
    attempts.push(out);
    if (out.apiStatus === "OK") break;
  }
  return new Response(redact(JSON.stringify({ region: process.env.VERCEL_REGION ?? null, checkedAt: new Date().toISOString(), calls: attempts.length, attempts }, null, 1)), { headers });
}
