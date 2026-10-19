// TASK-006 일회성 확인용(승인: ITS 실호출 10건 이내). 확인 후 삭제한다.
// 열 때마다 돌발·통제·공사를 1회씩(3건) 호출하고, 필드 이름과 정규화 결과 요약만 돌려준다.
// 인스턴스당 3회까지만 호출한다(최대 9건). 키 값은 응답에 넣지 않는다.
import { normalizeItsResponse, ITS_ENDPOINTS } from "./_lib/providers/jejuIts.js";
import type { IncidentKind } from "../shared/contracts/traffic.js";

let opens = 0;
const MAX_OPENS = 3;

function clip(v: unknown): unknown {
  return typeof v === "string" && v.length > 40 ? `${v.slice(0, 40)}…` : v;
}

export async function GET(): Promise<Response> {
  const key = process.env.JEJU_ITS_API_KEY ?? "";
  const headers = { "Cache-Control": "no-store" };
  if (!key) return Response.json({ keyPresent: false }, { headers });
  if (opens >= MAX_OPENS) return Response.json({ stopped: "호출 상한 도달(인스턴스당 3회)" }, { headers });
  opens += 1;
  const redact = (s: string) => s.split(key).join("[KEY]");
  const observedAt = new Date().toISOString();
  const results = [];
  for (const [kind, name] of Object.entries(ITS_ENDPOINTS)) {
    const out: Record<string, unknown> = { api: name };
    try {
      const res = await fetch(`http://api.jejuits.go.kr/api/${name}?code=${encodeURIComponent(key)}`, {
        signal: AbortSignal.timeout(10_000),
      });
      out.status = res.status;
      const body = (await res.json().catch(() => null)) as { result?: unknown; info?: unknown[]; Info?: unknown[] } | null;
      const items = (body?.info ?? body?.Info ?? []) as Record<string, unknown>[];
      out.result = body?.result;
      out.count = items.length;
      out.topKeys = body ? Object.keys(body) : [];
      out.itemKeys = [...new Set(items.flatMap((i) => Object.keys(i)))];
      out.samples = items.slice(0, 2).map((i) => Object.fromEntries(Object.entries(i).map(([k, v]) => [k, clip(v)])));
      try {
        const parsed = normalizeItsResponse(body, kind as IncidentKind, observedAt);
        out.parsed = {
          count: parsed.length,
          withSourceTime: parsed.filter((p) => p.sourceTime).length,
          descriptions: [...new Set(parsed.map((p) => p.description))].slice(0, 5),
        };
      } catch (e) {
        out.parseError = String(e);
      }
    } catch (e) {
      out.error = redact(String(e));
    }
    results.push(out);
  }
  const text = redact(JSON.stringify({ open: opens, maxOpens: MAX_OPENS, region: process.env.VERCEL_REGION ?? null, results }, null, 1));
  return new Response(text, { headers: { ...headers, "Content-Type": "application/json; charset=utf-8" } });
}
