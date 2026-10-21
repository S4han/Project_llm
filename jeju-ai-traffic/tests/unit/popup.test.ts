// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { JEJU_ITS_SITE, popupCard, popupContent } from "../../web/src/features/map/leafletMap";

describe("지도 팝업 (TASK-014)", () => {
  it("원천 데이터는 HTML로 해석하지 않고 글자로만 넣는다", () => {
    const el = popupContent('CCTV · <img src=x onerror="alert(1)"> 신광사거리');
    expect(el.querySelector("img")).toBeNull();
    expect(el.textContent).toBe('CCTV · <img src=x onerror="alert(1)"> 신광사거리');
  });

  it("CCTV 링크는 제주 ITS 공식 사이트를 새 창으로(opener 차단)", () => {
    const el = popupContent("CCTV · 신광사거리", { href: JEJU_ITS_SITE, label: "제주 ITS 교통정보센터 열기 ↗", note: "영상 보기: 사이트 왼쪽 'CCTV' 메뉴 → 지도에서 '신광사거리' 카메라 선택" });
    expect(el.querySelector(".popup-note")?.textContent).toBe("영상 보기: 사이트 왼쪽 'CCTV' 메뉴 → 지도에서 '신광사거리' 카메라 선택");
    const a = el.querySelector("a")!;
    expect(a.getAttribute("href")).toBe("https://www.jejuits.go.kr/main/mainView.do");
    expect(a.target).toBe("_blank");
    expect(a.rel).toBe("noopener noreferrer");
    expect(a.textContent).toBe("제주 ITS 교통정보센터 열기 ↗");
  });

  it("주정차 단속 팝업: 여러 줄(주소·CCTV 수·운영 시간)을 줄바꿈 그대로 글자로", () => {
    const el = popupContent("주정차 단속 CCTV · 시청 부근\n제주시 이도2동 1179-24\n회전형 1대 · 검지 4대\n운영 07시30분 ~ 23시");
    const p = el.querySelector("p")!;
    expect(p.style.whiteSpace).toBe("pre-line");
    expect(p.textContent?.split("\n")).toHaveLength(4);
  });

  it("주차장 경로 안내 링크는 이 서비스 안이라 같은 창으로(TASK-017)", () => {
    const el = popupContent("주차장 · 시청 공영주차장", { href: "/route?to=x&lat=33.5&lng=126.5", label: "현재 위치에서 경로 안내 ›", sameTab: true });
    const a = el.querySelector("a")!;
    expect(a.getAttribute("href")).toBe("/route?to=x&lat=33.5&lng=126.5");
    expect(a.target).toBe("");
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
