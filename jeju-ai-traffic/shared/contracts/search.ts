import type { IsoDateTime } from "./common.js";

/** 관광 통합 검색 카테고리(TASK-029, 참고 PRD 4.3). */
export type SearchCategory = "ATTRACTION" | "ACCOMMODATION" | "RESTAURANT" | "CAFE";
export const SEARCH_CATEGORIES: SearchCategory[] = ["ATTRACTION", "ACCOMMODATION", "RESTAURANT", "CAFE"];
export const SEARCH_CATEGORY_LABEL: Record<SearchCategory, string> = { ATTRACTION: "관광지", ACCOMMODATION: "숙박", RESTAURANT: "음식점", CAFE: "카페" };

/** 출처: 비짓제주(제주관광공사)·한국관광공사·카카오 로컬. */
export type SearchSource = "visitJeju" | "kto" | "kakaoLocal";
export const SEARCH_SOURCE_LABEL: Record<SearchSource, string> = { visitJeju: "비짓제주", kto: "한국관광공사", kakaoLocal: "카카오" };

/** 출처 하나의 원천 번호. 같은 장소로 합친 곳은 여러 개(참고 PRD sourceRefs). */
export type SearchSourceRef = [SearchSource, string];

/** 반려동물 동반(범위 변경 2026-10-23): 태그로 가능·불가를 알 때만, 모르면 "". */
export type PetTag = "YES" | "NO" | "";

/**
 * 장소 한 곳(참고 PRD 5절 Place 축약). 없는 값은 ""(화면은 "정보 없음").
 * [ID, 카테고리, 이름, 주소, 위도, 경도, 전화, 사진 https 주소, 간단 소개, 특징 태그(쉼표), 출처들(첫 번째가 대표),
 *  주차장 태그 있음(비짓제주), 반려동물 태그(비짓제주)].
 */
export type SearchRow = [string, SearchCategory, string, string, number, number, string, string, string, string, SearchSourceRef[], boolean, PetTag];

/** 하루 한 번 서버가 모으는 출처의 묶음 하나(예: 비짓제주 음식점). */
export interface SearchFeed {
  source: Exclude<SearchSource, "kakaoLocal">;
  category: Exclude<SearchCategory, "CAFE">;
}

/** GET /api/traffic/search 응답: 비짓제주·한국관광공사 장소를 합친 목록. missing은 이번에 못 받은 묶음(부분 결과). */
export interface SearchIndexResponse {
  places: SearchRow[];
  missing: SearchFeed[];
  builtAt: IsoDateTime;
  mock: boolean;
}

/** GET /api/traffic/search?q=…|lat=&lng= 응답: 카카오 로컬 실시간 음식점·카페(저장하지 않음, TASK-029 2.(a)). */
export interface SearchLiveResponse {
  places: SearchRow[];
  observedAt: IsoDateTime;
  mock: boolean;
}

/**
 * GET /api/traffic/search?kto=콘텐츠 ID&cat=카테고리 응답(범위 변경 2026-10-23): 한국관광공사 소개정보(detailIntro2).
 * 원천 글자에서 HTML을 걷어 낸 값(없으면 ""). hours는 관광지 이용시간·숙박 입실/퇴실·음식점 영업시간.
 */
export interface SearchDetailResponse {
  id: string;
  hours: string;
  /** 쉬는날 */
  rest: string;
  /** 주차 안내 원문 */
  parking: string;
  /** 반려동물 동반 원문(관광지 chkpet). 없으면 "". */
  pet: string;
  /** 문의 및 안내 */
  info: string;
  builtAt: IsoDateTime;
  source: "kto" | "mock";
}

export const SEARCH_QUERY_MAX_LENGTH = 40;
/** "내 주변" 반경(m). */
export const SEARCH_NEAR_RADIUS = 3000;
