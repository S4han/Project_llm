import type { SearchCategory, SearchRow } from "../contracts/search.js";
import { distanceMeters } from "./geo.js";

/** 같은 장소로 볼 거리(m, TASK-029 3.(a)). */
export const SAME_SPOT_METERS = 100;

/** 이름 비교용: 괄호 안 설명·띄어쓰기·문장부호를 지우고 소문자로. */
export function normalizePlaceName(name: string): string {
  return name
    .normalize("NFKC")
    .toLowerCase()
    .replace(/\([^)]*\)|\[[^\]]*\]|<[^>]*>/g, "")
    .replace(/[\s·.,\-_'"‘’“”!?&/~:]+/g, "");
}

/** 음식점과 카페는 출처마다 나누는 기준이 달라 같은 묶음으로 비교한다. */
const group = (c: SearchCategory) => (c === "CAFE" ? "RESTAURANT" : c);

/**
 * 출처별 목록을 앞의 것부터 우선해 합친다. 이름(정리 후)이 같고 같은 묶음이며 100m 안인 곳이 **하나뿐**일 때만 한 장소로 합친다.
 * 후보가 둘 이상이면(애매) 따로 둔다(참고 PRD: 확실한 경우만 병합). 합친 곳은 출처를 모두 남기고 빈 값만 뒤 출처로 채운다.
 */
export function mergePlaces(lists: SearchRow[][]): SearchRow[] {
  const out: SearchRow[] = [];
  const byName = new Map<string, SearchRow[]>();
  const seen = new Set<string>();
  for (const list of lists) {
    for (const row of list) {
      const refKey = row[10].map((r) => r.join(":")).join("|");
      if (seen.has(refKey)) continue;
      seen.add(refKey);
      const key = normalizePlaceName(row[2]);
      const same = key ? (byName.get(key) ?? []) : [];
      const near = same.filter((p) => group(p[1]) === group(row[1]) && distanceMeters({ lat: p[4], lng: p[5] }, { lat: row[4], lng: row[5] }) <= SAME_SPOT_METERS);
      const target = near.length === 1 ? near[0] : undefined;
      if (target && !target[10].some(([s]) => row[10].some(([t]) => t === s))) {
        if (target[1] === "RESTAURANT" && row[1] === "CAFE") target[1] = "CAFE";
        for (const i of [3, 6, 7, 8, 9] as const) if (!target[i]) target[i] = row[i];
        target[10] = [...target[10], ...row[10]];
        continue;
      }
      const copy: SearchRow = [...row];
      out.push(copy);
      if (key) byName.set(key, [...same, copy]);
    }
  }
  return out;
}
