// TASK-018·019 일회성 확인용(승인: "범위 변경: TASK-018 제주 ITS 주유소 / 계획 승인: TASK-019 … / 시험 4건 승인"). 확인 후 삭제한다. main에 넣지 않는다.
// 제주 ITS 주유소 기본정보·가격, 전기차 충전소 기본정보·충전 가능 정보를 1건씩(4건).
// 사용자 "주유소 충전소 정보는 c-its api야" → C-ITS 키(JEJU_CITS_API_KEY)가 있으면 그것으로, 없으면 실시간 교통정보 키로.
// 건수·항목 이름·좌표로 보이는 칸의 범위·표본·두 목록의 ID 일치 수만 돌려준다. 인스턴스당 1번만 연다. 키 값은 응답에 넣지 않는다.
// 사용: 미리보기 주소 + /api/its-fuel-probe 를 한 번만 연다.
let opened = false;
const BASE = "http://api.jejuits.go.kr/api";
const PATHS = ["infoGasInfoList", "infoGasPriceList", "infoEvInfoList", "infoEvList"] as const;

function clip(v: unknown, n = 80): unknown {
  return typeof v === "string" && v.length > n ? `${v.slice(0, n)}…` : v;
}

function range(values: number[]) {
  const ok = values.filter((v) => Number.isFinite(v) && v !== 0);
  return ok.length ? { min: Math.min(...ok), max: Math.max(...ok), n: ok.length } : null;
}

export async function GET(): Promise<Response> {
  const headers = { "Cache-Control": "no-store", "Content-Type": "application/json; charset=utf-8" };
  if (opened) return Response.json({ stopped: "이 서버에서는 이미 한 번 열었습니다" }, { headers });
  opened = true;
  // 1차(4건): 실시간 교통정보 키는 4개 모두 "code not registered". 2차: 사용자 "JEJU_ITS_API_KEY 사용해봐" → 돌발 키로 4건.
  const keyName = "JEJU_ITS_API_KEY";
  const key = process.env[keyName] ?? "";
  if (!key) return Response.json({ keyPresent: false }, { headers });
  const redact = (s: string) => s.split(key).join("[KEY]").split(encodeURIComponent(key)).join("[KEY]");
  const ids: Record<string, Set<string>> = {};
  const attempts: Record<string, unknown>[] = [];
  for (const path of PATHS) {
    const out: Record<string, unknown> = { path };
    try {
      const t0 = Date.now();
      const res = await fetch(`${BASE}/${path}?code=${encodeURIComponent(key)}`, { signal: AbortSignal.timeout(25_000) });
      out.status = res.status;
      const text = await res.text();
      out.ms = Date.now() - t0;
      out.length = text.length;
      try {
        const body = JSON.parse(text) as { result?: unknown; info_cnt?: unknown; info?: unknown; Info?: unknown };
        out.result = clip(body.result);
        out.info_cnt = body.info_cnt;
        const items = (Array.isArray(body.info) ? body.info : Array.isArray(body.Info) ? body.Info : []) as Record<string, unknown>[];
        out.count = items.length;
        const keys = [...new Set(items.flatMap((i) => Object.keys(i)))];
        out.itemKeys = keys;
        out.coordLike = Object.fromEntries(keys.filter((k) => /crdn|lat|lng|lon|^x|^y|gis/i.test(k)).map((k) => [k, range(items.map((i) => Number(i[k])))]));
        out.valueSamples = Object.fromEntries(
          keys.filter((k) => /yn|type|kind|poll|div|cd$|stat|fast|slow|gasoline|diesel|lpg|output|kw|power|method/i.test(k)).map((k) => [k, [...new Set(items.map((i) => String(i[k])))].slice(0, 8)]),
        );
        out.samples = items.slice(0, 2).map((i) => Object.fromEntries(Object.entries(i).map(([k, v]) => [k, clip(v)])));
        ids[path] = new Set(items.map((i) => String(i.id ?? "")));
      } catch {
        out.notJson = text.slice(0, 300).replace(/\s+/g, " ");
      }
    } catch (e) {
      out.error = String(e);
    }
    attempts.push(out);
  }
  const overlap = (a: string, b: string) => (ids[a] && ids[b] ? [...ids[b]!].filter((id) => ids[a]!.has(id)).length : null);
  const summary = { gasPriceIdsInInfo: overlap("infoGasInfoList", "infoGasPriceList"), evStatusIdsInInfo: overlap("infoEvInfoList", "infoEvList"), evInfoDistinctIds: ids.infoEvInfoList?.size ?? null };
  return new Response(redact(JSON.stringify({ region: process.env.VERCEL_REGION ?? null, keyUsed: keyName, checkedAt: new Date().toISOString(), calls: attempts.length, summary, attempts }, null, 1)), { headers });
}
