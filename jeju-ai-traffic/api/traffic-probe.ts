// TASK-012 일회성 확인용(승인: "계획 승인: TASK-012 소통정보 1. 승인", 시험 호출 5건 이내). 확인 후 삭제한다. main에 넣지 않는다.
// 열 때마다 실시간 교통정보 API(getFrafficInfo, 1차 확인에서 이름 확인)를 1회 호출한다.
// 인스턴스당 2번까지만 연다(최대 2건). 누적: 승인 5건 중 3건 사용(1차 2건, 2차 1건 모두 "code not registered"). 키 값은 응답에 넣지 않고, 원본 대신 요약만 돌려준다.
// 사용: 미리보기 주소 + /api/traffic-probe 를 한 번만 연다(Vercel icn1, 국내 IP).
let opens = 0;
const MAX_OPENS = 2;
const NAMES = ["getFrafficInfo"];

function clip(v: unknown): unknown {
  return typeof v === "string" && v.length > 40 ? `${v.slice(0, 40)}…` : v;
}

function stats(values: number[]) {
  const ok = values.filter((v) => Number.isFinite(v)).sort((a, b) => a - b);
  if (ok.length === 0) return null;
  return { n: ok.length, min: ok[0], median: ok[Math.floor(ok.length / 2)], max: ok[ok.length - 1], zeroOrNegative: ok.filter((v) => v <= 0).length };
}

export async function GET(): Promise<Response> {
  // 실시간 교통정보용 키를 따로 받았으면 그것을, 없으면 기존 키를 쓴다. 응답에는 어떤 이름을 썼는지만 넣는다.
  const keyName = process.env.JEJU_ITS_TRAFFIC_API_KEY ? "JEJU_ITS_TRAFFIC_API_KEY" : "JEJU_ITS_API_KEY";
  const key = process.env[keyName] ?? "";
  const headers = { "Cache-Control": "no-store", "Content-Type": "application/json; charset=utf-8" };
  if (!key) return Response.json({ keyPresent: false }, { headers });
  if (opens >= MAX_OPENS) return Response.json({ stopped: "호출 상한 도달(인스턴스당 2번)" }, { headers });
  opens += 1;
  const redact = (s: string) => s.split(key).join("[KEY]");
  const results = [];
  for (const name of NAMES) {
    const out: Record<string, unknown> = { api: name };
    try {
      const res = await fetch(`http://api.jejuits.go.kr/api/${name}?code=${encodeURIComponent(key)}&type=L`, { signal: AbortSignal.timeout(15_000) });
      out.status = res.status;
      const text = await res.text();
      out.bytes = text.length;
      let body: { result?: unknown; info_cnt?: unknown; info?: unknown[]; Info?: unknown[] } | null = null;
      try {
        body = JSON.parse(text);
      } catch {
        out.notJson = clip(text.slice(0, 80));
      }
      const items = (body?.info ?? body?.Info ?? []) as Record<string, unknown>[];
      out.result = body?.result;
      out.infoCnt = body?.info_cnt;
      out.count = items.length;
      out.topKeys = body ? Object.keys(body) : [];
      out.itemKeys = [...new Set(items.flatMap((i) => Object.keys(i)))];
      out.samples = items.slice(0, 3).map((i) => Object.fromEntries(Object.entries(i).map(([k, v]) => [k, clip(v)])));
      const ids = items.map((i) => String(i.link_id ?? ""));
      out.linkId = {
        lengths: [...new Set(ids.map((s) => s.length))],
        prefixes: Object.fromEntries([...new Set(ids.map((s) => s.slice(0, 3)))].map((p) => [p, ids.filter((s) => s.startsWith(p)).length])),
        unique: new Set(ids).size,
      };
      const times = items.map((i) => String(i.prcn_dt ?? "")).filter(Boolean).sort();
      out.prcnDt = { distinct: new Set(times).size, min: times[0], max: times[times.length - 1] };
      out.sped = stats(items.map((i) => Number(i.sped)));
      out.trvlHh = stats(items.map((i) => Number(i.trvl_hh)));
      out.tfvl = stats(items.map((i) => Number(i.tfvl)));
      out.ocpyRate = stats(items.map((i) => Number(i.ocpy_rate)));
    } catch (e) {
      out.error = redact(String(e));
    }
    results.push(out);
    if (out.result === "success") break;
  }
  const text = redact(JSON.stringify({ open: opens, maxOpens: MAX_OPENS, keyName, region: process.env.VERCEL_REGION ?? null, checkedAt: new Date().toISOString(), results }, null, 1));
  return new Response(text, { headers });
}
