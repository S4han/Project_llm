// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { TrafficIncident, TrafficIncidentsResponse } from "../../shared/contracts/traffic";
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

let respond: () => Response;
let calls = 0;
let visibility: DocumentVisibilityState = "visible";

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date", "setInterval", "clearInterval"] });
  vi.setSystemTime(new Date("2026-10-20T00:34:00.000Z"));
  calls = 0;
  respond = () => Response.json(OK);
  visibility = "visible";
  vi.spyOn(document, "visibilityState", "get").mockImplementation(() => visibility);
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => {
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
    expect(screen.getByRole("link", { name: "← 경로 추천" }).getAttribute("href")).toBe("/");
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
    expect((await screen.findByRole("alert")).textContent).toBe("갱신 실패: 네트워크 연결을 확인한 뒤 다시 시도하세요. · 마지막 성공 10월 20일 09:33");
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
    expect((await screen.findByRole("alert")).textContent).toBe("교통 사건 정보 미확보(오늘 조회 한도 도달, 10월 21일 00:00 이후 다시 사용 가능)");
    expect(counts()).toEqual(["전체–", "돌발–", "통제–", "공사–"]);
    expect(screen.queryByText(/감지된 돌발·통제·공사가 없습니다/)).toBeNull();
  });

  it("사건이 없으면 '감지된 사건 없음'과 한계를 함께 안내", async () => {
    respond = () => Response.json({ ...OK, incidents: [] });
    render(<TrafficDashboard />);
    expect(await screen.findByText(/현재 제주 ITS에 감지된 돌발·통제·공사가 없습니다/)).toBeTruthy();
  });
});
