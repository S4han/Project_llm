import type { Coordinate } from "../../../../shared/contracts/route";
import { SEARCH_CATEGORIES, SEARCH_CATEGORY_LABEL, SEARCH_SOURCE_LABEL, type SearchCategory, type SearchDetailResponse, type SearchIndexResponse, type SearchPetResponse, type SearchRow } from "../../../../shared/contracts/search";
import type { TrafficParkingResponse } from "../../../../shared/contracts/traffic";
import { distanceMeters } from "../../../../shared/rules/geo";
import { PARKING_FEE_STYLE, parkingFeeKind, tourParking } from "../traffic/facilityStyle";
import type { PopupCard } from "../map/leafletMap";
import { formatKstTime } from "../trip/format";
import { parkingRouteHref } from "../trip/routeLink";

export type Cat = SearchCategory | "ALL";
export const CHIPS: Cat[] = ["ALL", ...SEARCH_CATEGORIES];
export const chipLabel = (c: Cat) => (c === "ALL" ? "전체" : SEARCH_CATEGORY_LABEL[c]);
/** 카테고리 표시 글자·색(지도 점과 목록). */
export const CATEGORY_STYLE: Record<SearchCategory, { mark: string; color: string }> = {
  ATTRACTION: { mark: "관", color: "#4f46e5" },
  ACCOMMODATION: { mark: "숙", color: "#c026d3" },
  RESTAURANT: { mark: "식", color: "#ea580c" },
  CAFE: { mark: "카", color: "#92400e" },
};
/** 한 번에 보이는 결과 수. "더 보기"로 늘린다. */
export const PAGE = 30;
/**
 * 위치를 쓸 수 없을 때 고르는 지역(참고 PRD: 현재 위치 거부 시 수동 지역 입력). 지역 가운데 대략의 좌표.
 */
export const AREAS: { name: string; at: Coordinate }[] = [
  { name: "제주시내", at: { lat: 33.4996, lng: 126.5312 } },
  { name: "애월", at: { lat: 33.4636, lng: 126.331 } },
  { name: "한림·협재", at: { lat: 33.394, lng: 126.2395 } },
  { name: "함덕·조천", at: { lat: 33.5432, lng: 126.669 } },
  { name: "성산", at: { lat: 33.458, lng: 126.93 } },
  { name: "표선", at: { lat: 33.326, lng: 126.833 } },
  { name: "서귀포시내", at: { lat: 33.253, lng: 126.56 } },
  { name: "중문", at: { lat: 33.248, lng: 126.412 } },
  { name: "대정·모슬포", at: { lat: 33.219, lng: 126.251 } },
];
export const SUGGESTIONS = ["성산일출봉", "흑돼지", "오션뷰", "올레"];

export type Origin = { kind: "me" | "area"; name: string; at: Coordinate };
export const distText = (m: number) => (m < 1000 ? `${Math.round(m / 10) * 10}m` : `${(m / 1000).toFixed(1)}km`);
export const feedLabel = (f: SearchIndexResponse["missing"][number]) => (f.category ? `${SEARCH_SOURCE_LABEL[f.source]} ${SEARCH_CATEGORY_LABEL[f.category]}` : `${SEARCH_SOURCE_LABEL[f.source]} 목록`);

/** 출처 사이트 링크(새 창). 한국관광공사는 공개 상세 주소에 쓸 번호가 목록에 없어 링크 없이 이름만 보인다. */
export function sourceLinks(row: SearchRow): { href: string; label: string }[] {
  return row[10].flatMap(([source, id]) =>
    source === "visitJeju"
      ? [{ href: `https://www.visitjeju.net/kr/detail/view?contentsid=${encodeURIComponent(id)}`, label: "비짓제주에서 자세히 보기 ↗" }]
      : source === "kakaoLocal"
        ? [{ href: `https://place.map.kakao.com/${encodeURIComponent(id)}`, label: "카카오맵에서 보기 ↗" }]
        : [],
  );
}

export const sourceNames = (row: SearchRow) => row[10].map(([s]) => SEARCH_SOURCE_LABEL[s]).join("·");
const photoCredit = (src: string) => (src.includes("visitjeju.net") ? "사진 비짓제주" : src.includes("visitkorea.or.kr") ? "사진 한국관광공사" : "사진");

/**
 * 장소 상세 카드(TASK-029 1.(a)): 받은 정보만 보이고 없는 값은 "정보 없음"(참고 PRD FR-007). 출처와 기준 시각을 함께.
 * 버튼은 이 서비스의 경로 안내, 아래 링크는 출처 사이트와 카카오맵 길찾기(새 창).
 */
/** 관광공사 소개정보 상태: 받기 전(관광공사 자료 없음이면 null), 받는 중, 실패, 받은 값. */
export type DetailState = SearchDetailResponse | "loading" | "failed" | null;
type Tile = NonNullable<PopupCard["tiles"]>[number];
const HOURS_LABEL: Record<SearchCategory, string> = { ATTRACTION: "이용시간", ACCOMMODATION: "입실·퇴실", RESTAURANT: "영업시간", CAFE: "영업시간" };
/** 큰 칸에는 첫 줄만. 관광공사 원문은 줄마다 "- "가 붙어 있어(시험: "- 08:30~21:00") 떼어 낸다. */
export const short = (v: string, n = 26) => {
  const line = (v.split("\n")[0] ?? "").replace(/^[-·•*]\s*/, "");
  return line.length > n ? `${line.slice(0, n - 1)}…` : line;
};

/** 전국주차장정보표준데이터 주차장(TASK-017). 받는 중·실패도 함께. */
export type ParkingLots = TrafficParkingResponse["lots"] | "loading" | "failed";
/** 주차 정보가 없을 때 찾는 반경(m, 사용자 요청 2026-10-23 "반경 1키로"). */
export const NEAR_PARKING_RADIUS = 1000;

/** 장소 기준 반경 1km 주차장을 가까운 순으로. */
export function parkingNear(lat: number, lng: number, lots: TrafficParkingResponse["lots"]): { lot: TrafficParkingResponse["lots"][number]; meters: number }[] {
  return lots
    .map((lot) => ({ lot, meters: distanceMeters({ lat, lng }, { lat: lot[8], lng: lot[9] }) }))
    .filter((p) => p.meters <= NEAR_PARKING_RADIUS)
    .sort((a, b) => a.meters - b.meters);
}

/** 관광공사 반려동물 동반여행 상세 상태(TASK-030): 등록되지 않은 곳이면 null. */
export type PetState = SearchPetResponse | "loading" | "failed" | null;
/** 관광공사 반려동물 동반여행에 등록된 곳이면 그 번호. */
export const petId = (row: SearchRow) => row[10].find(([s]) => s === "ktoPet")?.[1] ?? null;

/** 관광공사 자료가 있으면 그 번호(합친 곳 포함). 소개정보(운영시간·주차·반려동물)는 이 번호로 받는다. */
export const ktoId = (row: SearchRow) => row[10].find(([s]) => s === "kto")?.[1] ?? null;

/** 반려동물 원문(관광공사 chkpet)을 가능·불가로. 애매하면 원문 그대로 보통 색. */
export function petFromText(v: string): Tile["tone"] {
  const t = v.replace(/\s+/g, "");
  if (/불가|안됨|금지|없음/.test(t)) return "bad";
  if (/가능|동반/.test(t)) return "good";
  return "neutral";
}

/**
 * 장소 상세 카드(TASK-029 1.(a)): 받은 정보만 보이고 없는 값은 "정보 없음"(참고 PRD FR-006). 출처와 기준 시각을 함께.
 * 범위 변경(2026-10-23): 큰 칸에 운영시간·주차·반려동물. 관광공사 자료가 있으면 소개정보로, 없으면 비짓제주 태그로, 그것도 없으면 "정보 없음".
 * 버튼은 이 서비스의 경로 안내, 아래 링크는 출처 사이트와 카카오맵 길찾기(새 창).
 */
export function placeCard(row: SearchRow, meters: number | null, at: { listBuiltAt: string | null; liveAt: string | null }, originName: string | null, detail: DetailState = null, lots: ParkingLots = "failed", petInfo: PetState = null): PopupCard {
  const [id, cat, name, address, lat, lng, phone, photo, intro, tags, refs, parkingTag, petTagValue] = row;
  const st = CATEGORY_STYLE[cat];
  const live = refs.some(([s]) => s === "kakaoLocal");
  const listed = refs.some(([s]) => s !== "kakaoLocal");
  const d = typeof detail === "object" && detail !== null ? detail : null;
  const waiting = detail === "loading" ? "확인 중…" : detail === "failed" ? "–" : null;
  const times = [listed && at.listBuiltAt ? `목록 ${formatKstTime(at.listBuiltAt)}` : "", live && at.liveAt ? `카카오 ${formatKstTime(at.liveAt)}` : "", d ? `관광공사 상세 ${formatKstTime(d.builtAt)}` : ""].filter(Boolean).join(" · ");
  const directions = `https://map.kakao.com/link/to/${encodeURIComponent(name.replaceAll(",", " "))},${lat.toFixed(6)},${lng.toFixed(6)}`;

  const hours: Tile = d?.hours
    ? { label: HOURS_LABEL[cat], value: short(d.hours), sub: d.rest ? `쉬는날 ${short(d.rest, 18)}` : "한국관광공사", tone: "neutral" }
    : { label: HOURS_LABEL[cat], value: waiting ?? "정보 없음", sub: waiting ? undefined : detail === null ? "출처 상세에서 확인" : "한국관광공사", tone: "neutral" };
  const parkKind = d?.parking ? tourParking(d.parking) : "UNKNOWN";
  // 주차 정보가 없으면(관광공사·비짓제주 모두) 반경 1km 주차장을 찾아 수와 유료·무료를 보인다(사용자 요청 2026-10-23).
  const noParkingInfo = parkKind === "UNKNOWN" && !parkingTag && !d?.parking && detail !== "loading";
  const near = noParkingInfo && Array.isArray(lots) ? parkingNear(lat, lng, lots) : null;
  const feeCount = (k: ReturnType<typeof parkingFeeKind>) => (near ?? []).filter((p) => parkingFeeKind(p.lot[7]) === k).length;
  const feeSub = near?.length ? [`무료 ${feeCount("FREE")}`, `유료 ${feeCount("PAID")}`, ...(feeCount("MIXED") ? [`일부유료 ${feeCount("MIXED")}`] : [])].join(" · ") : "";
  const parking: Tile =
    parkKind !== "UNKNOWN"
      ? { label: "주차", value: parkKind === "YES" ? "가능" : "불가", sub: "한국관광공사", tone: parkKind === "YES" ? "good" : "bad" }
      : parkingTag
        ? { label: "주차", value: "주차장 있음", sub: "비짓제주 태그", tone: "good" }
        : d?.parking
          ? { label: "주차", value: short(d.parking, 14), sub: "한국관광공사", tone: "neutral" }
          : near
            ? { label: "주변 주차장 1km", value: near.length ? `${near.length.toLocaleString("ko-KR")}곳` : "없음", sub: near.length ? feeSub : "반경 1km 안", tone: near.length ? "good" : "neutral" }
            : { label: "주차", value: waiting ?? (noParkingInfo && lots === "loading" ? "확인 중…" : "정보 없음"), tone: "neutral" };
  const nearRows = near?.length
    ? [{ label: "가까운 주차장", lines: near.slice(0, 3).map(({ lot, meters: m }) => `${lot[1] || "이름 없는 주차장"} · ${distText(m)} · ${PARKING_FEE_STYLE[parkingFeeKind(lot[7])].label || "요금 정보 없음"}`) }]
    : [];
  // 관광공사 반려동물 동반여행(TASK-030 2.(a))이 있으면 그것이 먼저.
  const p = typeof petInfo === "object" && petInfo !== null && petInfo.type ? petInfo : null;
  const pet: Tile = p
    ? { label: "반려동물", value: short(p.type, 14), sub: "관광공사 반려동물", tone: petFromText(p.type) }
    : petInfo === "loading"
      ? { label: "반려동물", value: "확인 중…", tone: "neutral" }
      : petId(row)
        ? { label: "반려동물", value: "동반 가능", sub: "관광공사 반려동물", tone: "good" }
        : d?.pet
    ? { label: "반려동물", value: petFromText(d.pet) === "good" ? "동반 가능" : petFromText(d.pet) === "bad" ? "동반 불가" : short(d.pet, 14), sub: "한국관광공사", tone: petFromText(d.pet) }
    : petTagValue
      ? { label: "반려동물", value: petTagValue === "YES" ? "동반 가능" : "동반 불가", sub: "비짓제주 태그", tone: petTagValue === "YES" ? "good" : "bad" }
      : { label: "반려동물", value: waiting && cat === "ATTRACTION" ? waiting : "정보 없음", tone: "neutral" };
  const lines = (v: string) => v.split("\n");
  return {
    size: "lg",
    badge: { text: st.mark, color: st.color },
    kicker: `${SEARCH_CATEGORY_LABEL[cat]} · ${sourceNames(row)}`,
    title: name,
    image: photo ? { src: photo, alt: name, credit: photoCredit(photo) } : undefined,
    tiles: [hours, parking, pet, meters !== null ? { label: `${originName ?? "기준"}에서`, value: distText(meters), sub: "직선 거리", tone: "neutral" } : { label: "전화", value: phone || "정보 없음", tone: phone ? "good" : "neutral" }],
    chips: [],
    rows: [
      { label: "소개", lines: [intro || "정보 없음"] },
      ...(d?.hours ? [{ label: HOURS_LABEL[cat], lines: lines(d.hours) }] : []),
      ...(d?.rest ? [{ label: "쉬는날", lines: lines(d.rest) }] : []),
      ...(d?.parking ? [{ label: "주차 안내", lines: lines(d.parking) }] : []),
      ...nearRows,
      ...(d?.pet && !p ? [{ label: "반려동물", lines: lines(d.pet) }] : []),
      ...(p
        ? [
            { label: "동반 유형", lines: lines(p.type) },
            ...(p.animals ? [{ label: "동반 가능 동물", lines: lines(p.animals) }] : []),
            ...(p.need ? [{ label: "필요한 것", lines: lines(p.need) }] : []),
            ...(p.facilities ? [{ label: "구비 시설", lines: lines(p.facilities) }] : []),
            ...(p.furnish ? [{ label: "비치 물품", lines: lines(p.furnish) }] : []),
            ...(p.rental ? [{ label: "대여 물품", lines: lines(p.rental) }] : []),
            ...(p.purchase ? [{ label: "구매 물품", lines: lines(p.purchase) }] : []),
            ...(p.risk ? [{ label: "사고 대비", lines: lines(p.risk) }] : []),
            ...(p.etc ? [{ label: "반려동물 안내", lines: lines(p.etc) }] : []),
          ]
        : []),
      { label: "전화", lines: [phone || "정보 없음"] },
      ...(d?.info ? [{ label: "문의", lines: lines(d.info) }] : []),
      { label: "주소", lines: [address || "정보 없음"] },
      { label: "특징", lines: [tags ? tags.split(",").join(", ") : "정보 없음"] },
    ],
    footer: [
      `출처 ${sourceNames(row)}${times ? ` · ${times} 기준` : ""} · 바뀌었을 수 있으니 방문 전 확인하세요. 예약·요금 정보는 없습니다.`,
      near ? "주변 주차장은 전국주차장정보표준데이터(직선 거리 1km, 실시간 남은 칸 없음)입니다." : "",
      detail === null ? "운영시간은 한국관광공사 자료가 있는 곳만 나옵니다. 아래 링크의 상세에서 확인하세요." : "",
      petInfo === "failed" ? "반려동물 동반 정보를 불러오지 못했습니다. 다시 눌러 보세요." : "",
      detail === "failed" ? "운영시간·주차 정보를 불러오지 못했습니다. 다시 눌러 보세요." : "",
    ]
      .filter(Boolean)
      .join("\n"),
    action: { href: parkingRouteHref({ id, name, address, lat, lng }), label: "현재 위치에서 경로 안내" },
    links: [...sourceLinks(row), { href: directions, label: "카카오맵 길찾기 ↗" }],
  };
}
