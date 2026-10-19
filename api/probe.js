// TASK-001 C단계 일회성 확인용. 시험 후 삭제한다.
// 1단계(discover): 키 없이 제주 ITS 오픈API 안내 페이지에서 호출 주소 형식을 찾는다. 키는 존재 여부만 보고한다.
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15';
const BASE = 'https://jejuits.go.kr';

async function get(url) {
  const r = await fetch(url, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(10000) });
  return { status: r.status, body: await r.text() };
}

function text(html) {
  return html.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/\s+/g, ' ');
}

function uniq(a) { return [...new Set(a)]; }

export default async function handler(req, res) {
  const out = { keyPresent: Boolean(process.env.JEJU_ITS_API_KEY), vercelEnv: process.env.VERCEL_ENV || null };
  try {
    const page = await get(BASE + '/open_api/open_apiView.do');
    const h = page.body;
    out.status = page.status;
    out.apiUrls = uniq((h.match(/https?:\/\/[^\s"'<>()]*?(?:api|openapi|Api)[^\s"'<>()]*/g) || [])).slice(0, 40);
    out.relPaths = uniq((h.match(/["'](\/[A-Za-z0-9_\/.-]*(?:api|Api)[A-Za-z0-9_\/.-]*(?:\?[^"']*)?)["']/g) || []).map(s => s.slice(1, -1))).slice(0, 40);
    const t = text(h);
    const hits = [];
    for (const kw of ['요청 URL', '요청URL', '호출 URL', '요청주소', '인증키', 'code=', 'key=', '소통', '링크', 'LINK_ID', 'link_id', '응답']) {
      let i = t.indexOf(kw), n = 0;
      while (i >= 0 && n < 3) { hits.push(kw + ' :: ' + t.slice(Math.max(0, i - 60), i + 220)); i = t.indexOf(kw, i + 1); n++; }
    }
    out.snippets = hits.slice(0, 30);
  } catch (e) {
    out.error = String(e);
  }
  res.setHeader('Cache-Control', 'no-store');
  res.status(200).json(out);
}
