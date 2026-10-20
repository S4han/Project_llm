import type { SpeedStatus, TrafficLinksResponse, TrafficSpeedsResponse } from "../../../../shared/contracts/traffic";
import type { Coordinate } from "../../../../shared/contracts/route";
import { decodePolyline } from "../../../../shared/rules/polyline";
import { speedStatus } from "../../../../shared/rules/traffic";
import type { SpeedLine } from "../map/leafletMap";

/** 구간 모양과 속도를 합친다. 속도가 없는 구간은 그리지 않는다(정보 없음을 '원활'로 칠하지 않음). */
export function joinSpeedLines(links: TrafficLinksResponse["links"], speeds: TrafficSpeedsResponse["speeds"]): SpeedLine[] {
  const out: SpeedLine[] = [];
  for (const [id, name, encoded, from, to] of links) {
    const s = speeds[id];
    if (!s) continue;
    out.push({ id, name, points: decodePolyline(encoded), kmh: s[0], travelSeconds: s[1], status: speedStatus(s[0]), from: from ?? "", to: to ?? "" });
  }
  return out;
}

/** 도로명 하나에 속한 구간 묶음(도로 소통 목록용). */
export interface RoadGroup {
  /** 도로명. 없으면 빈 문자열. */
  key: string;
  label: string;
  count: number;
  /** 구간 평균속도의 단순 평균(반올림). */
  avgKmh: number;
  ids: string[];
}

/** 구간을 도로명으로 묶는다. 구간이 많은 순, 같으면 느린 순, 도로명 없음은 맨 아래(TASK-012 소통대시보드). */
export function groupByRoad(lines: SpeedLine[]): RoadGroup[] {
  const map = new Map<string, SpeedLine[]>();
  for (const l of lines) {
    const k = l.name.trim();
    const arr = map.get(k);
    if (arr) arr.push(l);
    else map.set(k, [l]);
  }
  return [...map.entries()]
    .map(([key, ls]) => ({
      key,
      label: key || "도로명 없음",
      count: ls.length,
      avgKmh: Math.round(ls.reduce((sum, l) => sum + l.kmh, 0) / ls.length),
      ids: ls.map((l) => l.id),
    }))
    .sort((a, b) => Number(a.key === "") - Number(b.key === "") || b.count - a.count || a.avgKmh - b.avgKmh);
}

/** 실시간 정체구간 목록의 한 줄: 같은 도로·같은 상태로 이어진 구간들(TASK-015). */
export interface CongestionRow {
  /** 첫 구간 ID. */
  key: string;
  label: string;
  status: Exclude<SpeedStatus, "smooth">;
  count: number;
  avgKmh: number;
  /** 첫 구간 시작 지점·마지막 구간 끝 지점 이름. 모르면 "". */
  from: string;
  to: string;
  ids: string[];
}

const pointKey = (p: Coordinate | undefined) => (p ? `${p.lat},${p.lng}` : "");

/**
 * 정체·서행 구간을 같은 도로명·같은 상태끼리 진행 방향으로 이어 한 줄로 묶는다.
 * 앞 구간의 끝 점과 뒤 구간의 시작 점이 같으면 이어진 것으로 본다(반대 방향 구간은 잇지 않음).
 * 정체 먼저, 그 안에서 느린 순(TASK-015 2. (a)).
 */
export function buildCongestionRows(lines: SpeedLine[]): CongestionRow[] {
  const groups = new Map<string, SpeedLine[]>();
  for (const l of lines) {
    if (l.status === "smooth") continue;
    const k = `${l.status}|${l.name.trim()}`;
    const arr = groups.get(k);
    if (arr) arr.push(l);
    else groups.set(k, [l]);
  }
  const rows: CongestionRow[] = [];
  for (const ls of groups.values()) {
    const byStart = new Map<string, SpeedLine[]>();
    for (const l of ls) {
      const k = pointKey(l.points[0]);
      const arr = byStart.get(k);
      if (arr) arr.push(l);
      else byStart.set(k, [l]);
    }
    const nextOf = (l: SpeedLine, used: Set<string>) =>
      (byStart.get(pointKey(l.points.at(-1))) ?? []).find((n) => !used.has(n.id) && n.id !== l.id && pointKey(n.points.at(-1)) !== pointKey(l.points[0]));
    // 앞 구간이 있는 구간은 줄의 시작이 아니다. 시작부터 잇고, 남은 것(고리 등)은 아무 데서나 시작한다.
    const hasPrev = new Set<string>();
    for (const l of ls) {
      const n = nextOf(l, new Set());
      if (n) hasPrev.add(n.id);
    }
    const used = new Set<string>();
    const starts = [...ls.filter((l) => !hasPrev.has(l.id)), ...ls];
    for (const start of starts) {
      if (used.has(start.id)) continue;
      const chain: SpeedLine[] = [];
      for (let cur: SpeedLine | undefined = start; cur; cur = nextOf(cur, used)) {
        used.add(cur.id);
        chain.push(cur);
      }
      const name = chain[0]!.name.trim();
      rows.push({
        key: chain[0]!.id,
        label: name || "도로명 없음",
        status: chain[0]!.status as CongestionRow["status"],
        count: chain.length,
        avgKmh: Math.round(chain.reduce((sum, l) => sum + l.kmh, 0) / chain.length),
        from: chain[0]!.from ?? "",
        to: chain.at(-1)!.to ?? "",
        ids: chain.map((l) => l.id),
      });
    }
  }
  return rows.sort((a, b) => Number(a.status === "slow") - Number(b.status === "slow") || a.avgKmh - b.avgKmh || b.count - a.count || a.key.localeCompare(b.key));
}

/** "A → B". 양 끝 이름을 모르거나 같으면 구간 수로 대신한다. */
export function sectionText(row: Pick<CongestionRow, "from" | "to" | "count">): string {
  if (row.from && row.to && row.from !== row.to) return `${row.from} → ${row.to}`;
  if (row.from || row.to) return `${row.from || row.to} 부근 · ${row.count}구간`;
  return `${row.count}구간`;
}
