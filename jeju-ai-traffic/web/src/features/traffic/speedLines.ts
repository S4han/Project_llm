import type { TrafficLinksResponse, TrafficSpeedsResponse } from "../../../../shared/contracts/traffic";
import { decodePolyline } from "../../../../shared/rules/polyline";
import { speedStatus } from "../../../../shared/rules/traffic";
import type { SpeedLine } from "../map/leafletMap";

/** 구간 모양과 속도를 합친다. 속도가 없는 구간은 그리지 않는다(정보 없음을 '원활'로 칠하지 않음). */
export function joinSpeedLines(links: TrafficLinksResponse["links"], speeds: TrafficSpeedsResponse["speeds"]): SpeedLine[] {
  const out: SpeedLine[] = [];
  for (const [id, name, encoded] of links) {
    const s = speeds[id];
    if (!s) continue;
    out.push({ id, name, points: decodePolyline(encoded), kmh: s[0], travelSeconds: s[1], status: speedStatus(s[0]) });
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
