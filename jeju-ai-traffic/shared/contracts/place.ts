import type { IsoDateTime } from "./common.js";
import type { Coordinate } from "./route.js";

/** 장소 검색 결과 하나. provider가 mock이면 화면에 모의 데이터임을 표시한다. */
export interface Place {
  id: string;
  name: string;
  /** 지번 주소. */
  address: string;
  /** 도로명 주소. 공급자가 주지 않으면 null. */
  roadAddress: string | null;
  location: Coordinate;
  provider: "kakaoLocal" | "mock";
}

export interface PlaceSearchResponse {
  query: string;
  places: Place[];
  observedAt: IsoDateTime;
}

/** 검색어 길이 제한(앞뒤 공백 제거 후). */
export const PLACE_QUERY_MAX_LENGTH = 50;
