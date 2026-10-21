// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import type { TrafficIncident } from "../../shared/contracts/traffic";
import { facilityCard, incidentCard, JEJU_ITS_SITE, popupCard, speedLineCard } from "../../web/src/features/map/leafletMap";

describe("지도 팝업 카드 (TASK-014·017)", () => {
  it("CCTV 카드: 설치 위치·모델, 영상 찾는 방법, 제주 ITS 공식 사이트를 새 창으로(opener 차단)", () => {
    const el = popupCard(facilityCard({ id: "C1", type: "FTY02", name: "신광사거리", model: "MMK-H208", lat: 33.49, lng: 126.49 }));
    expect(el.querySelector(".popup-card-kicker")?.textContent).toBe("CCTV");
    expect(el.querySelector(".popup-card-title")?.textContent).toBe("신광사거리");
    expect(el.querySelector(".popup-card-badge")?.textContent).toBe("C");
    expect(el.querySelector("dd")?.textContent).toBe("MMK-H208");
    expect(el.querySelector(".popup-card-footer")?.textContent).toBe("영상 보기: 사이트 왼쪽 'CCTV' 메뉴 → 지도에서 '신광사거리' 카메라 선택");
    const a = el.querySelector("a")!;
    expect(a.getAttribute("href")).toBe("https://www.jejuits.go.kr/main/mainView.do");
    expect(JEJU_ITS_SITE).toBe("https://www.jejuits.go.kr/main/mainView.do");
    expect([a.target, a.rel, a.textContent]).toEqual(["_blank", "noopener noreferrer", "제주 ITS 교통정보센터 열기 ↗"]);
    // 영상이 없는 유형은 링크 없음
    expect(popupCard(facilityCard({ id: "V1", type: "FTY01", name: "축산마을입구", model: "", lat: 33.44, lng: 126.49 })).querySelector("a")).toBeNull();
  });

  it("사건 카드: 종류·출처, 시각, 원천 시각이 없으면 상세 없음 안내", () => {
    const inc: TrafficIncident = { id: "e1", kind: "event", description: "정지차량", location: { lat: 33.45, lng: 126.5 }, observedAt: "2026-10-20T00:33:00.000Z", sourceTime: null, source: "mock" };
    const el = popupCard(incidentCard(inc));
    expect(el.querySelector(".popup-card-kicker")?.textContent).toBe("돌발 · 모의 데이터");
    expect(el.querySelector(".popup-card-title")?.textContent).toBe("정지차량");
    expect([el.querySelector("dt")?.textContent, el.querySelector("dd")?.textContent]).toEqual(["조회", "10월 20일 09:33"]);
    expect(el.querySelector(".popup-card-footer")?.textContent).toBe("발생 시각과 상세는 제공되지 않습니다.");
  });

  it("도로 소통 카드: 상태·도로명, 평균속도 강조, 구간 A → B·통행 시간, 기준 시각", () => {
    const el = popupCard(speedLineCard({ id: "1", name: "평화로", points: [], kmh: 8, travelSeconds: 400, status: "congested", from: "어승생삼거리", to: "광평교차로" }, "2026-10-20T00:30:00.000Z"));
    expect(el.querySelector(".popup-card-kicker")?.textContent).toBe("도로 소통 · 정체");
    expect(el.querySelector(".popup-card-stat")?.textContent).toBe("8km/h");
    expect([...el.querySelectorAll("dd")].map((d) => d.textContent)).toEqual(["어승생삼거리 → 광평교차로", "7분"]);
    expect(el.querySelector(".popup-card-footer")?.textContent).toBe("10월 20일 09:30 기준 · 제주 ITS 평균속도");
  });

  it("주차장 카드 팝업: 이름·칩·면수·줄·주소·버튼, 원천 글자는 HTML로 해석하지 않는다(TASK-017)", () => {
    const el = popupCard({
      badge: { text: "P", color: "#1d4ed8" },
      kicker: "주차장",
      title: '<img src=x onerror="alert(1)">수덕',
      chips: ["공영", "노외", "유료"],
      stat: { value: "48", unit: "면" },
      rows: [
        { label: "운영", lines: ["매일 24시간"] },
        { label: "요금", lines: ["기본 30분 1,000원", "추가 15분 500원"] },
      ],
      footer: "제주시 노형동 2534-3",
      action: { href: "/route?to=x&lat=33.5&lng=126.5", label: "현재 위치에서 경로 안내" },
    });
    expect(el.querySelector("img")).toBeNull();
    expect(el.querySelector(".popup-card-title")?.textContent).toBe('<img src=x onerror="alert(1)">수덕');
    expect([...el.querySelectorAll(".popup-card-chip")].map((c) => c.textContent)).toEqual(["공영", "노외", "유료"]);
    expect(el.querySelector(".popup-card-stat")?.textContent).toBe("48면");
    expect([...el.querySelectorAll("dt")].map((d) => d.textContent)).toEqual(["운영", "요금"]);
    expect([...el.querySelectorAll("dd")[1]!.querySelectorAll("span")].map((d) => d.textContent)).toEqual(["기본 30분 1,000원", "추가 15분 500원"]);
    const a = el.querySelector("a")!;
    expect([a.getAttribute("href"), a.target]).toEqual(["/route?to=x&lat=33.5&lng=126.5", ""]);
  });
});
