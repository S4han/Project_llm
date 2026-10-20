// TASK-012 일회성 확인용(승인: "계획 승인: TASK-012 노드링크 (a)"). 확인 후 삭제한다. main에 넣지 않는다.
// 국가교통정보센터 표준노드링크 파일을 받아 크기·압축 구성·링크 레이어 속성·제주 구간 수·처리 시간만 돌려준다(파일 저장 없음).
// 인스턴스당 1번만 연다. 사용: 미리보기 주소 + /api/nodelink-probe 를 한 번만 연다(Vercel icn1, 국내 IP).
import { inflateRawSync } from "node:zlib";

const URL_ = "https://www.its.go.kr/opendata/nodelinkFileSDownload/DF_221/0";
let opened = false;

interface Entry {
  name: string;
  method: number;
  compressed: number;
  size: number;
  offset: number;
}

/** ZIP 중앙 디렉터리 읽기(ZIP64 미지원). 이름은 CP949일 수 있어 latin1로 둔다. */
function listZip(buf: Buffer): Entry[] {
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 70000); i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error("zip 끝 표시 없음");
  const count = buf.readUInt16LE(eocd + 10);
  let o = buf.readUInt32LE(eocd + 16);
  const entries: Entry[] = [];
  for (let i = 0; i < count; i++) {
    const nameLen = buf.readUInt16LE(o + 28);
    const extraLen = buf.readUInt16LE(o + 30);
    const commentLen = buf.readUInt16LE(o + 32);
    entries.push({
      name: buf.toString("latin1", o + 46, o + 46 + nameLen),
      method: buf.readUInt16LE(o + 10),
      compressed: buf.readUInt32LE(o + 20),
      size: buf.readUInt32LE(o + 24),
      offset: buf.readUInt32LE(o + 42),
    });
    o += 46 + nameLen + extraLen + commentLen;
  }
  return entries;
}

function extract(buf: Buffer, e: Entry): Buffer {
  const nameLen = buf.readUInt16LE(e.offset + 26);
  const extraLen = buf.readUInt16LE(e.offset + 28);
  const start = e.offset + 30 + nameLen + extraLen;
  const data = buf.subarray(start, start + e.compressed);
  return e.method === 0 ? Buffer.from(data) : inflateRawSync(data);
}

export async function GET(): Promise<Response> {
  const headers = { "Cache-Control": "no-store", "Content-Type": "application/json; charset=utf-8" };
  if (opened) return Response.json({ stopped: "이 서버에서는 이미 한 번 열었습니다" }, { headers });
  opened = true;
  const t0 = Date.now();
  const out: Record<string, unknown> = { region: process.env.VERCEL_REGION ?? null, checkedAt: new Date().toISOString() };
  try {
    const res = await fetch(URL_, { redirect: "follow", signal: AbortSignal.timeout(45_000) });
    out.status = res.status;
    out.finalUrl = res.url.replace(/[?].*$/, "");
    out.contentType = res.headers.get("content-type");
    out.contentDisposition = res.headers.get("content-disposition");
    out.contentLength = res.headers.get("content-length");
    const buf = Buffer.from(await res.arrayBuffer());
    out.bytes = buf.length;
    out.downloadMs = Date.now() - t0;
    out.head = buf.subarray(0, 4).toString("hex");
    if (buf.readUInt32LE(0) !== 0x04034b50) {
      out.notZip = buf.toString("utf8", 0, 200);
      return Response.json(out, { headers });
    }
    const entries = listZip(buf);
    out.entries = entries.map((e) => ({ name: e.name, size: e.size, compressed: e.compressed }));
    const linkShp = entries.find((e) => /link\.shp$/i.test(e.name));
    if (!linkShp) return Response.json(out, { headers });
    const stem = linkShp.name.slice(0, -4).toLowerCase();
    const byExt = (ext: string) => entries.find((e) => e.name.toLowerCase() === stem + ext);
    const prj = byExt(".prj");
    if (prj) out.prj = extract(buf, prj).toString("utf8").slice(0, 600);
    const dbfEntry = byExt(".dbf");
    if (dbfEntry) {
      const t1 = Date.now();
      const dbf = extract(buf, dbfEntry);
      const n = dbf.readUInt32LE(4);
      const headerLen = dbf.readUInt16LE(8);
      const recLen = dbf.readUInt16LE(10);
      const fields: { name: string; len: number; off: number }[] = [];
      let off = 1;
      for (let o = 32; dbf[o] !== 0x0d; o += 32) {
        const f = { name: dbf.toString("latin1", o, o + 11).replace(/\0.*$/, ""), len: dbf[o + 16]!, off };
        fields.push(f);
        off += f.len;
      }
      out.fields = fields.map((f) => `${f.name}(${f.len})`);
      out.rows = n;
      const id = fields.find((f) => /^LINK_ID$/i.test(f.name));
      if (id) {
        let jeju = 0;
        const samples: string[] = [];
        for (let i = 0; i < n; i++) {
          const s = dbf.toString("latin1", headerLen + i * recLen + id.off, headerLen + i * recLen + id.off + id.len).trim();
          if (/^40[56]/.test(s)) {
            jeju += 1;
            if (samples.length < 3) samples.push(s);
          }
        }
        out.jejuLinks = jeju;
        out.jejuSamples = samples;
      }
      out.dbfMs = Date.now() - t1;
    }
    const t2 = Date.now();
    const shp = extract(buf, linkShp);
    out.shpBytes = shp.length;
    out.shpType = shp.readInt32LE(32);
    out.shpBbox = [shp.readDoubleLE(36), shp.readDoubleLE(44), shp.readDoubleLE(52), shp.readDoubleLE(60)].map((v) => Math.round(v));
    out.shpMs = Date.now() - t2;
  } catch (e) {
    out.error = String(e);
  }
  out.totalMs = Date.now() - t0;
  out.memoryMb = Math.round(process.memoryUsage().rss / 1e6);
  return new Response(JSON.stringify(out, null, 1), { headers });
}
