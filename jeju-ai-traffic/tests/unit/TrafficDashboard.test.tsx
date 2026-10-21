// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { TrafficEnforcementResponse, TrafficFacilitiesResponse, TrafficGasResponse, TrafficParkingResponse, TrafficIncident, TrafficIncidentsResponse, TrafficLinksResponse, TrafficSpeedsResponse } from "../../shared/contracts/traffic";
import { encodePolyline } from "../../shared/rules/polyline";
import { REFRESH_MS, TrafficDashboard } from "../../web/src/features/traffic/TrafficDashboard";

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

let respond: () => Response;
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

describe("교통 현황 대시보드 (TASK-012)", () => {
  it("종류별 건수, 묶음 목록, 조회 시각, 경로 추천 링크와 고지", async () => {
    render(<TrafficDashboard />);
    expect(await screen.findByText("감지된 사건 5건")).toBeTruthy();
    expect(counts()).toEqual(["전체5", "돌발4", "통제0", "공사1"]);
    const groups = screen.getByRole("list", { name: "확인된 교통 사건" });
    expect(within(groups).getAllByRole("button").map((b) => b.textContent?.match(/^(.+?\d+건)/)?.[1])).toEqual(["정지차량 감지 3건", "지정체구간 감지 1건", "공사 도로 공사 1건"]);
    expect(screen.getByText(/10월 20일 09:33 조회/)).toBeTruthy();
    expect(screen.getByRole("link", { name: "경로 추천 →" }).getAttribute("href")).toBe("/route");
    expect(screen.getByText("운전 중에는 화면을 조작하지 마세요.")).toBeTruthy();
    expect(screen.getByRole("contentinfo").textContent).toContain("제주 ITS");
  });

  it("종류 필터: 공사만 보이고, 없는 종류는 '이상 없음'이 아니라고 안내", async () => {
    render(<TrafficDashboard />);
    await screen.findByText("감지된 사건 5건");
    fireEvent.click(screen.getByRole("button", { name: /공사1/ }));
    expect(screen.getByText("감지된 사건 1건")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /정지차량 감지/ })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /통제0/ }));
    expect(screen.getByText(/현재 제주 ITS에 감지된 통제 정보가 없습니다.*도로에 이상이 없다는 뜻은 아닙니다/)).toBeTruthy();
  });

  it("묶음을 누르면 지도 지점 표시·다음 지점·전체 보기", async () => {
    render(<TrafficDashboard />);
    fireEvent.click(await screen.findByRole("button", { name: /정지차량 감지 3건/ }));
    expect(screen.getByText("정지차량 감지 1/3번째 지점 표시 중")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "다음 지점 ›" }));
    expect(screen.getByText("정지차량 감지 2/3번째 지점 표시 중")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "전체 보기" }));
    expect(screen.queryByText(/번째 지점 표시 중/)).toBeNull();
  });

  it("화면이 켜져 있을 때만 1분마다 다시 조회, 실패하면 마지막 성공 결과를 남긴다", async () => {
    render(<TrafficDashboard />);
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
    render(<TrafficDashboard />);
    expect((await screen.findAllByRole("alert"))[0]!.textContent).toBe("교통 사건 정보 미확보(오늘 조회 한도 도달, 10월 21일 00:00 이후 다시 사용 가능)");
    expect(counts()).toEqual(["전체–", "돌발–", "통제–", "공사–"]);
    expect(screen.queryByText(/감지된 돌발·통제·공사가 없습니다/)).toBeNull();
  });

  it("사건이 없으면 '감지된 사건 없음'과 한계를 함께 안내", async () => {
    respond = () => Response.json({ ...OK, incidents: [] });
    render(<TrafficDashboard />);
    expect(await screen.findByText(/현재 제주 ITS에 감지된 돌발·통제·공사가 없습니다/)).toBeTruthy();
  });

  it("도로 소통: 속도가 있는 구간만 원활·서행·정체로 세고, 끄고 켤 수 있다", async () => {
    render(<TrafficDashboard />);
    const counts = await screen.findByRole("list", { name: "구간 소통 건수" });
    await within(counts).findByText("3");
    expect(within(counts).getAllByRole("button").map((b) => b.textContent)).toEqual(["전체3", "원활1", "서행1", "정체1"]);
    expect(screen.getByText(/10월 20일 09:30 기준/)).toBeTruthy();
    const map = screen.getByRole("region", { name: "교통 현황 지도" });
    expect(map.getAttribute("data-speed-lines")).toBe("3");
    const toggle = screen.getByRole("button", { name: "지도에 표시 중" });
    fireEvent.click(toggle);
    expect(map.getAttribute("data-speed-lines")).toBe("0");
    expect(screen.getByRole("button", { name: "지도에 표시" }).getAttribute("aria-pressed")).toBe("false");
  });

  it("구간 속도 한도면 미확보 안내, 사건 정보는 그대로", async () => {
    speedsRespond = () => Response.json({ status: "quotaBlocked", observedAt: null, speeds: {}, source: "jejuIts", retryAfter: "2026-10-20T15:00:00.000Z" });
    render(<TrafficDashboard />);
    expect(await screen.findByText("구간 속도 정보 미확보(오늘 조회 한도 도달, 10월 21일 00:00 이후 다시 사용 가능)")).toBeTruthy();
    expect(screen.getByText("감지된 사건 5건")).toBeTruthy();
    expect(screen.getByRole("list", { name: "구간 소통 건수" }).textContent).toBe("전체–원활–서행–정체–");
  });

  it("원활 카드: 그 상태 구간만 지도에, 도로명별 목록 → 도로를 누르면 강조, 전체 보기로 닫음", async () => {
    render(<TrafficDashboard />);
    const counts = await screen.findByRole("list", { name: "구간 소통 건수" });
    await within(counts).findByText("3");
    const map = screen.getByRole("region", { name: "교통 현황 지도" });
    expect(screen.queryByRole("list", { name: /도로 목록|구간 목록/ })).toBeNull();

    fireEvent.click(within(counts).getByRole("button", { name: /원활/ }));
    expect(map.getAttribute("data-speed-lines")).toBe("1");
    const list = screen.getByRole("list", { name: "원활 도로 목록" });
    expect(screen.getByText("원활 도로 1곳 · 구간이 많은 순")).toBeTruthy();
    const road = within(list).getByRole("button", { name: /노형로/ });
    expect(road.textContent).toContain("노형로 · 원활 1구간 · 평균 45km/h");

    fireEvent.click(road);
    expect(road.getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByText("노형로 원활 1구간 표시 중")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "전체 보기" }));
    expect(screen.queryByText(/구간 표시 중/)).toBeNull();

    fireEvent.click(within(counts).getByRole("button", { name: /전체/ }));
    expect(map.getAttribute("data-speed-lines")).toBe("3");
    expect(screen.queryByRole("list", { name: /도로 목록|구간 목록/ })).toBeNull();
  });

  it("정체·서행 카드를 누르면 실시간 정체구간 목록(도로명·표시·A → B), 누르면 지도 강조, 다시 누르거나 전체 보기로 닫음 (TASK-015)", async () => {
    render(<TrafficDashboard />);
    const counts = await screen.findByRole("list", { name: "구간 소통 건수" });
    await within(counts).findByText("3");
    // 따로 된 카드는 없고, 누르기 전에는 목록이 없다.
    expect(screen.queryByRole("region", { name: "실시간 정체구간" })).toBeNull();
    expect(screen.queryByRole("list", { name: /구간 목록/ })).toBeNull();
    const map = screen.getByRole("region", { name: "교통 현황 지도" });

    fireEvent.click(within(counts).getByRole("button", { name: /정체/ }));
    expect(map.getAttribute("data-speed-lines")).toBe("1");
    expect(screen.getByText("실시간 정체구간 1곳 · 느린 순")).toBeTruthy();
    const rows = within(screen.getByRole("list", { name: "실시간 정체구간 목록" })).getAllByRole("button");
    expect(rows.map((r) => r.textContent)).toEqual(["평화로정체어승생삼거리 → 광평교차로8km/h지도 ›"]);
    fireEvent.click(rows[0]!);
    expect(rows[0]!.getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByText("평화로 정체 · 어승생삼거리 → 광평교차로 표시 중")).toBeTruthy();
    fireEvent.click(rows[0]!);
    expect(screen.queryByText(/광평교차로 표시 중/)).toBeNull();

    fireEvent.click(within(counts).getByRole("button", { name: /서행/ }));
    const slow = within(screen.getByRole("list", { name: "실시간 서행구간 목록" })).getAllByRole("button");
    expect(slow.map((r) => r.textContent)).toEqual(["연북로서행1구간20km/h지도 ›"]);
    fireEvent.click(slow[0]!);
    fireEvent.click(screen.getByRole("button", { name: "전체 보기" }));
    expect(slow[0]!.getAttribute("aria-pressed")).toBe("false");
  });

  it("도로 소통 카드가 사건 카드보다 위에 있고, 구간 속도도 1분마다 다시 조회한다", async () => {
    render(<TrafficDashboard />);
    const speedsRegion = await screen.findByRole("region", { name: "도로 소통" });
    await within(speedsRegion).findByText(/마지막 조회/);
    expect(within(speedsRegion).getByText(/화면이 켜져 있을 때 1분마다 자동 갱신/)).toBeTruthy();
    const kinds = screen.getByRole("list", { name: "종류별 건수" });
    expect(speedsRegion.compareDocumentPosition(kinds) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(speedCalls).toBe(1);
    await act(async () => vi.advanceTimersByTime(REFRESH_MS));
    expect(speedCalls).toBe(2);
  });

  it("처리 현황: 도로 모양을 받는 동안 단계·경과 시간과 지도 안내, 끝나면 감춘다", async () => {
    let release: (r: Response) => void = () => undefined;
    linksRespond = () => new Promise<Response>((resolve) => (release = resolve));
    render(<TrafficDashboard />);
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
    expect(screen.getByRole("region", { name: "교통 현황 지도" }).getAttribute("data-speed-lines")).toBe("3");
  });

  it("도로 모양 실패 시 다시 시도 버튼으로 다시 받는다", async () => {
    linksRespond = () => Response.json({ error: { code: "PROVIDER_UNAVAILABLE", message: "x" } }, { status: 503 });
    render(<TrafficDashboard />);
    const alert = await screen.findByText("도로 모양을 불러오지 못해 구간 속도 색을 표시할 수 없습니다.");
    expect(linksCalls).toBe(1);
    linksRespond = () => Response.json(LINKS);
    fireEvent.click(within(alert.parentElement!).getByRole("button", { name: "다시 시도" }));
    await waitFor(() => expect(screen.getByRole("region", { name: "교통 현황 지도" }).getAttribute("data-speed-lines")).toBe("3"));
    expect(linksCalls).toBe(2);
    expect(screen.queryByText(/도로 모양을 불러오지 못해/)).toBeNull();
  });

  it("1분 자동 갱신 중에는 '갱신 중…'만 작게 표시", async () => {
    render(<TrafficDashboard />);
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

  it("교통시설물: 유형별 개수, 기본 모두 꺼짐, 누르면 지도에 켜고 끈다, 없는 유형은 누를 수 없음", async () => {
    render(<TrafficDashboard />);
    const list = await screen.findByRole("list", { name: "교통시설물 유형" });
    const buttons = within(list).getAllByRole("button");
    expect(buttons.map((b) => b.textContent)).toEqual(["VMS1", "CCTV2", "웹카메라0", "영상VDS0", "AVI0", "신호제어기0", "RWIS1", "주정차 단속2", "주차장2", "주유소3", "LPG 충전소1"]);
    expect(buttons.every((b) => b.getAttribute("aria-pressed") === "false")).toBe(true);
    expect((within(list).getByRole("button", { name: /웹카메라/ }) as HTMLButtonElement).disabled).toBe(true);
    const map = screen.getByRole("region", { name: "교통 현황 지도" });
    expect(map.getAttribute("data-facilities")).toBe("0");
    fireEvent.click(within(list).getByRole("button", { name: /^CCTV/ }));
    expect(map.getAttribute("data-facilities")).toBe("2");
    fireEvent.click(within(list).getByRole("button", { name: /RWIS/ }));
    expect(map.getAttribute("data-facilities")).toBe("3");
    fireEvent.click(within(list).getByRole("button", { name: /^CCTV/ }));
    expect(map.getAttribute("data-facilities")).toBe("1");
  });

  it("주정차 단속 CCTV(TASK-016): 교통시설물 카드의 한 유형, 기본 꺼짐. 켜면 현재 위치를 확인해 반경 1km 안만 지도에", async () => {
    const ask = stubLocation({ lat: 33.502, lng: 126.536 });
    render(<TrafficDashboard />);
    const list = await screen.findByRole("list", { name: "교통시설물 유형" });
    const enf = await within(list).findByRole("button", { name: /주정차 단속2/ });
    expect(enf.getAttribute("aria-pressed")).toBe("false");
    expect(ask).not.toHaveBeenCalled();
    const map = screen.getByRole("region", { name: "교통 현황 지도" });
    fireEvent.click(enf);
    expect(await screen.findByText("내 위치 반경 1km 안 주정차 단속 CCTV 2곳")).toBeTruthy();
    expect(map.getAttribute("data-facilities")).toBe("2");
    expect(map.getAttribute("data-nearby")).toBe("1");
    expect(ask).toHaveBeenCalledTimes(1);
    expect(screen.getByText(/켜면 현재 위치를 한 번 확인해 반경 안만/)).toBeTruthy();
    // 끄고 다시 켜면 위치를 다시 묻지 않는다(위치 다시 확인 버튼으로만)
    fireEvent.click(enf);
    expect(map.getAttribute("data-nearby")).toBe("0");
    fireEvent.click(enf);
    expect(ask).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: "위치 다시 확인" }));
    await waitFor(() => expect(ask).toHaveBeenCalledTimes(2));
  });

  it("주정차 단속: 반경 밖이면 없다고 안내, 위치 권한이 없으면 끄고 이유를 보인다", async () => {
    stubLocation({ lat: 33.25, lng: 126.56 });
    render(<TrafficDashboard />);
    const list = await screen.findByRole("list", { name: "교통시설물 유형" });
    fireEvent.click(await within(list).findByRole("button", { name: /주정차 단속2/ }));
    expect(await screen.findByText("내 위치 반경 1km 안에 주정차 단속 CCTV가 없습니다.(주정차 단속은 제주시 자료만 있음)")).toBeTruthy();
    expect(screen.getByRole("region", { name: "교통 현황 지도" }).getAttribute("data-facilities")).toBe("0");
    cleanup();

    stubLocation(null);
    render(<TrafficDashboard />);
    const list2 = await screen.findByRole("list", { name: "교통시설물 유형" });
    const enf = await within(list2).findByRole("button", { name: /주정차 단속2/ });
    fireEvent.click(enf);
    expect(await screen.findByText(/내 위치 주변\(주정차 단속·주차장·주유소·LPG 충전소\)을 표시하지 못했습니다: 위치 권한이 꺼져 있습니다/)).toBeTruthy();
    expect(enf.getAttribute("aria-pressed")).toBe("false");
  });

  it("주차장(TASK-017): 켜면 위치 확인 후 반경 1km 안만, 주정차 단속과 함께 켜면 한 줄로 안내, 위치는 한 번만 묻는다", async () => {
    const ask = stubLocation({ lat: 33.502, lng: 126.536 });
    render(<TrafficDashboard />);
    const list = await screen.findByRole("list", { name: "교통시설물 유형" });
    const park = await within(list).findByRole("button", { name: /주차장2/ });
    expect(screen.getByText(/실시간 남은 칸은 없습니다/)).toBeTruthy();
    fireEvent.click(park);
    expect(await screen.findByText("내 위치 반경 1km 안 주차장 1곳")).toBeTruthy();
    const map = screen.getByRole("region", { name: "교통 현황 지도" });
    expect(map.getAttribute("data-facilities")).toBe("1");
    fireEvent.click(within(list).getByRole("button", { name: /주정차 단속2/ }));
    expect(screen.getByText("내 위치 반경 1km 안 주정차 단속 CCTV 2곳 · 주차장 1곳")).toBeTruthy();
    expect(map.getAttribute("data-facilities")).toBe("3");
    expect(ask).toHaveBeenCalledTimes(1);
  });

  it("주유소(TASK-018): 반경 3km 안만, 휘발유 최저가 안내, 주차장(1km)과 함께 켜면 반경별로 한 줄", async () => {
    stubLocation({ lat: 33.502, lng: 126.536 });
    render(<TrafficDashboard />);
    const list = await screen.findByRole("list", { name: "교통시설물 유형" });
    fireEvent.click(await within(list).findByRole("button", { name: /주유소3/ }));
    expect(await screen.findByText("내 위치 반경 3km 안 주유소 2곳 · 휘발유 최저 1,849원")).toBeTruthy();
    const map = screen.getByRole("region", { name: "교통 현황 지도" });
    expect(map.getAttribute("data-facilities")).toBe("2");
    fireEvent.click(within(list).getByRole("button", { name: /주차장2/ }));
    expect(screen.getByText("내 위치 반경 1km 안 주차장 1곳 · 반경 3km 안 주유소 2곳 · 휘발유 최저 1,849원")).toBeTruthy();
    expect(screen.getByText(/제주 ITS 주유소 정보/)).toBeTruthy();
  });

  it("LPG 충전소(범위 변경): 주유소와 따로, 반경 5km·LPG 최저가·목록, 주유소 목록에는 LPG만 파는 곳이 없다", async () => {
    stubLocation({ lat: 33.502, lng: 126.536 });
    render(<TrafficDashboard />);
    const list = await screen.findByRole("list", { name: "교통시설물 유형" });
    fireEvent.click(await within(list).findByRole("button", { name: /LPG 충전소1/ }));
    expect(await screen.findByText("내 위치 반경 5km 안 LPG 충전소 1곳 · LPG 최저 1,178원")).toBeTruthy();
    const rows = within(screen.getByRole("list", { name: "LPG 충전소 목록" })).getAllByRole("button");
    expect(rows.map((r) => r.textContent)).toEqual(["SK최저가제주LPG충전소1.5km1,178원LPG"]);
    fireEvent.click(within(list).getByRole("button", { name: /주유소3/ }));
    expect(within(screen.getByRole("list", { name: "주유소 목록" })).queryByText(/LPG충전소/)).toBeNull();
    expect(screen.getByText("내 위치 반경 3km 안 주유소 2곳 · 반경 5km 안 LPG 충전소 1곳 · 휘발유 최저 1,849원 · LPG 최저 1,178원")).toBeTruthy();
  });

  it("반경 안에 주유소가 없으면 '주유소가 없습니다'(조사)", async () => {
    stubLocation({ lat: 33.36, lng: 126.75 });
    render(<TrafficDashboard />);
    const list = await screen.findByRole("list", { name: "교통시설물 유형" });
    fireEvent.click(await within(list).findByRole("button", { name: /주유소3/ }));
    expect(await screen.findByText("내 위치 반경 3km 안에 주유소가 없습니다.")).toBeTruthy();
  });

  it("주유소 목록: 휘발유 싼 순, 맨 위 최저가는 '최저가' 표시·금색 칸, 나머지는 최저가와의 차이", async () => {
    stubLocation({ lat: 33.502, lng: 126.536 });
    render(<TrafficDashboard />);
    const list = await screen.findByRole("list", { name: "교통시설물 유형" });
    fireEvent.click(await within(list).findByRole("button", { name: /주유소3/ }));
    const rows = within(await screen.findByRole("list", { name: "주유소 목록" })).getAllByRole("button");
    expect(screen.getByText("반경 3km 주유소 · 휘발유 싼 순")).toBeTruthy();
    expect(rows.map((r) => r.textContent)).toEqual(["알뜰최저가알뜰주유소1.3km · 경유 1,829원1,849원휘발유", "SK도남주유소1.4km · 경유 1,845원1,867원최저가보다 +18원"]);
    expect(rows[0]!.className).toContain("ring-amber-400");
    expect(rows[1]!.className).not.toContain("ring-amber-400");
  });

  it("주유소: 한도면 '오늘 한도에 도달' 안내", async () => {
    gasRespond = () => Response.json({ error: { code: "QUOTA_BLOCKED", message: "x", retryAfter: "2026-10-21T15:00:00.000Z" } }, { status: 429 });
    render(<TrafficDashboard />);
    expect(await screen.findByText("오늘 주유소 조회 한도에 도달해 표시할 수 없습니다(10월 22일 00:00 이후 다시 확인).")).toBeTruthy();
  });

  it("주유소 자료를 못 받으면 안내와 다시 시도", async () => {
    gasRespond = () => Response.json({ error: { code: "PROVIDER_UNAVAILABLE", message: "x" } }, { status: 503 });
    render(<TrafficDashboard />);
    const msg = await screen.findByText("주유소 정보를 불러오지 못했습니다.");
    gasRespond = () => Response.json(GAS);
    fireEvent.click(within(msg.parentElement!).getByRole("button", { name: "다시 시도" }));
    const list = await screen.findByRole("list", { name: "교통시설물 유형" });
    expect(await within(list).findByRole("button", { name: /주유소3/ })).toBeTruthy();
  });

  it("주차장 자료를 못 받으면 안내와 다시 시도", async () => {
    parkingRespond = () => Response.json({ error: { code: "PROVIDER_UNAVAILABLE", message: "x" } }, { status: 503 });
    render(<TrafficDashboard />);
    const msg = await screen.findByText("주차장 정보를 불러오지 못했습니다.");
    parkingRespond = () => Response.json(PARKING);
    fireEvent.click(within(msg.parentElement!).getByRole("button", { name: "다시 시도" }));
    const list = await screen.findByRole("list", { name: "교통시설물 유형" });
    expect(await within(list).findByRole("button", { name: /주차장2/ })).toBeTruthy();
  });

  it("주정차 단속 자료를 못 받으면 안내와 다시 시도(제주 ITS 시설물은 그대로)", async () => {
    enforcementRespond = () => Response.json({ error: { code: "PROVIDER_UNAVAILABLE", message: "x" } }, { status: 503 });
    render(<TrafficDashboard />);
    const msg = await screen.findByText("주정차 단속 CCTV를 불러오지 못했습니다.");
    const list2 = await screen.findByRole("list", { name: "교통시설물 유형" });
    expect((within(list2).getByRole("button", { name: /주정차 단속/ }) as HTMLButtonElement).disabled).toBe(true);
    enforcementRespond = () => Response.json(ENFORCEMENT);
    fireEvent.click(within(msg.parentElement!).getByRole("button", { name: "다시 시도" }));
    expect(await within(list2).findByRole("button", { name: /주정차 단속2/ })).toBeTruthy();
  });

  it("교통시설물 실패 시 안내와 다시 시도", async () => {
    facilitiesRespond = () => Response.json({ error: { code: "PROVIDER_UNAVAILABLE", message: "x" } }, { status: 503 });
    render(<TrafficDashboard />);
    const msg = await screen.findByText("교통시설물을 불러오지 못했습니다.");
    facilitiesRespond = () => Response.json(FACILITIES);
    fireEvent.click(within(msg.parentElement!).getByRole("button", { name: "다시 시도" }));
    expect(await screen.findByRole("list", { name: "교통시설물 유형" })).toBeTruthy();
  });
});
