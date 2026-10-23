import { describe, expect, it } from "vitest";
import type { SearchRow } from "../../shared/contracts/search";
import type { TrafficParkingResponse } from "../../shared/contracts/traffic";
import { parkingNear, petFromText, placeCard, placesAround, short, travelTile } from "../../web/src/features/search/searchCards";

const ROW: SearchRow = ["kto:2755053", "RESTAURANT", "가람돌솥밥", "제주특별자치도 서귀포시 중문관광로 332", 33.2497, 126.4313, "", "", "", "", [["kto", "2755053"]], false, ""];
const BUILT = "2026-10-22T23:00:00.000Z";
const vjRow = (id: string, cat: SearchRow[1], name: string, lat: number, lng: number): SearchRow => [`visitJeju:${id}`, cat, name, "", lat, lng, "", "", "", "", [["visitJeju", id]], false, ""];

describe("관광 검색 상세 카드 (TASK-029 범위 변경·TASK-031)", () => {
  it("큰 칸 글자: 첫 줄만, 앞의 '- ' 떼기, 길면 줄임", () => {
    expect(short("- 08:30~21:00\n- 준비시간 16:00~17:00")).toBe("08:30~21:00");
    expect(short("가".repeat(30), 10)).toBe(`${"가".repeat(9)}…`);
  });

  it("반려동물 원문: 불가·가능·애매", () => {
    expect(petFromText("불가")).toBe("bad");
    expect(petFromText("가능 (소형견)")).toBe("good");
    expect(petFromText("문의")).toBe("neutral");
  });

  it("관광공사 상세가 오면 영업시간·쉬는날·주차, 불가능은 불가로", () => {
    const card = placeCard(ROW, { listBuiltAt: BUILT, detail: { id: "2755053", hours: "- 08:30~21:00\n- 마지막 주문 20:00", rest: "연중무휴", parking: "불가능", pet: "", info: "0507-1432-1200", builtAt: BUILT, source: "kto" } });
    expect(card.tiles?.map((t) => [t.label, t.value])).toEqual([
      ["영업시간", "08:30~21:00"],
      ["주차", "불가"],
      ["반려동물", "정보 없음"],
      ["전화", "정보 없음"],
    ]);
    expect(card.tiles?.[0]?.sub).toBe("쉬는날 연중무휴");
    expect(card.rows.find((r) => r.label === "문의")?.lines).toEqual(["0507-1432-1200"]);
  });

  it("받는 중·실패·관광공사 자료 없음, 맛집 카드는 관광지에서 거리", () => {
    expect(placeCard(ROW, { listBuiltAt: BUILT, detail: "loading" }).tiles?.[0]?.value).toBe("확인 중…");
    expect(placeCard(ROW, { listBuiltAt: BUILT, detail: "failed" }).footer).toContain("불러오지 못했습니다");
    const vj: SearchRow = ["visitJeju:X", "CAFE", "숲카페", "", 33.5, 126.5, "", "", "", "", [["visitJeju", "X"]], true, "YES"];
    const card = placeCard(vj, { listBuiltAt: BUILT, from: { name: "사라봉", meters: 120 } });
    expect(card.tiles?.map((t) => t.value)).toEqual(["정보 없음", "주차장 있음", "동반 가능", "120m"]);
    expect(card.tiles?.[3]?.label).toBe("사라봉에서");
    expect(card.footer).toContain("운영시간은 한국관광공사 자료가 있는 곳만 나옵니다");
  });

  it("주차 정보가 없으면 반경 1km 주차장 수와 유료·무료, 가까운 3곳", () => {
    const lots: TrafficParkingResponse["lots"] = [
      ["P1", "가까운 공영", "공영", "노외", "", 50, "", "유료 · 30분 1,000원", 33.5005, 126.5],
      ["P2", "무료 주차장", "공영", "노외", "", 10, "", "무료", 33.503, 126.5],
      ["P3", "일부 유료", "민영", "부설", "", 5, "", "혼합", 33.5, 126.506],
      ["P4", "먼 주차장", "공영", "노외", "", 5, "", "무료", 33.52, 126.5],
    ];
    expect(parkingNear(33.5, 126.5, lots).map((p) => p.lot[0])).toEqual(["P1", "P2", "P3"]);
    const plain = vjRow("K", "CAFE", "카페", 33.5, 126.5);
    const card = placeCard(plain, { listBuiltAt: BUILT, lots });
    expect(card.tiles?.[1]).toMatchObject({ label: "주변 주차장 1km", value: "3곳", sub: "무료 1 · 유료 1 · 일부유료 1" });
    expect(card.rows.find((r) => r.label === "가까운 주차장")?.lines[0]).toBe("가까운 공영 · 60m · 유료");
    // 비짓제주 주차장 태그나 관광공사 주차 정보가 있으면 찾지 않는다
    const tagged: SearchRow = [...plain];
    tagged[11] = true;
    expect(placeCard(tagged, { listBuiltAt: BUILT, lots }).tiles?.[1]?.value).toBe("주차장 있음");
    // 관광공사 상세를 받는 중에는 기다린다, 주차장 자료를 받는 중이면 확인 중
    expect(placeCard(ROW, { listBuiltAt: BUILT, detail: "loading", lots }).tiles?.[1]?.value).toBe("확인 중…");
    expect(placeCard(plain, { listBuiltAt: BUILT, lots: "loading" }).tiles?.[1]?.value).toBe("확인 중…");
    expect(placeCard(plain, { listBuiltAt: BUILT, lots: [] }).tiles?.[1]).toMatchObject({ value: "없음", sub: "반경 1km 안" });
  });
});

describe("관광지 카드 (TASK-031)", () => {
  const spot = vjRow("S", "ATTRACTION", "사라봉", 33.5, 126.5);
  const places = [
    spot,
    vjRow("F1", "RESTAURANT", "가까운 식당", 33.501, 126.5),
    vjRow("F2", "CAFE", "카페", 33.51, 126.5),
    vjRow("F3", "RESTAURANT", "먼 식당", 33.53, 126.5),
    vjRow("H1", "ACCOMMODATION", "호텔", 33.505, 126.5),
    vjRow("A2", "ATTRACTION", "다른 관광지", 33.5001, 126.5),
  ];

  it("주변 맛집(음식점·카페)·숙소: 반경 2km 가까운 순, 관광지는 빼고", () => {
    expect(placesAround(spot, places, "food").map((p) => p.place[2])).toEqual(["가까운 식당", "카페"]);
    expect(placesAround(spot, places, "stay").map((p) => p.place[2])).toEqual(["호텔"]);
  });

  it("소요시간 칸: 받은 값·받는 중·실패·위치 없음", () => {
    expect(travelTile({ seconds: 1500, meters: 12_300, mock: false })).toMatchObject({ value: "약 25분", sub: "자동차 12.3km · 카카오모빌리티", tone: "good" });
    expect(travelTile({ seconds: 600, meters: 900, mock: true })?.sub).toBe("자동차 900m · 모의 경로");
    expect(travelTile("loading")?.value).toBe("확인 중…");
    expect(travelTile("failed")?.sub).toBe("다시 눌러 보세요");
    expect(travelTile("noLocation")?.value).toBe("위치 허용 시 표시");
    expect(travelTile(null)).toBeNull();
  });

  it("카드 큰 칸 6개: 운영시간·주차·소요시간·반려동물·주변 맛집·주변 숙소, 지도에 보기", () => {
    const shown: string[] = [];
    const card = placeCard(spot, {
      listBuiltAt: BUILT,
      lots: [],
      travel: { seconds: 1500, meters: 12_300, mock: false },
      around: { food: placesAround(spot, places, "food"), stay: placesAround(spot, places, "stay"), onShow: (k) => shown.push(k) },
    });
    expect(card.tiles?.map((t) => t.label)).toEqual(["이용시간", "주변 주차장 1km", "현재 위치에서", "반려동물", "주변 맛집 2km", "주변 숙소 2km"]);
    expect(card.tiles?.[4]).toMatchObject({ value: "2곳", sub: "가장 가까운 곳 110m" });
    card.tiles?.[4]?.action?.onClick();
    card.tiles?.[5]?.action?.onClick();
    expect(shown).toEqual(["food", "stay"]);
    expect(card.rows.find((r) => r.label === "가까운 맛집")?.lines).toEqual(["가까운 식당 · 110m · 음식점", "카페 · 1.1km · 카페"]);
    expect(card.footer).toContain("소요시간은 지금 교통 상황 기준 예상");
    // 없으면 "없음", 누를 수 없음
    const empty = placeCard(spot, { listBuiltAt: BUILT, around: { food: [], stay: [] }, travel: "noLocation" });
    expect(empty.tiles?.[4]).toMatchObject({ value: "없음", action: undefined });
    expect(empty.tiles?.[2]?.value).toBe("위치 허용 시 표시");
  });
});
