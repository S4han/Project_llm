import type { Coordinate } from "../contracts/route.js";
import type { SearchCategory, SearchRow } from "../contracts/search.js";
import { SEARCH_NEAR_RADIUS } from "../contracts/search.js";
import { distanceMeters } from "./geo.js";
import { normalizePlaceName } from "./placeMerge.js";

export interface SearchQuery {
  q: string;
  cat: SearchCategory | "ALL";
  /** 있으면 거리를 계산한다. 검색어가 없으면 이 반경 안만, 가까운 순. */
  origin?: Coordinate | null;
  /** true면 검색어와 맞지 않는 곳도 맨 뒤에 남긴다(카카오가 이미 검색어로 찾아 준 결과). */
  keepUnmatched?: boolean;
}

export interface SearchHit {
  place: SearchRow;
  /** 기준 위치에서의 직선 거리(m). 기준 위치가 없으면 null. */
  meters: number | null;
}

/** 이름이 검색어와 같으면 0, 검색어로 시작하면 1, 들어 있으면 2, 주소·특징에만 있으면 3, 없으면 -1. */
export function matchScore(place: SearchRow, q: string): number {
  const nq = normalizePlaceName(q);
  if (!nq) return -1;
  const name = normalizePlaceName(place[2]);
  if (name === nq) return 0;
  if (name.startsWith(nq)) return 1;
  if (name.includes(nq)) return 2;
  const words = q.trim().split(/\s+/).filter(Boolean);
  const hay = `${place[3]} ${place[9]}`;
  return words.length && words.every((w) => hay.includes(w)) ? 3 : -1;
}

/**
 * 검색(TASK-029): 카테고리로 거르고, 검색어가 있으면 이름·주소·특징에서 찾아 잘 맞는 순(같으면 가까운 순·이름순),
 * 검색어 없이 기준 위치만 있으면 반경 3km 안을 가까운 순. 둘 다 없으면 빈 목록.
 */
export function searchPlaces(places: SearchRow[], { q, cat, origin = null, keepUnmatched = false }: SearchQuery): SearchHit[] {
  const query = q.trim();
  if (!query && !origin) return [];
  const hits: (SearchHit & { score: number })[] = [];
  for (const place of places) {
    if (cat !== "ALL" && place[1] !== cat) continue;
    const raw = query ? matchScore(place, query) : 0;
    const score = raw < 0 && keepUnmatched ? 4 : raw;
    if (score < 0) continue;
    const meters = origin ? distanceMeters(origin, { lat: place[4], lng: place[5] }) : null;
    if (!query && meters !== null && meters > SEARCH_NEAR_RADIUS) continue;
    hits.push({ place, meters, score });
  }
  hits.sort((a, b) => a.score - b.score || (a.meters ?? 0) - (b.meters ?? 0) || a.place[2].localeCompare(b.place[2], "ko"));
  return hits.map(({ place, meters }) => ({ place, meters }));
}
