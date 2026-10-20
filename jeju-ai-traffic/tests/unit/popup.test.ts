// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { JEJU_ITS_SITE, popupContent } from "../../web/src/features/map/leafletMap";

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
});
