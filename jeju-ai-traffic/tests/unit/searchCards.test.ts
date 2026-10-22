import { describe, expect, it } from "vitest";
import type { SearchRow } from "../../shared/contracts/search";
import { petFromText, placeCard, short } from "../../web/src/features/search/searchCards";

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
});
