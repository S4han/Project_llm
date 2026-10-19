import type { Place } from "../../../shared/contracts/place.js";
import { isInJeju, isJejuAddress, JEJU_BOUNDS } from "../../../shared/rules/geo.js";
import { ProviderError } from "../errors.js";
import type { PlaceProvider } from "./types.js";

const ENDPOINT = "https://dapi.kakao.com/v2/local/search/keyword.json";
const TIMEOUT_MS = 5000;

interface KakaoKeywordDocument {
  id?: unknown;
  place_name?: unknown;
  address_name?: unknown;
  road_address_name?: unknown;
  x?: unknown;
  y?: unknown;
}

function str(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

/** 카카오 로컬 키워드 검색 응답 → Place[]. 좌표가 무효하거나 제주 밖이거나 주소가 제주가 아니면 버린다. */
export function normalizeKakaoKeyword(body: unknown): Place[] {
  const documents = (body as { documents?: unknown } | null)?.documents;
  if (!Array.isArray(documents)) throw new ProviderError("unavailable", "kakaoLocal: documents 없음");

  const places: Place[] = [];
  for (const doc of documents as KakaoKeywordDocument[]) {
    const location = { lat: Number.parseFloat(str(doc.y)), lng: Number.parseFloat(str(doc.x)) };
    const address = str(doc.address_name);
    const id = str(doc.id);
    const name = str(doc.place_name);
    if (!id || !name || !isInJeju(location) || !isJejuAddress(address)) continue;
    places.push({
      id,
      name,
      address,
      roadAddress: str(doc.road_address_name) || null,
      location,
      provider: "kakaoLocal",
    });
  }
  return places;
}

/** 카카오 로컬 키워드 검색 어댑터. 키는 서버 환경 변수로만 받고 출력하지 않는다. */
export function createKakaoLocalProvider(apiKey: string, fetchImpl: typeof fetch = fetch): PlaceProvider {
  const rect = [JEJU_BOUNDS.minLng, JEJU_BOUNDS.minLat, JEJU_BOUNDS.maxLng, JEJU_BOUNDS.maxLat].join(",");
  return {
    id: "kakaoLocal",
    async search(query: string): Promise<Place[]> {
      const url = new URL(ENDPOINT);
      url.searchParams.set("query", query);
      url.searchParams.set("rect", rect);
      url.searchParams.set("size", "15");
      const res = await fetchImpl(url, {
        headers: { Authorization: `KakaoAK ${apiKey}` },
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      if (res.status === 429) throw new ProviderError("rate_limited", "kakaoLocal 429");
      if (!res.ok) throw new ProviderError("unavailable", `kakaoLocal ${res.status}`);
      return normalizeKakaoKeyword(await res.json());
    },
  };
}
