// TASK-001 C단계 일회성 확인용. 시험 후 삭제한다.
// 2단계: 제주 ITS 오픈API 5종을 각 1회 호출(총 5건)하고 평화로·1100도로·516도로 근처 항목만 요약한다.
// 키 값은 응답에 절대 포함하지 않는다.
const KEY = process.env.JEJU_ITS_API_KEY || '';
const ENDPOINTS = ['infoRoadEventList', 'infoRoadCloseList', 'infoRoadWorkList', 'infoVvmsList', 'infoRwisList'];
// 도로 축 근사선(위도, 경도) — 카카오 경로 좌표를 약 1.5km 간격으로 줄인 값
const ROADS = {"평화로":[[33.4782,126.4681],[33.4674,126.4578],[33.4589,126.4453],[33.4472,126.4359],[33.4366,126.4242],[33.4277,126.4125],[33.414,126.3982],[33.4062,126.3864],[33.3941,126.376],[33.3787,126.3705],[33.3645,126.3668],[33.3521,126.3597],[33.3332,126.3551],[33.3172,126.3491],[33.3039,126.3442],[33.2898,126.3518],[33.2809,126.3569]],"1100도로":[[33.4714,126.4846],[33.4573,126.4866],[33.4401,126.4884],[33.426,126.4913],[33.4147,126.4816],[33.4027,126.474],[33.3913,126.4832],[33.3821,126.4725],[33.3668,126.4686],[33.3534,126.4621],[33.3401,126.457],[33.3273,126.4629],[33.3137,126.4593],[33.2995,126.4587],[33.2905,126.4608]],"516도로":[[33.4558,126.5507],[33.4448,126.5594],[33.4386,126.5726],[33.4327,126.5854],[33.4277,126.5991],[33.4224,126.6125],[33.4108,126.6205],[33.3968,126.6172],[33.3832,126.6209],[33.3699,126.6254],[33.3561,126.6228],[33.3451,126.6141],[33.3323,126.6083],[33.3215,126.5992],[33.3075,126.5991],[33.2942,126.5946],[33.2813,126.5881],[33.2675,126.5854],[33.2557,126.5774],[33.2555,126.5773]]};
const BUFFER_M = 500;

// 점과 선분 사이 거리(m), 소규모 영역이라 평면 근사
function segDist(p, a, b) {
  const kx = 111320 * Math.cos(p[0] * Math.PI / 180), ky = 110540;
  const px = p[1] * kx, py = p[0] * ky, ax = a[1] * kx, ay = a[0] * ky, bx = b[1] * kx, by = b[0] * ky;
  const dx = bx - ax, dy = by - ay, l2 = dx * dx + dy * dy;
  const t = l2 ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / l2)) : 0;
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

function nearestRoad(lat, lng) {
  let best = null;
  for (const [name, line] of Object.entries(ROADS)) {
    for (let i = 1; i < line.length; i++) {
      const d = segDist([lat, lng], line[i - 1], line[i]);
      if (!best || d < best.d) best = { name, d };
    }
  }
  return best && best.d <= BUFFER_M ? { road: best.name, distM: Math.round(best.d) } : null;
}

function clip(o) {
  const r = {};
  for (const [k, v] of Object.entries(o)) r[k] = typeof v === 'string' && v.length > 120 ? v.slice(0, 120) + '…' : v;
  return r;
}

function redact(s) { return KEY ? s.split(KEY).join('[KEY]') : s; }

async function call(name) {
  const out = { api: name };
  try {
    const r = await fetch(`http://api.jejuits.go.kr/api/${name}?code=${encodeURIComponent(KEY)}`, { signal: AbortSignal.timeout(15000) });
    const body = await r.text();
    out.status = r.status;
    out.bytes = body.length;
    let j;
    try { j = JSON.parse(body); } catch { out.rawHead = redact(body.slice(0, 300)); return out; }
    const items = Array.isArray(j.Info) ? j.Info : Array.isArray(j.info) ? j.info : [];
    out.result = j.result;
    out.info_cnt = j.info_cnt ?? items.length;
    out.otherKeys = Object.keys(j).filter(k => !['Info', 'info'].includes(k));
    out.itemKeys = items[0] ? Object.keys(items[0]) : [];
    out.sample = items[0] ? clip(items[0]) : null;
    const near = [];
    for (const it of items) {
      const lat = Number(it.latitude ?? it.lat), lng = Number(it.longitude ?? it.lng ?? it.lon);
      if (!isFinite(lat) || !isFinite(lng)) continue;
      const m = nearestRoad(lat, lng);
      if (m) near.push({ ...m, ...clip(it) });
    }
    out.nearCount = near.length;
    out.nearByRoad = near.reduce((a, x) => (a[x.road] = (a[x.road] || 0) + 1, a), {});
    out.near = near.slice(0, 8);
    if (!items.length) out.rawHead = redact(body.slice(0, 300));
  } catch (e) {
    out.error = redact(String(e));
  }
  return out;
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (!KEY) return res.status(200).json({ keyPresent: false });
  const results = [];
  for (const name of ENDPOINTS) results.push(await call(name));
  res.status(200).json(JSON.parse(redact(JSON.stringify({ keyPresent: true, calls: ENDPOINTS.length, bufferM: BUFFER_M, results }))));
}
