// TASK-013 일회성 확인용(승인: "계획 승인: TASK-013 ... 2. 승인", 시험 호출 10건 이내). 확인 후 삭제한다. main에 넣지 않는다.
// 1) VMS(FTY01)로 어떤 키가 이 API에 등록되어 있는지 찾는다(기존 키 → 실시간 교통정보 키, 최대 2건).
// 2) 찾은 키로 나머지 6개 유형을 1건씩(최대 6건). 합계 최대 8건. 요약(건수·항목 이름·좌표 범위·표본 2개)만 돌려준다.
// 인스턴스당 1번만 연다. 키 값은 응답에 넣지 않는다. 사용: 미리보기 주소 + /api/facility-probe 를 한 번만 연다.
let opened = false;
const TYPES = ["FTY01", "FTY02", "FTY03", "FTY07", "FTY09", "FTY17", "FTY23"];
const KEY_NAMES = ["JEJU_ITS_API_KEY", "JEJU_ITS_TRAFFIC_API_KEY"] as const;

function clip(v: unknown): unknown {
  return typeof v === "string" && v.length > 40 ? `${v.slice(0, 40)}…` : v;
}

function range(values: number[]) {
  const ok = values.filter(Number.isFinite);
  return ok.length ? { min: Math.min(...ok), max: Math.max(...ok), n: ok.length } : null;
}

async function call(key: string, type: string) {
  const out: Record<string, unknown> = { type };
  try {
    const res = await fetch(`http://api.jejuits.go.kr/api/getFacilityInfo?code=${encodeURIComponent(key)}&fdtType=${type}`, { signal: AbortSignal.timeout(15_000) });
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
    out.itemKeys = [...new Set(items.flatMap((i) => Object.keys(i)))];
    out.samples = items.slice(0, 2).map((i) => Object.fromEntries(Object.entries(i).map(([k, v]) => [k, clip(v)])));
    out.x = range(items.map((i) => Number(i.x_crdn)));
    out.y = range(items.map((i) => Number(i.y_crdn)));
    out.types = [...new Set(items.map((i) => String(i.fdt_type ?? i.fclt_type ?? "")))];
  } catch (e) {
    out.error = String(e);
  }
  return out;
}

export async function GET(): Promise<Response> {
  const headers = { "Cache-Control": "no-store", "Content-Type": "application/json; charset=utf-8" };
  if (opened) return Response.json({ stopped: "이 서버에서는 이미 한 번 열었습니다" }, { headers });
  opened = true;
  const keys = KEY_NAMES.map((name) => ({ name, key: process.env[name] ?? "" })).filter((k) => k.key);
  const redact = (s: string) => keys.reduce((acc, k) => acc.split(k.key).join("[KEY]"), s);
  const keyTrials: Record<string, unknown>[] = [];
  let found: { name: string; key: string } | null = null;
  for (const k of keys) {
    const r = await call(k.key, TYPES[0]!);
    keyTrials.push({ keyName: k.name, ...r });
    if (r.result === "success") {
      found = k;
      break;
    }
  }
  const results = found ? [keyTrials.at(-1), ...(await Promise.all(TYPES.slice(1).map((t) => call(found!.key, t))))] : [];
  const calls = keyTrials.length + Math.max(0, results.length - 1);
  const text = redact(JSON.stringify({ region: process.env.VERCEL_REGION ?? null, checkedAt: new Date().toISOString(), keyUsed: found?.name ?? null, calls, keyTrials: found ? keyTrials.slice(0, -1) : keyTrials, results }, null, 1));
  return new Response(text, { headers });
}
