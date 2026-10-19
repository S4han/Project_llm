import type { Place } from "../../../shared/contracts/place.js";
import type { PlaceProvider } from "./types.js";

/** 합성 모의 장소(공공 장소, 좌표는 근사값). 실제 공급자 응답이 아니다. */
export const MOCK_PLACES: Place[] = [
  {
    id: "mock-airport",
    name: "제주국제공항",
    address: "제주특별자치도 제주시 용담이동 2002",
    roadAddress: "제주특별자치도 제주시 공항로 2",
    location: { lat: 33.5066, lng: 126.4929 },
  },
  {
    id: "mock-seogwipo-hall",
    name: "서귀포시청 제1청사",
    address: "제주특별자치도 서귀포시 서귀동 314-1",
    roadAddress: "제주특별자치도 서귀포시 중앙로 105",
    location: { lat: 33.2541, lng: 126.5601 },
  },
  {
    id: "mock-seongsan",
    name: "성산일출봉",
    address: "제주특별자치도 서귀포시 성산읍 성산리 1",
    roadAddress: null,
    location: { lat: 33.4581, lng: 126.9425 },
  },
  {
    id: "mock-seongpanak",
    name: "한라산 성판악 탐방안내소",
    address: "제주특별자치도 제주시 조천읍 교래리 산137-24",
    roadAddress: "제주특별자치도 제주시 조천읍 516로 1865",
    location: { lat: 33.385, lng: 126.6196 },
  },
  {
    id: "mock-jungmun",
    name: "중문관광단지",
    address: "제주특별자치도 서귀포시 색달동 2864-1",
    roadAddress: null,
    location: { lat: 33.2506, lng: 126.4124 },
  },
  {
    id: "mock-dongmun",
    name: "동문재래시장",
    address: "제주특별자치도 제주시 일도일동 1436-7",
    roadAddress: "제주특별자치도 제주시 관덕로14길 20",
    location: { lat: 33.5122, lng: 126.5268 },
  },
].map((p) => ({ ...p, provider: "mock" as const }));

function normalize(s: string): string {
  return s.replace(/\s+/g, "").toLowerCase();
}

/** 이름·주소에 검색어가 들어간 모의 장소를 돌려준다. 외부 호출 없음. */
export function createMockPlaceProvider(places: Place[] = MOCK_PLACES): PlaceProvider & { calls: number } {
  return {
    id: "kakaoLocal",
    calls: 0,
    async search(query: string): Promise<Place[]> {
      this.calls += 1;
      const q = normalize(query);
      return places.filter((p) => normalize(`${p.name}${p.address}${p.roadAddress ?? ""}`).includes(q));
    },
  };
}
