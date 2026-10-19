// TASK-001 BLK-06 일회성 확인용 (키 사용 안 함). 시험 후 삭제한다.
// Vercel icn1 리전에서 jejuits.go.kr 웹 방화벽 통과 여부와 아웃바운드 IP 국가를 확인한다.
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15';

async function check(url) {
  try {
    const r = await fetch(url, { headers: { 'User-Agent': UA }, redirect: 'manual', signal: AbortSignal.timeout(10000) });
    const body = await r.text();
    const title = (body.match(/<title>([^<]*)/i) || [])[1] || null;
    return { url, status: r.status, location: r.headers.get('location'), waf: /Web firewall/i.test(body), title, bytes: body.length };
  } catch (e) {
    return { url, error: String(e) };
  }
}

export default async function handler(req, res) {
  let egress = null;
  try {
    const r = await fetch('https://ipinfo.io/json', { signal: AbortSignal.timeout(5000) });
    const j = await r.json();
    egress = { country: j.country, region: j.region, org: j.org };
  } catch (e) {
    egress = { error: String(e) };
  }
  const results = await Promise.all(['https://www.jejuits.go.kr/', 'https://jejuits.go.kr/open_api/open_apiView.do'].map(check));
  res.setHeader('Cache-Control', 'no-store');
  res.status(200).json({ vercelRegion: process.env.VERCEL_REGION || null, egress, results });
}
