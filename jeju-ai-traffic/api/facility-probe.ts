// TASK-013 일회성 확인용(승인: "계획 승인: TASK-013 ... 2. 승인", 시험 호출 10건 이내). 확인 후 삭제한다. main에 넣지 않는다.
// 1·2차(5건): 파라미터 이름은 fdtType이 아니라 fcltType(서버 오류 메시지 확인), 기존 키는 "code not registered".
// 3차: 아직 올바른 형식으로 시험하지 않은 키(전용 키 → 실시간 교통정보 키)를 VMS로 차례로 시험하고,
// 되는 키가 있으면 CCTV 1건을 더 불러 항목 이름·좌표 형식을 확인한다(최대 3건, 누적 최대 8건).
// 인스턴스당 1번만 연다. 키 값은 응답에 넣지 않는다. 사용: 미리보기 주소 + /api/facility-probe 를 한 번만 연다.
let opened = false;
const TYPES = ["FTY01", "FTY02"];

function clip(v: unknown, n = 300): unknown {
  return typeof v === "string" && v.length > n ? `${v.slice(0, n)}…` : v;
}

function range(values: number[]) {
  const ok = values.filter(Number.isFinite);
  return ok.length ? { min: Math.min(...ok), max: Math.max(...ok), n: ok.length } : null;
}

export async function GET(): Promise<Response> {
  const headers = { "Cache-Control": "no-store", "Content-Type": "application/json; charset=utf-8" };
  if (opened) return Response.json({ stopped: "이 서버에서는 이미 한 번 열었습니다" }, { headers });
  opened = true;
  const keys = (["JEJU_ITS_FACILITY_API_KEY", "JEJU_ITS_TRAFFIC_API_KEY"] as const).map((name) => ({ name, key: process.env[name] ?? "" })).filter((k) => k.key);
  if (!keys.length) return Response.json({ keyPresent: false }, { headers });
  const redact = (s: string) => keys.reduce((acc, k) => acc.split(k.key).join("[KEY]"), s);
  const results: Record<string, unknown>[] = [];
  let keyName: string | null = null;
  const plan: { type: string; key: { name: string; key: string } }[] = keys.map((k) => ({ type: TYPES[0]!, key: k }));
  for (let i = 0; i < plan.length; i++) {
    const { type, key: k } = plan[i]!;
    const key = k.key;
    const out: Record<string, unknown> = { type, keyName: k.name };
    try {
      const res = await fetch(`http://api.jejuits.go.kr/api/getFacilityInfo?code=${encodeURIComponent(key)}&fcltType=${type}`, { signal: AbortSignal.timeout(15_000) });
      out.status = res.status;
      const text = await res.text();
      out.bytes = text.length;
      let body: { result?: unknown; info_cnt?: unknown; info?: unknown[]; Info?: unknown[] } | null = null;
      try {
        body = JSON.parse(text);
      } catch {
        /* 본문 그대로 */
      }
      if (res.status !== 200 || !body || body.result !== "success") out.body = clip(redact(text));
      const items = (body?.info ?? body?.Info ?? []) as Record<string, unknown>[];
      out.result = body?.result;
      out.infoCnt = body?.info_cnt;
      out.count = items.length;
      out.itemKeys = [...new Set(items.flatMap((i) => Object.keys(i)))];
      out.samples = items.slice(0, 3).map((i) => Object.fromEntries(Object.entries(i).map(([k, val]) => [k, clip(val, 40)])));
      out.x = range(items.map((i) => Number(i.x_crdn)));
      out.y = range(items.map((i) => Number(i.y_crdn)));
    } catch (e) {
      out.error = redact(String(e));
    }
    results.push(out);
    // 되는 키를 찾으면 그 키로 CCTV 1건만 더 부르고 멈춘다.
    if (out.result === "success" && type === TYPES[0]) {
      keyName = k.name;
      plan.splice(i + 1, plan.length, { type: TYPES[1]!, key: k });
    }
  }
  const text = redact(JSON.stringify({ region: process.env.VERCEL_REGION ?? null, checkedAt: new Date().toISOString(), keyName, calls: results.length, results }, null, 1));
  return new Response(text, { headers });
}
