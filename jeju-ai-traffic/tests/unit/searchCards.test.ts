import { describe, expect, it } from "vitest";
import type { SearchRow } from "../../shared/contracts/search";
import type { TrafficParkingResponse } from "../../shared/contracts/traffic";
import { parkingNear, petFromText, placeCard, short } from "../../web/src/features/search/searchCards";

const ROW: SearchRow = ["kto:2755053", "RESTAURANT", "가람돌솥밥", "제주특별자치도 서귀포시 중문관광로 332", 33.2497, 126.4313, "", "", "", "", [["kto", "2755053"]], false, ""];
const AT = { listBuiltAt: "2026-10-22T23:00:00.000Z", liveAt: null };

describe("관광 검색 상세 카드 (TASK-029 범위 변경)", () => {
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
    const card = placeCard(ROW, null, AT, null, { id: "2755053", hours: "- 08:30~21:00\n- 마지막 주문 20:00", rest: "연중무휴", parking: "불가능", pet: "", info: "0507-1432-1200", builtAt: AT.listBuiltAt, source: "kto" });
    expect(card.tiles?.map((t) => [t.label, t.value])).toEqual([
      ["영업시간", "08:30~21:00"],
      ["주차", "불가"],
      ["반려동물", "정보 없음"],
      ["전화", "정보 없음"],
    ]);
    expect(card.tiles?.[0]?.sub).toBe("쉬는날 연중무휴");
    expect(card.rows.find((r) => r.label === "문의")?.lines).toEqual(["0507-1432-1200"]);
  });

  it("받는 중·실패·관광공사 자료 없음", () => {
    expect(placeCard(ROW, null, AT, null, "loading").tiles?.[0]?.value).toBe("확인 중…");
    expect(placeCard(ROW, null, AT, null, "failed").footer).toContain("불러오지 못했습니다");
    const vj: SearchRow = ["visitJeju:X", "CAFE", "숲카페", "", 33.5, 126.5, "", "", "", "", [["visitJeju", "X"]], true, "YES"];
    const card = placeCard(vj, 120, AT, "내 위치");
    expect(card.tiles?.map((t) => t.value)).toEqual(["정보 없음", "주차장 있음", "동반 가능", "120m"]);
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
    const kakao: SearchRow = ["kakaoLocal:K", "CAFE", "카페", "", 33.5, 126.5, "", "", "", "", [["kakaoLocal", "K"]], false, ""];
    const card = placeCard(kakao, null, AT, null, null, lots);
    expect(card.tiles?.[1]).toMatchObject({ label: "주변 주차장 1km", value: "3곳", sub: "무료 1 · 유료 1 · 일부유료 1" });
    expect(card.rows.find((r) => r.label === "가까운 주차장")?.lines[0]).toBe("가까운 공영 · 60m · 유료");
    // 비짓제주 주차장 태그나 관광공사 주차 정보가 있으면 찾지 않는다
    const tagged: SearchRow = [...kakao];
    tagged[11] = true;
    expect(placeCard(tagged, null, AT, null, null, lots).tiles?.[1]?.value).toBe("주차장 있음");
    // 관광공사 상세를 받는 중에는 기다린다, 주차장 자료를 받는 중이면 확인 중
    expect(placeCard(ROW, null, AT, null, "loading", lots).tiles?.[1]?.value).toBe("확인 중…");
    expect(placeCard(kakao, null, AT, null, null, "loading").tiles?.[1]?.value).toBe("확인 중…");
    expect(placeCard(kakao, null, AT, null, null, []).tiles?.[1]).toMatchObject({ value: "없음", sub: "반경 1km 안" });
  });
});
