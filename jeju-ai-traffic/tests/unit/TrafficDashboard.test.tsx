// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { TrafficEnforcementResponse, TrafficEvResponse, TrafficFacilitiesResponse, TrafficGasResponse, TrafficParkingResponse, TrafficIncident, TrafficIncidentsResponse, TrafficLinksResponse, TrafficSpeedsResponse, TrafficStayResponse, TrafficTourDetailResponse, TrafficTourResponse } from "../../shared/contracts/traffic";
import { encodePolyline } from "../../shared/rules/polyline";
import { REFRESH_MS } from "../../web/src/features/traffic/TrafficDashboard";
import { TrafficApp } from "../../web/src/features/traffic/TrafficApp";
import { viewFromPath } from "../../web/src/features/traffic/views";
import { parkingFeeKind } from "../../web/src/features/traffic/facilityStyle";

const AT = "2026-10-20T00:33:00.000Z"; // KST 09:33
const inc = (id: string, kind: TrafficIncident["kind"], description: string, lat = 33.45): TrafficIncident => ({
  id, kind, description, location: { lat, lng: 126.5 }, observedAt: AT, sourceTime: null, source: "jejuIts",
});
const OK: TrafficIncidentsResponse = {
  incidents: [inc("e1", "event", "정지차량"), inc("e2", "event", "정지차량", 33.3), inc("e3", "event", "정지차량", 33.4), inc("e4", "event", "지정체구간"), inc("w1", "roadwork", "도로 공사")],
  status: "ok",
  observedAt: AT,
  retryAfter: null,
};

const line = encodePolyline([{ lat: 33.5, lng: 126.5 }, { lat: 33.49, lng: 126.51 }]);
const LINKS: TrafficLinksResponse = {
  links: [
    ["4050000001", "노형로", line, "노형오거리", "제주시청"],
    ["4050000002", "연북로", line, "", ""],
    ["4050000003", "평화로", line, "어승생삼거리", "광평교차로"],
    ["4050000009", "속도없음로", line, "", ""],
  ],
  named: true,
  builtAt: AT,
  source: "vworld",
};
const SPEEDS: TrafficSpeedsResponse = { status: "ok", observedAt: "2026-10-20T00:30:00.000Z", speeds: { "4050000001": [45, 60], "4050000002": [20, 130], "4050000003": [8, 400] }, source: "jejuIts", retryAfter: null };

const FACILITIES: TrafficFacilitiesResponse = {
  facilities: [
    ["V1", "FTY01", "축산마을입구", "", 33.44, 126.49],
    ["C1", "FTY02", "이호테우해변입구교차로", "TCS-3500", 33.49, 126.45],
    ["C2", "FTY02", "신광사거리", "MMK-H208", 33.49, 126.49],
    ["R1", "FTY23", "1100고지", "", 33.36, 126.46],
  ],
  failedTypes: [],
  builtAt: AT,
  source: "jejuIts",
};

const ENFORCEMENT: TrafficEnforcementResponse = {
  cameras: [
    ["1", "인제 신설오름 부근(고마로)", "제주시 일도2동 377-23", 1, 2, "평일 07시30분 ~ 22시\n공휴일 09시 ~ 18시", 33.5055, 126.5412],
    ["2", "시청 올리브영 부근(중앙로)", "제주시 이도2동 1179-24", 1, null, "07시30분 ~ 23시", 33.498767, 126.530539],
  ],
  builtAt: AT,
  source: "dataGoKr",
};

const PARKING: TrafficParkingResponse = {
  lots: [
    ["P1", "시청 공영주차장", "공영", "노외", "제주시 이도2동 1", 91, "매일 24시간", "유료 · 기본 30분 1,000원", 33.5005, 126.5325],
    ["P2", "서귀포 공영주차장", "공영", "노상", "서귀포시 1", null, "매일 24시간", "무료", 33.25, 126.56],
  ],
  builtAt: AT,
  source: "dataGoKr",
};

const GAS: TrafficGasResponse = {
  stations: [
    ["G1", "SKE", "도남주유소", 1867, 1845, 33.4918, 126.5273, null, "제주시 도남동", ""],
    ["G2", "RTO", "알뜰주유소", 1849, 1829, 33.505, 126.55, null, "제주시", ""],
    ["G3", "GSC", "중문주유소", 1899, 1879, 33.25, 126.41, null, "서귀포시", ""],
    ["L1", "SKG", "제주LPG충전소", null, null, 33.498, 126.52, 1178, "제주시 이호동", "064-000-0000"],
  ],
  builtAt: AT,
  source: "jejuIts",
};

const TOUR: TrafficTourResponse = {
  spots: [
    ["T1", "사라봉", "제주시 건입동", 33.5135, 126.5445, "https://tong.visitkorea.or.kr/cms/resource/1/a_image2_1.jpg", "Type3"],
    ["T2", "신산공원", "제주시 일도2동", 33.5045, 126.5385, "", ""],
    ["T3", "천지연폭포", "서귀포시 천지동", 33.2465, 126.5545, "", "Type1"],
  ],
  builtAt: AT,
  source: "kto",
};
const TOUR_DETAIL: TrafficTourDetailResponse = { id: "T1", usetime: "상시 개방\n야간 조명 22시까지", restdate: "연중무휴", parking: "가능 (승용차 30대)", infocenter: "안내소 064-000-0000", builtAt: AT, source: "kto" };

// 숙소(TASK-028): T2 신산공원(33.5045,126.5385) 기준 S1 약 0.2km 호텔, S2 약 0.5km 게스트하우스, S3 약 1.8km 펜션, S4 서귀포(밖)
const STAY: TrafficStayResponse = {
  stays: [
    ["S1", "신산 호텔", "제주시 일도2동 1", 33.5055, 126.5405, "HOTEL", true, "064-000-0001", "https://api.cdn.visitjeju.net/photomng/imgpath/a.webp", "시내 호텔", "호텔,숙소,조식 포함"],
    ["S2", "일도 게스트하우스", "제주시 일도1동 2", 33.5085, 126.5345, "GUEST", false, "", "", "", "게스트하우스,숙소"],
    ["S3", "사라봉 펜션", "제주시 건입동 3", 33.5205, 126.5385, "PENSION", true, "", "", "", "펜션"],
    ["S4", "서귀포 리조트", "서귀포시 4", 33.2485, 126.5605, "HOTEL", true, "", "", "", "리조트"],
  ],
  builtAt: AT,
  source: "visitJeju",
};

const EV: TrafficEvResponse = {
  stations: [
    ["E1", "시청 충전소", "제주시 이도2동", 33.5, 126.531, 2, 4, 1, 2, "24시간 이용가능", "환경부", "1661-9408", "Y"],
    ["E2", "신설오름 충전소", "제주시", 33.504, 126.54, 0, 2, 0, 0, "", "운영사", "", "N"],
    ["E3", "노형 급속충전소", "제주시", 33.503, 126.533, 3, 0, null, null, "", "운영사", "", ""],
  ],
  statusAt: AT,
  builtAt: AT,
  source: "jejuIts",
};

let respond: () => Response;
let evRespond: () => Response;
let gasRespond: () => Response;
let parkingRespond: () => Response;
let enforcementRespond: () => Response;
let facilitiesRespond: () => Response;
let speedsRespond: () => Response;
let speedCalls = 0;
let linksRespond: () => Response | Promise<Response>;
let linksCalls = 0;
let calls = 0;
let visibility: DocumentVisibilityState = "visible";
let tourRespond: () => Response;
let tourDetailRespond: (url: string) => Response;
let tourDetailCalls = 0;
let stayRespond: () => Response;

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date", "setInterval", "clearInterval"] });
  vi.setSystemTime(new Date("2026-10-20T00:34:00.000Z"));
  calls = 0;
  respond = () => Response.json(OK);
  speedsRespond = () => Response.json(SPEEDS);
  speedCalls = 0;
  linksRespond = () => Response.json(LINKS);
  linksCalls = 0;
  facilitiesRespond = () => Response.json(FACILITIES);
  enforcementRespond = () => Response.json(ENFORCEMENT);
  parkingRespond = () => Response.json(PARKING);
  gasRespond = () => Response.json(GAS);
  evRespond = () => Response.json(EV);
  tourRespond = () => Response.json(TOUR);
  tourDetailRespond = (url) => Response.json({ ...TOUR_DETAIL, id: new URL(url, "http://x").searchParams.get("id") });
  tourDetailCalls = 0;
  stayRespond = () => Response.json(STAY);
  visibility = "visible";
  vi.spyOn(document, "visibilityState", "get").mockImplementation(() => visibility);
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      if (url.startsWith("/api/traffic/speeds")) {
        speedCalls += 1;
        return speedsRespond();
      }
      if (url.startsWith("/api/traffic/facilities")) return facilitiesRespond();
      if (url.startsWith("/api/traffic/enforcement")) return enforcementRespond();
      if (url.startsWith("/api/traffic/parking")) return parkingRespond();
      if (url.startsWith("/api/traffic/gas")) return gasRespond();
      if (url.startsWith("/api/traffic/ev")) return evRespond();
      if (url.startsWith("/api/traffic/tour?id=")) {
        tourDetailCalls += 1;
        return tourDetailRespond(url);
      }
      if (url.startsWith("/api/traffic/tour")) return tourRespond();
      if (url.startsWith("/api/traffic/stay")) return stayRespond();
      if (url.startsWith("/api/traffic/links")) {
        linksCalls += 1;
        return linksRespond();
      }
      calls += 1;
      return respond();
    }),
  );
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

/** 브라우저 위치를 흉내 낸다. null이면 권한 거부. 호출 횟수를 셀 수 있게 돌려준다. */
function stubLocation(at: { lat: number; lng: number } | null) {
  const getCurrentPosition = vi.fn((ok: PositionCallback, fail?: PositionErrorCallback | null) => {
    if (at) ok({ coords: { latitude: at.lat, longitude: at.lng, accuracy: 30 } } as GeolocationPosition);
    else fail?.({ code: 1 } as GeolocationPositionError);
  });
  Object.defineProperty(navigator, "geolocation", { value: { getCurrentPosition }, configurable: true });
  return getCurrentPosition;
}

const counts = () => within(screen.getByRole("list", { name: "종류별 건수" })).getAllByRole("button").map((b) => b.textContent);

/** 주소를 정하고 교통 현황을 연다(TASK-025: 대시보드 /, 항목별 지도 /map/…). */
function openAt(path = "/") {
  window.history.pushState(null, "", path);
  return render(<TrafficApp />);
}
const map = () => screen.getByRole("region", { name: "교통 현황 지도" });
const status = () => screen.getByRole("status", { name: "내 위치 주변 조회 범위" });

describe("대시보드와 화면 전환 (TASK-025)", () => {
  it("주소 → 화면: /·/traffic·모르는 주소는 대시보드", () => {
    expect(viewFromPath("/")).toBe("home");
    expect(viewFromPath("/traffic")).toBe("home");
    expect(viewFromPath("/map/parking")).toBe("PARK");
    expect(viewFromPath("/map/congested/")).toBe("congested");
    expect(viewFromPath("/map/nothing")).toBe("home");
  });

  it("대시보드 카드: 도로 소통 3장, 내 위치 기준 주변 5장, 그 밖의 정보 2장, 지도 없음, 경로 추천 링크와 고지", async () => {
    stubLocation({ lat: 33.502, lng: 126.536 });
    openAt("/");
    const card = (name: RegExp) => screen.getByRole("button", { name });
    await waitFor(() => expect(card(/^원활/).textContent).toContain("1구간"));
    expect(within(screen.getByRole("list", { name: "도로 소통 카드" })).getAllByRole("button").map((b) => b.textContent)).toEqual([
      "원활1구간30km/h 이상지도 보기 ›",
      "서행1구간15~30km/h지도 보기 ›",
      "정체1구간15km/h 미만지도 보기 ›",
    ]);
    await waitFor(() => expect(screen.getByRole("status", { name: "대시보드 위치 기준" }).textContent).toBe("내 위치 기준(이 기기에서만 사용)"));
    await waitFor(() => expect(card(/^전기차 충전소/).textContent).toContain("1곳"));
    expect(within(screen.getByRole("list", { name: "내 주변 카드" })).getAllByRole("button").map((b) => b.textContent)).toEqual([
      "주정차 단속2곳반경 1km 안지도 보기 ›",
      "주차장1곳반경 1km · 무료 0곳지도 보기 ›",
      "주유소휘발유1,849원경유1,829원반경 3km 최저 · 2곳지도 보기 ›",
      "LPG 충전소1,178원반경 5km LPG 최저 · 1곳지도 보기 ›",
      "전기차 충전소1곳반경 1km 충전 가능 · 전체 3곳지도 보기 ›",
    ]);
    expect(card(/^돌발·통제·공사/).textContent).toContain("5건");
    await waitFor(() => expect(card(/^관광지(?! 검색)/).textContent).toBe("관광지2곳반경 5km 안지도 보기 ›"));
    expect(card(/^CCTV 등 교통시설물/).textContent).toContain("4곳");
    expect(screen.queryByRole("region", { name: "교통 현황 지도" })).toBeNull();
    expect(screen.getByRole("link", { name: "경로 추천 →" }).getAttribute("href")).toBe("/route");
    expect(screen.getByText("운전 중에는 화면을 조작하지 마세요.")).toBeTruthy();
    expect(screen.getByRole("contentinfo").textContent).toContain("제주 ITS");
  });

  it("위치를 허용하지 않으면 경고 없이 제주 전체 수", async () => {
    stubLocation(null);
    openAt("/");
    await waitFor(() => expect(screen.getByRole("status", { name: "대시보드 위치 기준" }).textContent).toBe("위치 허용 시 내 주변 · 지금은 제주 전체"));
    await waitFor(() => expect(screen.getByRole("button", { name: /^주차장/ }).textContent).toBe("주차장2곳제주 전체 · 무료 1곳지도 보기 ›"));
    expect(screen.getByRole("button", { name: /^주정차 단속/ }).textContent).toBe("주정차 단속2곳제주시 전체지도 보기 ›");
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("카드를 누르면 주소가 바뀌고 그 항목 지도 페이지, '← 대시보드'·뒤로 가기로 돌아오며 위치는 한 번만 묻는다", async () => {
    const ask = stubLocation({ lat: 33.502, lng: 126.536 });
    openAt("/");
    await waitFor(() => expect(screen.getByRole("button", { name: /^주차장/ }).textContent).toContain("1곳"));
    fireEvent.click(screen.getByRole("button", { name: /^주차장/ }));
    expect(window.location.pathname).toBe("/map/parking");
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("주차장");
    expect(await screen.findByText("내 위치 반경 1km 안 주차장 1곳(무료 0곳)")).toBeTruthy();
    expect(map().getAttribute("data-facilities")).toBe("1");
    fireEvent.click(screen.getByRole("button", { name: "← 대시보드" }));
    expect(window.location.pathname).toBe("/");
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("제주 실시간 교통 현황");
    // 뒤로 가기(popstate)
    act(() => {
      window.history.pushState(null, "", "/map/gas");
      window.dispatchEvent(new PopStateEvent("popstate"));
    });
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("주유소");
    expect(screen.getByText("내 위치 반경 3km 안 주유소 2곳 · 휘발유 최저 1,849원")).toBeTruthy();
    expect(map().getAttribute("data-facilities")).toBe("2");
    expect(ask).toHaveBeenCalledTimes(1);
  });

  it("지도 페이지는 그 항목만: 정체 페이지에는 사건·시설물이 없고, 시설물 페이지에는 도로 소통 선이 없다", async () => {
    stubLocation({ lat: 33.502, lng: 126.536 });
    openAt("/map/congested");
    await waitFor(() => expect(map().getAttribute("data-speed-lines")).toBe("1"));
    expect(map().getAttribute("data-facilities")).toBe("0");
    expect(screen.queryByRole("list", { name: "종류별 건수" })).toBeNull();
    cleanup();
    openAt("/map/gas");
    await waitFor(() => expect(map().getAttribute("data-facilities")).toBe("2"));
    expect(map().getAttribute("data-speed-lines")).toBe("0");
    expect(screen.queryByRole("list", { name: "구간 소통 건수" })).toBeNull();
  });
});

describe("돌발·통제·공사 페이지 (TASK-012 → TASK-025 /map/incidents)", () => {
  it("종류별 건수, 묶음 목록, 조회 시각", async () => {
    openAt("/map/incidents");
    expect(await screen.findByText("감지된 사건 5건")).toBeTruthy();
    expect(counts()).toEqual(["전체5", "돌발4", "통제0", "공사1"]);
    const groups = screen.getByRole("list", { name: "확인된 교통 사건" });
    expect(within(groups).getAllByRole("button").map((b) => b.textContent?.match(/^(.+?\d+건)/)?.[1])).toEqual(["정지차량 감지 3건", "지정체구간 감지 1건", "공사 도로 공사 1건"]);
    expect(screen.getByText(/10월 20일 09:33 조회/)).toBeTruthy();
  });

  it("종류 필터: 공사만 보이고, 없는 종류는 '이상 없음'이 아니라고 안내", async () => {
    openAt("/map/incidents");
    await screen.findByText("감지된 사건 5건");
    fireEvent.click(screen.getByRole("button", { name: /공사1/ }));
    expect(screen.getByText("감지된 사건 1건")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /정지차량 감지/ })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /통제0/ }));
    expect(screen.getByText(/현재 제주 ITS에 감지된 통제 정보가 없습니다.*도로에 이상이 없다는 뜻은 아닙니다/)).toBeTruthy();
  });

  it("묶음을 누르면 지도 지점 표시·다음 지점·전체 보기", async () => {
    openAt("/map/incidents");
    fireEvent.click(await screen.findByRole("button", { name: /정지차량 감지 3건/ }));
    expect(screen.getByText("정지차량 감지 1/3번째 지점 표시 중")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "다음 지점 ›" }));
    expect(screen.getByText("정지차량 감지 2/3번째 지점 표시 중")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "전체 보기" }));
    expect(screen.queryByText(/번째 지점 표시 중/)).toBeNull();
  });

  it("화면이 켜져 있을 때만 1분마다 다시 조회, 실패하면 마지막 성공 결과를 남긴다", async () => {
    openAt("/map/incidents");
    await screen.findByText("감지된 사건 5건");
    expect(calls).toBe(1);
    respond = () => Response.json({ error: { code: "PROVIDER_UNAVAILABLE", message: "네트워크 연결을 확인한 뒤 다시 시도하세요." } }, { status: 503 });
    await act(async () => vi.advanceTimersByTime(REFRESH_MS));
    expect(calls).toBe(2);
    expect((await screen.findAllByRole("alert"))[0]!.textContent).toBe("갱신 실패: 네트워크 연결을 확인한 뒤 다시 시도하세요. · 마지막 성공 10월 20일 09:33");
    expect(screen.getByText("감지된 사건 5건")).toBeTruthy();

    visibility = "hidden";
    await act(async () => vi.advanceTimersByTime(REFRESH_MS * 3));
    expect(calls).toBe(2);
    visibility = "visible";
    await act(async () => document.dispatchEvent(new Event("visibilitychange")));
    expect(calls).toBe(3);
  });

  it("한도·장애면 '정보 미확보(사유)', 사건 0건과 구분", async () => {
    respond = () => Response.json({ incidents: [], status: "quotaBlocked", observedAt: null, retryAfter: "2026-10-20T15:00:00.000Z" });
    openAt("/map/incidents");
    expect((await screen.findAllByRole("alert"))[0]!.textContent).toBe("교통 사건 정보 미확보(오늘 조회 한도 도달, 10월 21일 00:00 이후 다시 사용 가능)");
    expect(counts()).toEqual(["전체–", "돌발–", "통제–", "공사–"]);
    expect(screen.queryByText(/감지된 돌발·통제·공사가 없습니다/)).toBeNull();
  });

  it("사건이 없으면 '감지된 사건 없음'과 한계를 함께 안내", async () => {
    respond = () => Response.json({ ...OK, incidents: [] });
    openAt("/map/incidents");
    expect(await screen.findByText(/현재 제주 ITS에 감지된 돌발·통제·공사가 없습니다/)).toBeTruthy();
  });
});

describe("도로 소통 페이지 (TASK-012·015 → TASK-025 /map/smooth·slow·congested)", () => {
  it("원활 페이지: 상태별 건수(누르면 그 상태 페이지), 그 상태 구간만 지도에, 도로명별 목록 → 강조, 전체 보기로 닫음", async () => {
    openAt("/map/smooth");
    const list = await screen.findByRole("list", { name: "구간 소통 건수" });
    await within(list).findAllByText("1");
    expect(within(list).getAllByRole("button").map((b) => b.textContent)).toEqual(["원활1", "서행1", "정체1"]);
    expect(within(list).getByRole("button", { name: /원활/ }).getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByText(/10월 20일 09:30 기준/)).toBeTruthy();
    expect(map().getAttribute("data-speed-lines")).toBe("1");
    const roads = screen.getByRole("list", { name: "원활 도로 목록" });
    expect(screen.getByText("원활 도로 1곳 · 구간이 많은 순")).toBeTruthy();
    const road = within(roads).getByRole("button", { name: /노형로/ });
    expect(road.textContent).toContain("노형로 · 원활 1구간 · 평균 45km/h");
    fireEvent.click(road);
    expect(road.getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByText("노형로 원활 1구간 표시 중")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "전체 보기" }));
    expect(screen.queryByText(/구간 표시 중/)).toBeNull();

    fireEvent.click(within(list).getByRole("button", { name: /정체/ }));
    expect(window.location.pathname).toBe("/map/congested");
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("도로 소통 · 정체");
  });

  it("구간 속도 한도면 미확보 안내", async () => {
    speedsRespond = () => Response.json({ status: "quotaBlocked", observedAt: null, speeds: {}, source: "jejuIts", retryAfter: "2026-10-20T15:00:00.000Z" });
    openAt("/map/congested");
    expect(await screen.findByText("구간 속도 정보 미확보(오늘 조회 한도 도달, 10월 21일 00:00 이후 다시 사용 가능)")).toBeTruthy();
    expect(screen.getByRole("list", { name: "구간 소통 건수" }).textContent).toBe("원활–서행–정체–");
  });

  it("정체 페이지: 실시간 정체구간 목록(도로명·표시·A → B), 누르면 지도 강조, 다시 누르거나 전체 보기로 닫음, 서행 페이지 (TASK-015)", async () => {
    openAt("/map/congested");
    expect(await screen.findByText("실시간 정체구간 1곳 · 느린 순")).toBeTruthy();
    expect(map().getAttribute("data-speed-lines")).toBe("1");
    const rows = within(screen.getByRole("list", { name: "실시간 정체구간 목록" })).getAllByRole("button");
    expect(rows.map((r) => r.textContent)).toEqual(["평화로정체어승생삼거리 → 광평교차로8km/h지도 ›"]);
    fireEvent.click(rows[0]!);
    expect(rows[0]!.getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByText("평화로 정체 · 어승생삼거리 → 광평교차로 표시 중")).toBeTruthy();
    fireEvent.click(rows[0]!);
    expect(screen.queryByText(/광평교차로 표시 중/)).toBeNull();

    fireEvent.click(within(screen.getByRole("list", { name: "구간 소통 건수" })).getByRole("button", { name: /서행/ }));
    const slow = within(screen.getByRole("list", { name: "실시간 서행구간 목록" })).getAllByRole("button");
    expect(slow.map((r) => r.textContent)).toEqual(["연북로서행1구간20km/h지도 ›"]);
    fireEvent.click(slow[0]!);
    fireEvent.click(screen.getByRole("button", { name: "전체 보기" }));
    expect(slow[0]!.getAttribute("aria-pressed")).toBe("false");
  });

  it("구간 속도도 1분마다 다시 조회한다", async () => {
    openAt("/map/slow");
    const speedsRegion = await screen.findByRole("region", { name: "도로 소통" });
    await within(speedsRegion).findByText(/마지막 조회/);
    expect(within(speedsRegion).getByText(/화면이 켜져 있을 때 1분마다 자동 갱신/)).toBeTruthy();
    expect(speedCalls).toBe(1);
    await act(async () => vi.advanceTimersByTime(REFRESH_MS));
    expect(speedCalls).toBe(2);
  });

  it("처리 현황: 도로 모양을 받는 동안 단계·경과 시간과 지도 안내, 끝나면 감춘다", async () => {
    let release: (r: Response) => void = () => undefined;
    linksRespond = () => new Promise<Response>((resolve) => (release = resolve));
    openAt("/map/smooth");
    const progress = await screen.findByRole("status", { name: "도로 소통 처리 현황" });
    expect(progress.textContent).toContain("① 도로 모양 불러오는 중… 0초");
    expect(progress.textContent).toContain("처음 한 번은 최대 1분 걸릴 수 있어요.");
    await within(progress).findByText(/② 구간 속도 ✓/);
    expect(screen.getByText("도로 소통 불러오는 중…")).toBeTruthy();
    await act(async () => vi.advanceTimersByTime(3000));
    expect(progress.textContent).toContain("① 도로 모양 불러오는 중… 3초");
    await act(async () => release(Response.json(LINKS)));
    await waitFor(() => expect(screen.queryByRole("status", { name: "도로 소통 처리 현황" })).toBeNull());
    expect(screen.queryByText("도로 소통 불러오는 중…")).toBeNull();
    expect(map().getAttribute("data-speed-lines")).toBe("1");
  });

  it("도로 모양 실패 시 다시 시도 버튼으로 다시 받는다", async () => {
    linksRespond = () => Response.json({ error: { code: "PROVIDER_UNAVAILABLE", message: "x" } }, { status: 503 });
    openAt("/map/smooth");
    const alert = await screen.findByText("도로 모양을 불러오지 못해 구간 속도 색을 표시할 수 없습니다.");
    expect(linksCalls).toBe(1);
    linksRespond = () => Response.json(LINKS);
    fireEvent.click(within(alert.parentElement!).getByRole("button", { name: "다시 시도" }));
    await waitFor(() => expect(map().getAttribute("data-speed-lines")).toBe("1"));
    expect(linksCalls).toBe(2);
    expect(screen.queryByText(/도로 모양을 불러오지 못해/)).toBeNull();
  });

  it("1분 자동 갱신 중에는 '갱신 중…'만 작게 표시", async () => {
    openAt("/map/smooth");
    const region = await screen.findByRole("region", { name: "도로 소통" });
    await within(region).findByText(/마지막 조회/);
    let release: (r: Response) => void = () => undefined;
    speedsRespond = () => new Promise<Response>((resolve) => (release = resolve)) as unknown as Response;
    await act(async () => vi.advanceTimersByTime(REFRESH_MS));
    expect(within(region).getByText("· 갱신 중…")).toBeTruthy();
    expect(screen.queryByRole("status", { name: "도로 소통 처리 현황" })).toBeNull();
    await act(async () => release(Response.json(SPEEDS)));
    await waitFor(() => expect(within(region).queryByText("· 갱신 중…")).toBeNull());
  });
});

describe("CCTV 등 교통시설물 페이지 (TASK-013 → TASK-025 /map/facilities)", () => {
  it("제주 ITS 유형별 개수, 기본 모두 꺼짐, 누르면 지도에 켜고 끈다, 없는 유형은 누를 수 없음", async () => {
    openAt("/map/facilities");
    const list = await screen.findByRole("list", { name: "교통시설물 유형" });
    const buttons = within(list).getAllByRole("button");
    expect(buttons.map((b) => b.textContent)).toEqual(["VMS1", "CCTV2", "웹카메라0", "영상VDS0", "AVI0", "신호제어기0", "RWIS1"]);
    expect(buttons.every((b) => b.getAttribute("aria-pressed") === "false")).toBe(true);
    expect((within(list).getByRole("button", { name: /웹카메라/ }) as HTMLButtonElement).disabled).toBe(true);
    expect(map().getAttribute("data-facilities")).toBe("0");
    fireEvent.click(within(list).getByRole("button", { name: /^CCTV/ }));
    expect(map().getAttribute("data-facilities")).toBe("2");
    fireEvent.click(within(list).getByRole("button", { name: /RWIS/ }));
    expect(map().getAttribute("data-facilities")).toBe("3");
    fireEvent.click(within(list).getByRole("button", { name: /^CCTV/ }));
    expect(map().getAttribute("data-facilities")).toBe("1");
  });

  it("교통시설물 실패 시 안내와 다시 시도", async () => {
    facilitiesRespond = () => Response.json({ error: { code: "PROVIDER_UNAVAILABLE", message: "x" } }, { status: 503 });
    openAt("/map/facilities");
    const msg = await screen.findByText("교통시설물을 불러오지 못했습니다.");
    facilitiesRespond = () => Response.json(FACILITIES);
    fireEvent.click(within(msg.parentElement!).getByRole("button", { name: "다시 시도" }));
    expect(await screen.findByRole("list", { name: "교통시설물 유형" })).toBeTruthy();
  });
});

describe("내 주변 페이지 (TASK-016~024 → TASK-025 /map/enforcement·parking·gas·lpg·ev)", () => {
  it("주정차 단속: (화면을 열 때 확인한) 위치 기준 반경 1km 안만 지도에, 위치 다시 확인", async () => {
    const ask = stubLocation({ lat: 33.502, lng: 126.536 });
    openAt("/map/enforcement");
    expect(await screen.findByText("내 위치 반경 1km 안 주정차 단속 CCTV 2곳")).toBeTruthy();
    expect(map().getAttribute("data-facilities")).toBe("2");
    expect(map().getAttribute("data-nearby")).toBe("1");
    expect(ask).toHaveBeenCalledTimes(1);
    expect(screen.getByText(/제주시 자료\(공공데이터포털\)로 서귀포시는 없고/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "위치 다시 확인" }));
    await waitFor(() => expect(ask).toHaveBeenCalledTimes(2));
  });

  it("위치를 허용하면 지도를 내 위치 기준으로('제주 전체' 버튼), 거부하면 주변 페이지에서 다시 확인하고 이유와 다시 시도(TASK-023)", async () => {
    const ask = stubLocation({ lat: 33.502, lng: 126.536 });
    openAt("/map/parking");
    expect(await screen.findByRole("button", { name: "제주 전체" })).toBeTruthy();
    expect(ask).toHaveBeenCalledTimes(1);
    cleanup();
    const denied = stubLocation(null);
    openAt("/map/parking");
    expect(await screen.findByText(/내 위치 주변\(주정차 단속·주차장·주유소·LPG 충전소·전기차 충전소·관광지\)을 표시하지 못했습니다: 위치 권한이 꺼져 있습니다/)).toBeTruthy();
    expect(denied).toHaveBeenCalledTimes(2);
    expect(screen.queryByRole("button", { name: "제주 전체" })).toBeNull();
    expect(map().getAttribute("data-facilities")).toBe("0");
    stubLocation({ lat: 33.502, lng: 126.536 });
    fireEvent.click(screen.getByRole("button", { name: "다시 시도" }));
    expect(await screen.findByText("내 위치 반경 1km 안 주차장 1곳(무료 0곳)")).toBeTruthy();
    expect(map().getAttribute("data-facilities")).toBe("1");
  });

  it("제주 밖이면 주변 페이지에서 다시 확인하고 이유를 보인다(TASK-023)", async () => {
    const ask = stubLocation({ lat: 37.56, lng: 126.97 });
    openAt("/map/parking");
    await waitFor(() => expect(ask).toHaveBeenCalledTimes(2));
    expect(await screen.findByText(/현재 위치가 제주 밖이라/)).toBeTruthy();
  });

  it("주정차 단속: 반경 밖이면 없다고 안내", async () => {
    stubLocation({ lat: 33.25, lng: 126.56 });
    openAt("/map/enforcement");
    expect(await screen.findByText("내 위치 반경 1km 안에 주정차 단속 CCTV가 없습니다.(주정차 단속은 제주시 자료만 있음)")).toBeTruthy();
    expect(map().getAttribute("data-facilities")).toBe("0");
  });

  it("주차장(TASK-017): 반경 1km 안만, 무료 수, 실시간 남은 칸 없음 안내", async () => {
    stubLocation({ lat: 33.502, lng: 126.536 });
    openAt("/map/parking");
    expect(await screen.findByText("내 위치 반경 1km 안 주차장 1곳(무료 0곳)")).toBeTruthy();
    expect(screen.getByText(/실시간 남은 칸은 없습니다/)).toBeTruthy();
    expect(map().getAttribute("data-facilities")).toBe("1");
  });

  it("주유소(TASK-018): 반경 3km 안만, 휘발유 최저가 안내", async () => {
    stubLocation({ lat: 33.502, lng: 126.536 });
    openAt("/map/gas");
    expect(await screen.findByText("내 위치 반경 3km 안 주유소 2곳 · 휘발유 최저 1,849원")).toBeTruthy();
    expect(map().getAttribute("data-facilities")).toBe("2");
    expect(screen.getByText(/제주 ITS 주유소 정보/)).toBeTruthy();
  });

  it("LPG 충전소: 반경 5km·LPG 최저가·목록, 주유소 목록에는 LPG만 파는 곳이 없다", async () => {
    stubLocation({ lat: 33.502, lng: 126.536 });
    openAt("/map/lpg");
    expect(await screen.findByText("내 위치 반경 5km 안 LPG 충전소 1곳 · LPG 최저 1,178원")).toBeTruthy();
    const rows = within(screen.getByRole("list", { name: "LPG 충전소 목록" })).getAllByRole("button");
    expect(rows.map((r) => r.textContent)).toEqual(["SK최저가제주LPG충전소1.5km1,178원LPG"]);
    cleanup();
    openAt("/map/gas");
    const gasRows = await screen.findByRole("list", { name: "주유소 목록" });
    expect(within(gasRows).queryByText(/LPG충전소/)).toBeNull();
  });

  it("전기차 충전소(TASK-019): 반경 1km, 충전 가능 먼저·가까운 순, 급속만, 충전 가능 수 안내", async () => {
    stubLocation({ lat: 33.502, lng: 126.536 });
    openAt("/map/ev");
    expect(await screen.findByText("내 위치 반경 1km 안 전기차 충전소 3곳 · 충전 가능 1곳")).toBeTruthy();
    const rows = () => within(screen.getByRole("list", { name: "전기차 충전소 목록" })).getAllByRole("button").map((r) => r.textContent);
    expect(rows()).toEqual([
      "⚡시청 충전소0.5km · 급속 1/2 · 완속 2/43대충전 가능",
      "⚡노형 급속충전소0.3km · 급속 ?/3–상태 정보 없음",
      "⚡신설오름 충전소0.4km · 완속 0/2사용 중2대 모두",
    ]);
    fireEvent.click(screen.getByRole("button", { name: "⚡ 급속만" }));
    expect(rows()).toEqual(["⚡시청 충전소0.5km · 급속 1/2 · 완속 2/43대충전 가능", "⚡노형 급속충전소0.3km · 급속 ?/3–상태 정보 없음"]);
    expect(map().getAttribute("data-facilities")).toBe("2");
  });

  it("전기차 충전소 자료를 못 받으면 안내와 다시 시도", async () => {
    stubLocation({ lat: 33.502, lng: 126.536 });
    evRespond = () => Response.json({ error: { code: "PROVIDER_UNAVAILABLE", message: "x" } }, { status: 503 });
    openAt("/map/ev");
    const msg = await screen.findByText("전기차 충전소 정보를 불러오지 못했습니다.");
    evRespond = () => Response.json(EV);
    fireEvent.click(within(msg.parentElement!).getByRole("button", { name: "다시 시도" }));
    expect(await screen.findByText("내 위치 반경 1km 안 전기차 충전소 3곳 · 충전 가능 1곳")).toBeTruthy();
  });

  it("반경 안에 주유소가 없으면 '주유소가 없습니다'(조사)", async () => {
    stubLocation({ lat: 33.36, lng: 126.75 });
    openAt("/map/gas");
    expect(await screen.findByText("내 위치 반경 3km 안에 주유소가 없습니다.")).toBeTruthy();
  });

  it("주유소 목록: 휘발유 싼 순, 맨 위 최저가는 '최저가' 표시·금색 칸, 나머지는 최저가와의 차이", async () => {
    stubLocation({ lat: 33.502, lng: 126.536 });
    openAt("/map/gas");
    const rows = within(await screen.findByRole("list", { name: "주유소 목록" })).getAllByRole("button");
    expect(screen.getByText("반경 3km 주유소 · 휘발유 싼 순")).toBeTruthy();
    expect(rows.map((r) => r.textContent)).toEqual(["알뜰최저가알뜰주유소1.3km · 경유 1,829원1,849원휘발유", "SK도남주유소1.4km · 경유 1,845원1,867원최저가보다 +18원"]);
    expect(rows[0]!.className).toContain("ring-amber-400");
    expect(rows[1]!.className).not.toContain("ring-amber-400");
  });

  it("같은 최저가가 여럿이면 가장 가까운 한 곳만 금색 칸, 나머지는 '최저가와 같음'(TASK-021)", async () => {
    gasRespond = () => Response.json({ ...GAS, stations: GAS.stations.map((r) => (r[0] === "G1" ? ["G1", "SKE", "도남주유소", 1849, 1845, 33.4918, 126.5273, null, "제주시 도남동", ""] : r)) });
    stubLocation({ lat: 33.502, lng: 126.536 });
    openAt("/map/gas");
    const rows = within(await screen.findByRole("list", { name: "주유소 목록" })).getAllByRole("button");
    expect(rows.map((r) => r.textContent)).toEqual(["알뜰최저가알뜰주유소1.3km · 경유 1,829원1,849원휘발유", "SK도남주유소1.4km · 경유 1,845원1,849원최저가와 같음"]);
    expect(rows[0]!.className).toContain("ring-amber-400");
    expect(rows[1]!.className).not.toContain("ring-amber-400");
  });

  it("주유소: 한도면 '오늘 한도에 도달' 안내(대시보드 카드는 불러오지 못함)", async () => {
    stubLocation({ lat: 33.502, lng: 126.536 });
    gasRespond = () => Response.json({ error: { code: "QUOTA_BLOCKED", message: "x", retryAfter: "2026-10-21T15:00:00.000Z" } }, { status: 429 });
    openAt("/map/gas");
    expect(await screen.findByText("오늘 주유소 조회 한도에 도달해 표시할 수 없습니다(10월 22일 00:00 이후 다시 확인).")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "← 대시보드" }));
    expect(screen.getByRole("button", { name: /^주유소/ }).textContent).toBe("주유소–불러오지 못했습니다지도 보기 ›");
  });

  it("주유소 자료를 못 받으면 안내와 다시 시도", async () => {
    stubLocation({ lat: 33.502, lng: 126.536 });
    gasRespond = () => Response.json({ error: { code: "PROVIDER_UNAVAILABLE", message: "x" } }, { status: 503 });
    openAt("/map/gas");
    const msg = await screen.findByText("주유소 정보를 불러오지 못했습니다.");
    gasRespond = () => Response.json(GAS);
    fireEvent.click(within(msg.parentElement!).getByRole("button", { name: "다시 시도" }));
    expect(await screen.findByText("내 위치 반경 3km 안 주유소 2곳 · 휘발유 최저 1,849원")).toBeTruthy();
  });

  it("주차장 요금 구분(TASK-022): 무료·유료·혼합·정보 없음", () => {
    expect(parkingFeeKind("무료")).toBe("FREE");
    expect(parkingFeeKind("유료 · 기본 30분 1,000원")).toBe("PAID");
    expect(parkingFeeKind("혼합 · 기본 60분 500원")).toBe("MIXED");
    expect(parkingFeeKind("요금 정보 없음")).toBe("UNKNOWN");
    expect(parkingFeeKind("")).toBe("UNKNOWN");
  });

  it("주차장 무료 수 안내·범례, '무료만'을 누르면 무료 주차장만(TASK-022)", async () => {
    parkingRespond = () =>
      Response.json({
        ...PARKING,
        lots: [
          ...PARKING.lots,
          ["P3", "도남 무료주차장", "공영", "노외", "제주시 도남동", 20, "매일 24시간", "무료", 33.501, 126.535],
          ["P4", "혼합 주차장", "민영", "노외", "제주시", 10, "", "혼합 · 기본 60분 500원", 33.503, 126.537],
        ],
      });
    stubLocation({ lat: 33.502, lng: 126.536 });
    openAt("/map/parking");
    expect(await screen.findByText("내 위치 반경 1km 안 주차장 3곳(무료 1곳)")).toBeTruthy();
    expect(within(screen.getByRole("list", { name: "주차장 요금 범례" })).getAllByRole("listitem").map((li) => li.textContent)).toEqual(["무료", "유료", "일부유료"]);
    expect(map().getAttribute("data-facilities")).toBe("3");
    const free = screen.getByRole("button", { name: "P 무료만" });
    fireEvent.click(free);
    expect(free.getAttribute("aria-pressed")).toBe("true");
    expect(status().textContent).toContain("내 위치 반경 1km 안 무료 주차장 1곳");
    expect(map().getAttribute("data-facilities")).toBe("1");
    fireEvent.click(free);
    expect(map().getAttribute("data-facilities")).toBe("3");
  });

  it("주차장 자료를 못 받으면 안내와 다시 시도", async () => {
    stubLocation({ lat: 33.502, lng: 126.536 });
    parkingRespond = () => Response.json({ error: { code: "PROVIDER_UNAVAILABLE", message: "x" } }, { status: 503 });
    openAt("/map/parking");
    const msg = await screen.findByText("주차장 정보를 불러오지 못했습니다.");
    parkingRespond = () => Response.json(PARKING);
    fireEvent.click(within(msg.parentElement!).getByRole("button", { name: "다시 시도" }));
    expect(await screen.findByText("내 위치 반경 1km 안 주차장 1곳(무료 0곳)")).toBeTruthy();
  });

  it("주정차 단속 자료를 못 받으면 안내와 다시 시도", async () => {
    stubLocation({ lat: 33.502, lng: 126.536 });
    enforcementRespond = () => Response.json({ error: { code: "PROVIDER_UNAVAILABLE", message: "x" } }, { status: 503 });
    openAt("/map/enforcement");
    const msg = await screen.findByText("주정차 단속 CCTV를 불러오지 못했습니다.");
    enforcementRespond = () => Response.json(ENFORCEMENT);
    fireEvent.click(within(msg.parentElement!).getByRole("button", { name: "다시 시도" }));
    expect(await screen.findByText("내 위치 반경 1km 안 주정차 단속 CCTV 2곳")).toBeTruthy();
  });

  it("관광지(TASK-026): 반경 5km 가까운 순 목록, 지도에 표시, 줄을 누르면 카드를 열고 이용시간·주차를 불러온다", async () => {
    stubLocation({ lat: 33.502, lng: 126.536 });
    openAt("/map/tour");
    expect(await screen.findByText("내 위치 반경 5km 안 관광지 2곳")).toBeTruthy();
    expect(screen.getByText(/한국관광공사 국문 관광정보\(제주 관광지\)/)).toBeTruthy();
    const rows = within(screen.getByRole("list", { name: "관광지 목록" })).getAllByRole("button");
    expect(rows.map((r) => r.textContent)).toEqual(["관신산공원0.4km · 제주시 일도2동지도 ›", "관사라봉1.5km · 제주시 건입동지도 ›"]);
    expect(map().getAttribute("data-facilities")).toBe("2");
    fireEvent.click(rows[1]!);
    await waitFor(() => expect(tourDetailCalls).toBe(1));
    const tiles = () => [...document.querySelectorAll(".popup-card-tile")].map((t) => t.textContent);
    await waitFor(() => expect(tiles()[0]).toBe("관광지 주차가능한국관광공사"));
    expect(document.querySelector(".popup-card-lg")).toBeTruthy();
    expect(document.querySelector(".popup-card-tile.tone-good")).toBeTruthy();
    expect(screen.getByText("상시 개방")).toBeTruthy();
    expect(screen.getByText("가능 (승용차 30대)")).toBeTruthy();
    // 관광공사 주차 정보와 함께 관광지(사라봉) 기준 반경 1km 주차장(P1 시청 공영주차장 약 1.6km는 밖 → 없음)
    expect(tiles()[1]).toBe("주변 주차장 1km없음반경 1km 안");
    const img = document.querySelector(".popup-card-photo img") as HTMLImageElement;
    expect(img.src).toBe("https://tong.visitkorea.or.kr/cms/resource/1/a_image2_1.jpg");
    expect(screen.getByText("사진 한국관광공사")).toBeTruthy();
    expect(screen.getByRole("link", { name: "현재 위치에서 경로 안내" }).getAttribute("href")).toMatch(/^\/route\?to=/);
  });

  it("관광지 카드: 관광지 기준 반경 1km 주차장(가까운 순 3곳·무료 수·요금 구분)을 관광공사 주차 정보와 함께(TASK-026 범위 변경)", async () => {
    parkingRespond = () =>
      Response.json({
        ...PARKING,
        lots: [
          ...PARKING.lots,
          ["Q1", "신산 공영주차장", "공영", "노외", "제주시", 30, "", "무료", 33.5048, 126.5390],
          ["Q2", "일도 주차장", "민영", "노외", "제주시", 20, "", "유료 · 기본 30분 1,000원", 33.5060, 126.5400],
          ["Q3", "먼 주차장", "공영", "노외", "제주시", 10, "", "혼합", 33.5140, 126.5385],
          ["Q4", "가까운 혼합 주차장", "공영", "노외", "제주시", 10, "", "혼합", 33.5040, 126.5370],
        ],
      });
    stubLocation({ lat: 33.502, lng: 126.536 });
    openAt("/map/tour");
    const rows = within(await screen.findByRole("list", { name: "관광지 목록" })).getAllByRole("button");
    fireEvent.click(rows[0]!); // 신산공원
    await waitFor(() => expect([...document.querySelectorAll(".popup-card-tile")].map((t) => t.textContent)).toEqual(["관광지 주차가능한국관광공사", "주변 주차장 1km4곳무료 1곳지도에 보기 ›", "주변 숙소 2km3곳가장 가까운 곳 220m지도에 보기 ›"]));
    const lines = [...document.querySelectorAll(".popup-card-rows dd")].map((dd) => dd.textContent);
    expect(lines).toContain("신산 공영주차장 · 60m · 무료가까운 혼합 주차장 · 150m · 일부유료일도 주차장 · 220m · 유료");
    expect(screen.queryByText(/먼 주차장/)).toBeNull();
  });

  it("관광지 카드의 '주변 주차장' 칸 → 관광지 기준 반경 1km 주차장만 지도에·목록·무료만·주소(?parking=), 관광지 목록으로 돌아오기(TASK-027)", async () => {
    parkingRespond = () =>
      Response.json({
        ...PARKING,
        lots: [
          ...PARKING.lots,
          ["Q1", "신산 공영주차장", "공영", "노외", "제주시", 30, "", "무료", 33.5048, 126.539],
          ["Q2", "일도 주차장", "민영", "노외", "제주시", 20, "", "유료 · 기본 30분 1,000원", 33.506, 126.54],
        ],
      });
    stubLocation({ lat: 33.502, lng: 126.536 });
    openAt("/map/tour");
    const rows = within(await screen.findByRole("list", { name: "관광지 목록" })).getAllByRole("button");
    fireEvent.click(rows[0]!); // 신산공원
    const go = await waitFor(() => {
      const b = document.querySelector<HTMLButtonElement>("button.popup-card-tile-action");
      expect(b?.textContent).toBe("주변 주차장 1km3곳무료 1곳지도에 보기 ›");
      return b!;
    });
    fireEvent.click(go);
    expect(window.location.pathname + window.location.search).toBe("/map/tour?parking=T2");
    expect(screen.getByRole("heading", { name: "신산공원 주변 주차장" })).toBeTruthy();
    expect(screen.getByRole("status", { name: "관광지 주변 주차장" }).textContent).toContain("반경 1km 주차장 3곳(무료 1곳) 표시 중");
    // 지도: 관광지 1곳 + 주차장 3곳(P1 시청 0.7km 포함), 원은 관광지 기준
    expect(map().getAttribute("data-facilities")).toBe("4");
    expect(map().getAttribute("data-nearby")).toBe("1");
    const list = within(screen.getByRole("list", { name: "관광지 주변 주차장 목록" })).getAllByRole("button");
    expect(list.map((b) => b.textContent)).toEqual(["P신산 공영주차장60m · 무료 · 30면지도 ›", "P일도 주차장220m · 유료 · 20면지도 ›", "P시청 공영주차장710m · 유료 · 91면지도 ›"]);
    fireEvent.click(screen.getByRole("button", { name: "P 무료만" }));
    expect(map().getAttribute("data-facilities")).toBe("2");
    expect(within(screen.getByRole("list", { name: "관광지 주변 주차장 목록" })).getAllByRole("button")).toHaveLength(1);
    fireEvent.click(screen.getByRole("button", { name: "관광지 목록으로" }));
    expect(window.location.pathname + window.location.search).toBe("/map/tour");
    expect(await screen.findByText("내 위치 반경 5km 안 관광지 2곳")).toBeTruthy();
  });

  it("주소 ?parking=관광지 번호로 바로 열면 그 관광지 주변 주차장(공유·새로고침), 없는 번호면 관광지 목록", async () => {
    stubLocation({ lat: 33.502, lng: 126.536 });
    openAt("/map/tour?parking=T2");
    expect(await screen.findByRole("heading", { name: "신산공원 주변 주차장" })).toBeTruthy();
    cleanup();
    openAt("/map/tour?parking=NOPE");
    expect(await screen.findByText("내 위치 반경 5km 안 관광지 2곳")).toBeTruthy();
    expect(screen.queryByRole("heading", { name: /주변 주차장$/ })).toBeNull();
  });

  it("관광지 카드의 '주변 숙소' 칸 → 관광지 기준 반경 2km 숙소 지도·가까운 순 목록·종류 거르기·숙소 카드, 주소 ?stay=(TASK-028)", async () => {
    stubLocation({ lat: 33.502, lng: 126.536 });
    openAt("/map/tour");
    const rows = within(await screen.findByRole("list", { name: "관광지 목록" })).getAllByRole("button");
    fireEvent.click(rows[0]!); // 신산공원
    const go = await waitFor(() => {
      const b = [...document.querySelectorAll<HTMLButtonElement>("button.popup-card-tile-action")].find((x) => x.textContent?.startsWith("주변 숙소"));
      expect(b?.textContent).toBe("주변 숙소 2km3곳가장 가까운 곳 220m지도에 보기 ›");
      return b!;
    });
    fireEvent.click(go);
    expect(window.location.pathname + window.location.search).toBe("/map/tour?stay=T2");
    expect(screen.getByRole("heading", { name: "신산공원 주변 숙소" })).toBeTruthy();
    expect(screen.getByRole("status", { name: "관광지 주변 숙소" }).textContent).toContain("반경 2km 숙소 3곳 표시 중");
    expect(map().getAttribute("data-facilities")).toBe("4"); // 관광지 1 + 숙소 3
    const list = () => within(screen.getByRole("list", { name: "관광지 주변 숙소 목록" })).getAllByRole("button").map((b) => b.textContent);
    expect(list()).toEqual(["숙신산 호텔220m · 호텔·리조트 · 주차장지도 ›", "숙일도 게스트하우스580m · 게스트하우스지도 ›", "숙사라봉 펜션1.8km · 펜션 · 주차장지도 ›"]);
    expect(within(screen.getByRole("list", { name: "숙소 종류" })).getAllByRole("button").map((b) => b.textContent)).toEqual(["전체 3", "호텔·리조트 1", "펜션 1", "게스트하우스 1"]);
    fireEvent.click(screen.getByRole("button", { name: "펜션 1" }));
    expect(list()).toEqual(["숙사라봉 펜션1.8km · 펜션 · 주차장지도 ›"]);
    expect(map().getAttribute("data-facilities")).toBe("2");
    fireEvent.click(screen.getByRole("button", { name: "전체 3" }));
    fireEvent.click(within(screen.getByRole("list", { name: "관광지 주변 숙소 목록" })).getAllByRole("button")[0]!);
    const card = await waitFor(() => {
      const c = document.querySelector(".popup-card-lg");
      expect(c?.textContent).toContain("신산 호텔");
      return c!;
    });
    expect(card.querySelector(".popup-card-kicker")?.textContent).toBe("숙소 · 호텔·리조트");
    expect([...card.querySelectorAll(".popup-card-tile")].map((t) => t.textContent)).toEqual(["주차주차장 있음비짓제주 태그", "신산공원에서220m직선 거리"]);
    expect(card.textContent).toContain("064-000-0001");
    expect(card.textContent).toContain("호텔, 조식 포함");
    expect((card.querySelector("a.popup-card-link") as HTMLAnchorElement).href).toBe("https://www.visitjeju.net/kr/detail/view?contentsid=S1");
    expect((card.querySelector("a.popup-card-link") as HTMLAnchorElement).rel).toBe("noopener noreferrer");
    expect((card.querySelector(".popup-card-photo img") as HTMLImageElement).src).toBe("https://api.cdn.visitjeju.net/photomng/imgpath/a.webp");
    fireEvent.click(screen.getByRole("button", { name: "관광지 목록으로" }));
    expect(window.location.pathname + window.location.search).toBe("/map/tour");
  });

  it("숙소 자료를 못 받으면 관광지 카드에 안내, 숙소 화면에 다시 시도", async () => {
    stubLocation({ lat: 33.502, lng: 126.536 });
    stayRespond = () => Response.json({ error: { code: "PROVIDER_UNAVAILABLE", message: "x" } }, { status: 503 });
    openAt("/map/tour?stay=T2");
    const alert = await waitFor(() => {
      const a = screen.getAllByRole("alert").find((x) => x.textContent?.includes("숙소 정보를 불러오지 못했습니다."));
      expect(a).toBeTruthy();
      return a!;
    });
    stayRespond = () => Response.json(STAY);
    fireEvent.click(within(alert).getByRole("button", { name: "다시 시도" }));
    expect(await screen.findByText("반경 2km 숙소 3곳 표시 중")).toBeTruthy();
  });

  it("관광지 목록을 못 받으면 안내와 다시 시도", async () => {
    stubLocation({ lat: 33.502, lng: 126.536 });
    tourRespond = () => Response.json({ error: { code: "PROVIDER_UNAVAILABLE", message: "x" } }, { status: 503 });
    openAt("/map/tour");
    const msg = await screen.findByText("관광지 정보를 불러오지 못했습니다.");
    tourRespond = () => Response.json(TOUR);
    fireEvent.click(within(msg.parentElement!).getByRole("button", { name: "다시 시도" }));
    expect(await screen.findByText("내 위치 반경 5km 안 관광지 2곳")).toBeTruthy();
  });
});
