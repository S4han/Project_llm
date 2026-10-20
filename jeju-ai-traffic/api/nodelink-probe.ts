// TASK-012 일회성 확인용(승인: "계획 승인: TASK-012 노드링크 (a)"). 확인 후 삭제한다. main에 넣지 않는다.
// 국가교통정보센터 표준노드링크(약 256MB zip)에서 필요한 부분만 골라 받을 수 있는지(Range) 확인하고,
// 되면 압축 목록·링크 속성 파일만 받아 제주 구간 수·크기·속도를 돌려준다. 안 되면 전체를 흘려받으며 속도만 잰다(저장 없음).
// 인스턴스당 1번만 연다. 사용: 미리보기 주소 + /api/nodelink-probe 를 한 번만 연다(Vercel icn1, 국내 IP).
import { inflateRawSync } from "node:zlib";

const URLS = ["https://www.its.go.kr/opendata/nodelinkFileSDownload/DF_221/0", "http://www.its.go.kr/opendata/nodelinkFileSDownload/DF_221/0"];

/** fetch 실패의 실제 원인(인증서·DNS·연결 거부 등)을 꺼낸다. */
function why(e: unknown): Record<string, unknown> {
  const err = e as { message?: string; cause?: { code?: string; message?: string; reason?: string } };
  return { message: err.message, causeCode: err.cause?.code, cause: err.cause?.message, reason: err.cause?.reason };
}
let opened = false;

async function range(url: string, start: number, end: number): Promise<{ status: number; buf: Buffer; total: number | null }> {
  const res = await fetch(url, { headers: { Range: `bytes=${start}-${end}` }, signal: AbortSignal.timeout(120_000) });
  const total = Number(res.headers.get("content-range")?.split("/")[1]) || null;
  return { status: res.status, buf: Buffer.from(await res.arrayBuffer()), total };
}

interface Entry {
  name: string;
  method: number;
  compressed: number;
  size: number;
  offset: number;
}

function parseCentral(cd: Buffer, count: number): Entry[] {
  const entries: Entry[] = [];
  let o = 0;
  for (let i = 0; i < count && o + 46 <= cd.length; i++) {
    const nameLen = cd.readUInt16LE(o + 28);
    const extraLen = cd.readUInt16LE(o + 30);
    const commentLen = cd.readUInt16LE(o + 32);
    entries.push({
      name: cd.toString("latin1", o + 46, o + 46 + nameLen),
      method: cd.readUInt16LE(o + 10),
      compressed: cd.readUInt32LE(o + 20),
      size: cd.readUInt32LE(o + 24),
      offset: cd.readUInt32LE(o + 42),
    });
    o += 46 + nameLen + extraLen + commentLen;
  }
  return entries;
}

async function fetchEntry(url: string, e: Entry): Promise<Buffer> {
  const head = await range(url, e.offset, e.offset + 29);
  const start = e.offset + 30 + head.buf.readUInt16LE(26) + head.buf.readUInt16LE(28);
  const data = await range(url, start, start + e.compressed - 1);
  return e.method === 0 ? data.buf : inflateRawSync(data.buf);
}

export async function GET(): Promise<Response> {
  const headers = { "Cache-Control": "no-store", "Content-Type": "application/json; charset=utf-8" };
  if (opened) return Response.json({ stopped: "이 서버에서는 이미 한 번 열었습니다" }, { headers });
  opened = true;
  const t0 = Date.now();
  const out: Record<string, unknown> = { region: process.env.VERCEL_REGION ?? null, checkedAt: new Date().toISOString() };
  try {
    // 1) Range 지원 여부: 첫 4바이트만 요청. https가 연결 단계에서 실패하면 http로 한 번 더.
    const attempts: Record<string, unknown>[] = [];
    out.attempts = attempts;
    let first: Response | null = null;
    for (const u of URLS) {
      try {
        first = await fetch(u, { headers: { Range: "bytes=0-3" }, redirect: "follow", signal: AbortSignal.timeout(30_000) });
        attempts.push({ url: u, status: first.status });
        break;
      } catch (e) {
        attempts.push({ url: u, ...why(e) });
      }
    }
    if (!first) throw new Error("모든 주소 연결 실패");
    const url = first.url;
    out.firstStatus = first.status;
    out.acceptRanges = first.headers.get("accept-ranges");
    out.contentRange = first.headers.get("content-range");
    out.contentType = first.headers.get("content-type");
    out.contentDisposition = first.headers.get("content-disposition");
    const total = Number(first.headers.get("content-range")?.split("/")[1]) || Number(first.headers.get("content-length")) || null;
    out.totalBytes = total;

    if (first.status !== 206 || !total) {
      // 2-b) Range 미지원: 본문을 흘려받으며 속도만 잰다(최대 50초)
      const reader = first.body?.getReader();
      let bytes = 0;
      while (reader && Date.now() - t0 < 50_000) {
        const { done, value } = await reader.read();
        if (done) break;
        bytes += value.length;
      }
      await reader?.cancel().catch(() => undefined);
      out.rangeSupported = false;
      out.streamedBytes = bytes;
      out.streamMs = Date.now() - t0;
      out.mbPerSec = Math.round((bytes / 1e6 / ((Date.now() - t0) / 1000)) * 10) / 10;
    } else {
      // 2-a) Range 지원: 끝부분에서 압축 목록을 읽고 링크 속성만 받는다
      await first.arrayBuffer().catch(() => undefined);
      out.rangeSupported = true;
      const tailLen = Math.min(total, 70_000);
      const tail = await range(url, total - tailLen, total - 1);
      let eocd = -1;
      for (let i = tail.buf.length - 22; i >= 0; i--) {
        if (tail.buf.readUInt32LE(i) === 0x06054b50) {
          eocd = i;
          break;
        }
      }
      if (eocd < 0) throw new Error("zip 끝 표시 없음");
      const count = tail.buf.readUInt16LE(eocd + 10);
      const cdSize = tail.buf.readUInt32LE(eocd + 12);
      const cdOffset = tail.buf.readUInt32LE(eocd + 16);
      const cd = await range(url, cdOffset, cdOffset + cdSize - 1);
      const entries = parseCentral(cd.buf, count);
      out.entries = entries.map((e) => ({ name: e.name, size: e.size, compressed: e.compressed }));
      const linkShp = entries.find((e) => /link\.shp$/i.test(e.name));
      if (linkShp) {
        const stem = linkShp.name.slice(0, -4).toLowerCase();
        const byExt = (ext: string) => entries.find((e) => e.name.toLowerCase() === stem + ext);
        const prj = byExt(".prj");
        if (prj) out.prj = (await fetchEntry(url, prj)).toString("utf8").slice(0, 600);
        const dbfEntry = byExt(".dbf");
        if (dbfEntry) {
          const t1 = Date.now();
          const dbf = await fetchEntry(url, dbfEntry);
          out.dbfDownloadMs = Date.now() - t1;
          out.mbPerSec = Math.round((dbfEntry.compressed / 1e6 / ((Date.now() - t1) / 1000)) * 10) / 10;
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
            let firstJeju = -1;
            let lastJeju = -1;
            for (let i = 0; i < n; i++) {
              const s = dbf.toString("latin1", headerLen + i * recLen + id.off, headerLen + i * recLen + id.off + id.len).trim();
              if (/^40[56]/.test(s)) {
                jeju += 1;
                if (firstJeju < 0) firstJeju = i;
                lastJeju = i;
              }
            }
            // 제주 행이 한 덩어리로 모여 있으면 .shp도 그 부분만 받으면 된다(.shx로 위치 확인 가능)
            out.jeju = { links: jeju, firstRow: firstJeju, lastRow: lastJeju, contiguous: lastJeju - firstJeju + 1 === jeju };
          }
        }
        const shx = byExt(".shx");
        out.shp = { compressed: linkShp.compressed, size: linkShp.size, method: linkShp.method, shxCompressed: shx?.compressed ?? null };
      }
    }
  } catch (e) {
    out.error = why(e);
  }
  out.totalMs = Date.now() - t0;
  out.memoryMb = Math.round(process.memoryUsage().rss / 1e6);
  return new Response(JSON.stringify(out, null, 1), { headers });
}
