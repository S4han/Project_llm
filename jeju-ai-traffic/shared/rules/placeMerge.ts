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
        target[11] = target[11] || row[11];
        if (!target[12]) target[12] = row[12];
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

/**
 * 반려동물 동반 장소(TASK-030 1.(a))를 검색 목록에 붙인다. 같은 관광공사 번호가 있으면 그 장소에,
 * 없으면 이름(정리 후)이 같고 같은 묶음·100m 안 후보가 하나뿐인 장소에 출처(ktoPet)를 더하고 반려동물을 "YES"로.
 * 맞는 곳이 없으면 새 장소로 더한다. places는 그 자리에서 바꾼다(mergePlaces가 만든 사본).
 */
export function attachPetPlaces(places: SearchRow[], pets: SearchRow[]): SearchRow[] {
  for (const pet of pets) {
    const id = pet[10][0]?.[1] ?? "";
    let target = places.find((p) => p[10].some(([s, v]) => s === "kto" && v === id));
    if (!target) {
      const key = normalizePlaceName(pet[2]);
      const near = key ? places.filter((p) => normalizePlaceName(p[2]) === key && group(p[1]) === group(pet[1]) && distanceMeters({ lat: p[4], lng: p[5] }, { lat: pet[4], lng: pet[5] }) <= SAME_SPOT_METERS) : [];
      target = near.length === 1 ? near[0] : undefined;
    }
    if (!target) {
      places.push([...pet]);
      continue;
    }
    if (target[10].some(([s]) => s === "ktoPet")) continue;
    target[10] = [...target[10], ...pet[10]];
    target[12] = "YES";
    for (const i of [3, 6, 7] as const) if (!target[i]) target[i] = pet[i];
  }
  return places;
}
