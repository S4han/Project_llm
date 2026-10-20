// TASK-013 일회성 확인용(승인: "계획 승인: TASK-013 ... 2. 승인", 시험 호출 10건 이내). 확인 후 삭제한다. main에 넣지 않는다.
// 1차(2건): 두 키 모두 HTTP 400(본문 173바이트, 미출력) → 키가 아니라 요청 형식 문제로 보임.
// 2차: 기존 키로 파라미터 형식을 바꿔 최대 3건 시도하고, 오류 본문(메시지)을 그대로 보여 준다. 성공하면 그 형식으로 멈춘다.
// 인스턴스당 1번만 연다. 키 값은 응답에 넣지 않는다. 사용: 미리보기 주소 + /api/facility-probe 를 한 번만 연다.
let opened = false;
const VARIANTS = ["fdtType=FTY01", "fdt_type=FTY01", "fcltType=FTY01"];

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
  const key = process.env.JEJU_ITS_API_KEY ?? "";
  if (!key) return Response.json({ keyPresent: false }, { headers });
  const redact = (s: string) => s.split(key).join("[KEY]");
  const attempts: Record<string, unknown>[] = [];
  for (const v of VARIANTS) {
    const out: Record<string, unknown> = { query: v };
    try {
      const res = await fetch(`http://api.jejuits.go.kr/api/getFacilityInfo?code=${encodeURIComponent(key)}&${v}`, { signal: AbortSignal.timeout(15_000) });
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
      out.count = items.length;
      out.itemKeys = [...new Set(items.flatMap((i) => Object.keys(i)))];
      out.samples = items.slice(0, 2).map((i) => Object.fromEntries(Object.entries(i).map(([k, val]) => [k, clip(val, 40)])));
      out.x = range(items.map((i) => Number(i.x_crdn)));
      out.y = range(items.map((i) => Number(i.y_crdn)));
    } catch (e) {
      out.error = redact(String(e));
    }
    attempts.push(out);
    if (out.result === "success") break;
  }
  const text = redact(JSON.stringify({ region: process.env.VERCEL_REGION ?? null, checkedAt: new Date().toISOString(), calls: attempts.length, attempts }, null, 1));
  return new Response(text, { headers });
}
