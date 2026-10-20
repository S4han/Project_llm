// 표준노드링크(SHP) → 제주 구간 지도 데이터(TASK-012). 사용: node build-jeju-links.mjs <압축 푼 폴더> <출력.json>
// 링크 레이어(.shp/.dbf/.prj)를 찾아 LINK_ID가 405·406으로 시작하는 구간만 남기고, WGS84로 바꿔 단순화한다.
// 출력: { version, source, links: { [link_id]: [도로명, 도로등급, 인코딩된 좌표열] } } — 좌표는 Google polyline(정밀도 1e5).
import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import proj4 from "proj4";

const [, , dir, out] = process.argv;
if (!dir || !out) throw new Error("사용: node build-jeju-links.mjs <폴더> <출력.json>");

const walk = (d) => readdirSync(d).flatMap((f) => (statSync(join(d, f)).isDirectory() ? walk(join(d, f)) : [join(d, f)]));
const files = walk(dir);
const shp = files.find((f) => /link\.shp$/i.test(f));
if (!shp) throw new Error(`링크 .shp 없음: ${files.map((f) => basename(f)).join(", ")}`);
const stem = shp.slice(0, -4);
const find = (ext) => files.find((f) => f.toLowerCase() === `${stem}${ext}`.toLowerCase());
const prjText = readFileSync(find(".prj"), "utf8");
console.log("링크 파일:", basename(shp), "\n좌표계:", prjText.slice(0, 200));

// DBF(EUC-KR) 읽기
function readDbf(buf) {
  const n = buf.readUInt32LE(4);
  const headerLen = buf.readUInt16LE(8);
  const recLen = buf.readUInt16LE(10);
  const fields = [];
  for (let o = 32; buf[o] !== 0x0d; o += 32) {
    fields.push({ name: buf.toString("latin1", o, o + 11).replace(/\0.*$/, ""), len: buf[o + 16] });
  }
  const dec = new TextDecoder("euc-kr");
  const rows = [];
  for (let i = 0; i < n; i++) {
    let o = headerLen + i * recLen + 1;
    const row = {};
    for (const f of fields) {
      row[f.name] = dec.decode(buf.subarray(o, o + f.len)).trim();
      o += f.len;
    }
    rows.push(row);
  }
  return { fields: fields.map((f) => f.name), rows };
}

// SHP(PolyLine) 읽기
function readShp(buf) {
  const shapes = [];
  let o = 100;
  while (o < buf.length) {
    const len = buf.readInt32BE(o + 4) * 2;
    const type = buf.readInt32LE(o + 8);
    if (type === 3 || type === 13 || type === 23) {
      const b = o + 8;
      const numParts = buf.readInt32LE(b + 36);
      const numPoints = buf.readInt32LE(b + 40);
      const pts = [];
      const p0 = b + 44 + numParts * 4;
      for (let i = 0; i < numPoints; i++) pts.push([buf.readDoubleLE(p0 + i * 16), buf.readDoubleLE(p0 + i * 16 + 8)]);
      shapes.push(pts);
    } else shapes.push([]);
    o += 8 + len;
  }
  return shapes;
}

const dbf = readDbf(readFileSync(find(".dbf")));
console.log("속성:", dbf.fields.join(","), "행", dbf.rows.length);
const shapes = readShp(readFileSync(shp));
const idField = dbf.fields.find((f) => /^LINK_ID$/i.test(f));
const nameField = dbf.fields.find((f) => /^ROAD_NAME$/i.test(f));
const rankField = dbf.fields.find((f) => /^ROAD_RANK$/i.test(f));
const toWgs = proj4(prjText, "EPSG:4326");

// Douglas-Peucker(미터 좌표에서, 허용 오차 tol m)
function simplify(pts, tol) {
  if (pts.length <= 2) return pts;
  const keep = new Array(pts.length).fill(false);
  keep[0] = keep[pts.length - 1] = true;
  const stack = [[0, pts.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop();
    let max = 0;
    let idx = -1;
    const [x1, y1] = pts[a];
    const [x2, y2] = pts[b];
    const dx = x2 - x1;
    const dy = y2 - y1;
    const L = Math.hypot(dx, dy) || 1;
    for (let i = a + 1; i < b; i++) {
      const d = Math.abs(dy * pts[i][0] - dx * pts[i][1] + x2 * y1 - y2 * x1) / L;
      if (d > max) [max, idx] = [d, i];
    }
    if (max > tol && idx > 0) {
      keep[idx] = true;
      stack.push([a, idx], [idx, b]);
    }
  }
  return pts.filter((_, i) => keep[i]);
}

function encode(coords) {
  let out = "";
  let plat = 0;
  let plng = 0;
  const enc = (v) => {
    let s = v < 0 ? ~(v << 1) : v << 1;
    let r = "";
    while (s >= 0x20) {
      r += String.fromCharCode((0x20 | (s & 0x1f)) + 63);
      s >>= 5;
    }
    return r + String.fromCharCode(s + 63);
  };
  for (const [lng, lat] of coords) {
    const la = Math.round(lat * 1e5);
    const ln = Math.round(lng * 1e5);
    out += enc(la - plat) + enc(ln - plng);
    plat = la;
    plng = ln;
  }
  return out;
}

const links = {};
let points = 0;
dbf.rows.forEach((row, i) => {
  const id = row[idField];
  if (!/^40[56]/.test(id)) return;
  const pts = simplify(shapes[i] ?? [], 3).map((p) => toWgs.forward(p));
  if (pts.length < 2) return;
  points += pts.length;
  links[id] = [nameField ? row[nameField] : "", rankField ? row[rankField] : "", encode(pts)];
});
const body = { version: basename(dir), source: "국가교통정보센터 표준노드링크(이용허락 제한 없음)", links };
writeFileSync(out, JSON.stringify(body));
console.log(`제주 구간 ${Object.keys(links).length}개, 점 ${points}개, ${(statSync(out).size / 1024).toFixed(0)}KB`);
