// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { TrafficFacilitiesResponse, TrafficIncident, TrafficIncidentsResponse, TrafficLinksResponse, TrafficSpeedsResponse } from "../../shared/contracts/traffic";
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
const LINKS: TrafficLinksResponse = { links: [["4050000001", "노형로", line], ["4050000002", "연북로", line], ["4050000003", "평화로", line], ["4050000009", "속도없음로", line]], builtAt: AT, source: "vworld" };
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

let respond: () => Response;
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

  it("상태 카드를 누르면 그 상태 구간만 지도에, 도로명별 목록 → 도로를 누르면 강조, 전체 보기로 닫음", async () => {
    render(<TrafficDashboard />);
    const counts = await screen.findByRole("list", { name: "구간 소통 건수" });
    await within(counts).findByText("3");
    const map = screen.getByRole("region", { name: "교통 현황 지도" });
    expect(screen.queryByRole("list", { name: /도로 목록/ })).toBeNull();

    fireEvent.click(within(counts).getByRole("button", { name: /정체/ }));
    expect(map.getAttribute("data-speed-lines")).toBe("1");
    const list = screen.getByRole("list", { name: "정체 도로 목록" });
    expect(screen.getByText("정체 도로 1곳 · 구간이 많은 순")).toBeTruthy();
    const road = within(list).getByRole("button", { name: /평화로/ });
    expect(road.textContent).toContain("평화로 · 정체 1구간 · 평균 8km/h");

    fireEvent.click(road);
    expect(road.getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByText("평화로 정체 1구간 표시 중")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "전체 보기" }));
    expect(screen.queryByText(/구간 표시 중/)).toBeNull();

    fireEvent.click(within(counts).getByRole("button", { name: /전체/ }));
    expect(map.getAttribute("data-speed-lines")).toBe("3");
    expect(screen.queryByRole("list", { name: /도로 목록/ })).toBeNull();
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
    expect(buttons.map((b) => b.textContent)).toEqual(["VMS1", "CCTV2", "웹카메라0", "영상VDS0", "AVI0", "신호제어기0", "RWIS1"]);
    expect(buttons.every((b) => b.getAttribute("aria-pressed") === "false")).toBe(true);
    expect((within(list).getByRole("button", { name: /웹카메라/ }) as HTMLButtonElement).disabled).toBe(true);
    const map = screen.getByRole("region", { name: "교통 현황 지도" });
    expect(map.getAttribute("data-facilities")).toBe("0");
    fireEvent.click(within(list).getByRole("button", { name: /CCTV/ }));
    expect(map.getAttribute("data-facilities")).toBe("2");
    fireEvent.click(within(list).getByRole("button", { name: /RWIS/ }));
    expect(map.getAttribute("data-facilities")).toBe("3");
    fireEvent.click(within(list).getByRole("button", { name: /CCTV/ }));
    expect(map.getAttribute("data-facilities")).toBe("1");
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
