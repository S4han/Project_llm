// TASK-030 일회성 확인용(계획 승인 "4. 승인", 최대 3건). 확인 후 삭제한다. main에 넣지 않는다.
// 한국관광공사 반려동물 동반여행 서비스(KorPetTourService2):
// 1) 제주(areaCode 39) 지역기반 목록 1건 2) 그 목록 첫 장소의 detailPetTour2 1건
// 3) 국문 관광정보의 제주 관광지 번호(검색 목록에서 쓰는 번호)로 detailPetTour2 1건 — 번호 체계가 같은지.
// 건수·항목 이름·표본만 돌려준다. 인스턴스당 1번만 연다. 키 값은 응답에 넣지 않는다.
// 사용: 미리보기 주소 + /api/pet-probe 를 한 번만 연다.
import { serviceKeyParam } from "./_lib/providers/jejuCityEnforcement.js";

let opened = false;
const BASE = "https://apis.data.go.kr/B551011/KorPetTourService2";

function clip(v: unknown, n = 120): unknown {
  if (typeof v === "string") return v.length > n ? `${v.slice(0, n)}…` : v;
  if (v && typeof v === "object") return Object.fromEntries(Object.entries(v as Record<string, unknown>).map(([k, x]) => [k, clip(x, n)]));
  return v;
}

async function call(key: string, op: string, params: string) {
  const out: Record<string, unknown> = { op, params };
  try {
    const res = await fetch(`${BASE}/${op}?serviceKey=${serviceKeyParam(key)}&MobileOS=ETC&MobileApp=JejuTraffic&_type=json&${params}`, { signal: AbortSignal.timeout(20_000) });
    out.status = res.status;
    const text = await res.text();
    out.length = text.length;
    let b: { response?: { header?: unknown; body?: { totalCount?: unknown; items?: { item?: unknown } | string } } };
    try {
      b = JSON.parse(text);
    } catch {
      out.raw = text.slice(0, 300);
      return { out, items: [] as Record<string, unknown>[] };
    }
    out.header = b.response?.header;
    out.totalCount = b.response?.body?.totalCount;
    const raw = typeof b.response?.body?.items === "object" ? b.response.body.items.item : undefined;
    const items = (Array.isArray(raw) ? raw : raw ? [raw] : []) as Record<string, unknown>[];
    out.count = items.length;
    out.itemKeys = [...new Set(items.flatMap((i) => Object.keys(i)))];
    out.samples = items.slice(0, 2).map((i) => clip(i));
    return { out, items };
  } catch (e) {
    out.error = String(e);
    return { out, items: [] as Record<string, unknown>[] };
  }
}

export async function GET(): Promise<Response> {
  const headers = { "Cache-Control": "no-store", "Content-Type": "application/json; charset=utf-8" };
  if (opened) return Response.json({ stopped: "이 서버에서는 이미 한 번 열었습니다" }, { headers });
  opened = true;
  const key = (process.env.DATA_GO_KR_API_KEY ?? "").trim();
  if (!key) return Response.json({ keyPresent: false }, { headers });
  const keys = [key, serviceKeyParam(key), encodeURIComponent(key)].filter((k) => k.length >= 8);
  const redact = (s: string) => keys.reduce((acc, k) => acc.split(k).join("[KEY]"), s);
  const list = await call(key, "areaBasedList2", "areaCode=39&numOfRows=1000&pageNo=1&arrange=A");
  const types = list.items.reduce<Record<string, number>>((m, i) => ((m[String(i.contenttypeid)] = (m[String(i.contenttypeid)] ?? 0) + 1), m), {});
  const attempts: unknown[] = [{ ...list.out, samples: (list.out.samples as unknown[] | undefined)?.slice(0, 1), contentTypes: types, firstIds: list.items.slice(0, 5).map((i) => [i.contentid, i.title]) }];
  const firstId = String(list.items[0]?.contentid ?? "");
  if (firstId) attempts.push((await call(key, "detailPetTour2", `contentId=${encodeURIComponent(firstId)}`)).out);
  // 국문 관광정보 제주 관광지 번호: 목록에 국문 관광정보에도 있는 번호가 섞여 있는지는 1번 결과로 보고, 여기서는 관광지 하나(성산일출봉 계열이 아닐 수 있어 목록 밖 번호)를 직접 본다.
  attempts.push((await call(key, "detailPetTour2", "contentId=2850913")).out);
  return new Response(redact(JSON.stringify({ checkedAt: new Date().toISOString(), calls: attempts.length, attempts }, null, 1)), { headers });
}
