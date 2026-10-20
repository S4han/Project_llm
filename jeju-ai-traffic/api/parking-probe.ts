// TASK-017 일회성 확인용(승인: "계획 승인: TASK-017 1. (a) 2. (a) 3. (a)", 시험 호출 5건 이내). 확인 후 삭제한다. main에 넣지 않는다.
// 제주 ITS 주차장 기본정보(infoParkingInfoList)와 주차가능면수(infoParkingStateList)를 1번씩 부른다.
// 1차(1건): 실시간 교통정보 키는 "code not registered". 2차: 주차장 전용 키(JEJU_ITS_PARKING_API_KEY, 있으면) → 실시간 교통정보 키(주차장 활용 승인 뒤 같은 키일 수 있음)
// → 돌발 키(JEJU_ITS_API_KEY) 순서로 기본정보에 시험하고, 되는 키로 주차가능면수를 부른다(최대 4건, 누적 최대 5건).
// 2차 결과(2건, 누적 3건): 두 키 모두 "code not registered". 3차: 사용자가 고른 키 하나(?key=traffic 기본 | incident | parking)로만
// 기본정보 1건, 되면 주차가능면수 1건(최대 2건).
// 3차 결과(1건, 누적 4건): 돌발 키도 "code not registered". 사용자 "시험 한도 8건 승인 1. 승은 2. 돌발 정보" — 승인 상태·돌발 키에 추가됨.
// 4차: ?key=incident로 최대 2건(누적 최대 6건/8건).
// 건수·항목 이름·좌표 범위(x/y 중 어느 쪽이 위도인지)·표본·두 목록의 ID 일치 수만 돌려준다. 인스턴스당 1번만 연다. 키 값은 응답에 넣지 않는다.
// 사용: 미리보기 주소 + /api/parking-probe 를 한 번만 연다.
let opened = false;
const BASE = "http://api.jejuits.go.kr/api";

function clip(v: unknown, n = 200): unknown {
  return typeof v === "string" && v.length > n ? `${v.slice(0, n)}…` : v;
}

function range(values: number[]) {
  const ok = values.filter(Number.isFinite);
  return ok.length ? { min: Math.min(...ok), max: Math.max(...ok), n: ok.length } : null;
}

async function call(path: string, key: string) {
  const out: Record<string, unknown> = { path };
  let items: Record<string, unknown>[] = [];
  try {
    const res = await fetch(`${BASE}/${path}?code=${encodeURIComponent(key)}`, { signal: AbortSignal.timeout(20_000) });
    out.status = res.status;
    out.contentType = res.headers.get("content-type");
    const text = await res.text();
    out.length = text.length;
    try {
      const body = JSON.parse(text) as { result?: unknown; info_cnt?: unknown; info?: unknown; Info?: unknown };
      out.topKeys = Object.keys(body);
      out.result = clip(body.result);
      out.info_cnt = body.info_cnt;
      items = (Array.isArray(body.info) ? body.info : Array.isArray(body.Info) ? body.Info : []) as Record<string, unknown>[];
      out.itemCount = items.length;
      out.itemKeys = [...new Set(items.flatMap((i) => Object.keys(i)))];
      out.samples = items.slice(0, 3).map((i) => Object.fromEntries(Object.entries(i).map(([k, v]) => [k, clip(v)])));
    } catch {
      out.notJson = text.slice(0, 400).replace(/\s+/g, " ");
    }
  } catch (e) {
    out.error = String(e);
  }
  return { out, items };
}

export async function GET(request: Request): Promise<Response> {
  const headers = { "Cache-Control": "no-store", "Content-Type": "application/json; charset=utf-8" };
  if (opened) return Response.json({ stopped: "이 서버에서는 이미 한 번 열었습니다" }, { headers });
  opened = true;
  const pick = new URL(request.url).searchParams.get("key");
  const name = pick === "incident" ? "JEJU_ITS_API_KEY" : pick === "parking" ? "JEJU_ITS_PARKING_API_KEY" : "JEJU_ITS_TRAFFIC_API_KEY";
  const keys = ([name] as const).map((name) => ({ name, key: process.env[name] ?? "" })).filter((k) => k.key);
  if (!keys.length) return Response.json({ keyPresent: false }, { headers });
  const redact = (s: string) => keys.reduce((acc, k) => acc.split(k.key).join("[KEY]").split(encodeURIComponent(k.key)).join("[KEY]"), s);
  const attempts: Record<string, unknown>[] = [];
  let info: Record<string, unknown>[] = [];
  let used: { name: string; key: string } | null = null;
  for (const k of keys) {
    const r = await call("infoParkingInfoList", k.key);
    attempts.push({ key: k.name, ...r.out });
    if (r.out.result === "success") {
      info = r.items;
      used = k;
      break;
    }
  }
  const summary: Record<string, unknown> = {};
  if (used) {
    const x = info.map((i) => Number(i.x_crdn));
    const y = info.map((i) => Number(i.y_crdn));
    summary.xRange = range(x);
    summary.yRange = range(y);
    summary.xLooksLat = x.filter((v) => v > 33 && v < 34).length;
    summary.yLooksLat = y.filter((v) => v > 33 && v < 34).length;
    summary.totalSpaces = info.reduce((s, i) => s + (Number(i.whol_npls) || 0), 0);
    summary.withAddr = info.filter((i) => String(i.addr ?? "").trim()).length;
    summary.parkDayValues = [...new Set(info.map((i) => String(i.park_day ?? "")))].slice(0, 6);
    const st = await call("infoParkingStateList", used.key);
    attempts.push({ key: used.name, ...st.out });
    const infoIds = new Set(info.map((i) => String(i.id ?? "")));
    summary.stateCount = st.items.length;
    summary.stateIdsInInfo = st.items.filter((i) => infoIds.has(String(i.id ?? ""))).length;
    summary.stateGnrlRange = range(st.items.map((i) => Number(i.gnrl)));
  }
  return new Response(
    redact(JSON.stringify({ region: process.env.VERCEL_REGION ?? null, checkedAt: new Date().toISOString(), keyUsed: used?.name ?? null, calls: attempts.length, summary, attempts }, null, 1)),
    { headers },
  );
}
