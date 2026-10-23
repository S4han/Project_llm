// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { TrafficIncidentsResponse, TrafficSpeedsResponse } from "../../shared/contracts/traffic";
import { speedShares, todayLabel } from "../../web/src/features/home/startSummary";
import { TrafficApp } from "../../web/src/features/traffic/TrafficApp";

const SPEEDS: TrafficSpeedsResponse = { status: "ok", observedAt: "2026-10-23T04:31:00.000Z", speeds: { a: [45, 60], b: [50, 60], c: [20, 130], d: [8, 400] }, source: "jejuIts", retryAfter: null };
const INCIDENTS: TrafficIncidentsResponse = { incidents: [], status: "ok", observedAt: "2026-10-23T04:31:00.000Z", retryAfter: null };

describe("첫 화면 요약 (TASK-032)", () => {
  it("오늘 날짜는 한국 시간으로", () => {
    expect(todayLabel(new Date("2026-10-22T16:00:00.000Z"))).toBe("10월 23일(금)");
  });

  it("도로 비율: 원활·서행·정체 합 100, 구간이 없으면 null", () => {
    expect(speedShares(SPEEDS.speeds)).toEqual({ smooth: 50, slow: 25, congested: 25 });
    expect(speedShares({ a: [45, 1], b: [20, 1], c: [8, 1] })).toEqual({ smooth: 34, slow: 33, congested: 33 });
    expect(speedShares({})).toBeNull();
  });
});

describe("첫 화면·내 주변 고르기 (TASK-032)", () => {
  let urls: string[];
  let geo: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    urls = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (u: string) => {
        urls.push(String(u));
        if (String(u).includes("/speeds")) return Response.json(SPEEDS);
        if (String(u).includes("/incidents")) return Response.json({ ...INCIDENTS, incidents: [{ id: "e1", kind: "event", description: "정지차량", location: { lat: 33.4, lng: 126.5 }, observedAt: INCIDENTS.observedAt, sourceTime: null, source: "jejuIts" }] });
        return Response.json({ error: { code: "PROVIDER_UNAVAILABLE", message: "x" } }, { status: 503 });
      }),
    );
    geo = vi.fn();
    Object.defineProperty(navigator, "geolocation", { configurable: true, value: { getCurrentPosition: geo } });
    window.history.pushState(null, "", "/");
  });
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("검색창·도로 요약·돌발 건수·큰 버튼 4개·교통 현황 전체 보기, 위치는 묻지 않고 도로·돌발만 받는다", async () => {
    render(<TrafficApp />);
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("제주 교통·관광");
    expect(screen.getByRole("searchbox", { name: "관광지 검색어" })).toBeTruthy();
    await waitFor(() => expect(screen.getByRole("img", { name: "원활 50% 서행 25% 정체 25%" })).toBeTruthy());
    expect(screen.getByRole("button", { name: /돌발·통제·공사 1건/ })).toBeTruthy();
    expect(within(screen.getByRole("navigation", { name: "바로 가기" })).getAllByRole("button").map((b) => b.textContent)).toEqual(["🚗도로 소통막히는 구간 지도", "🧭경로 추천빠른 길·예상시간", "📍내 주변주차·주유·충전", "🏝️관광지검색·주변 정보"]);
    expect(screen.getByRole("button", { name: "교통 현황 전체 보기 ›" })).toBeTruthy();
    expect(geo).not.toHaveBeenCalled();
    expect(urls.every((u) => /\/api\/traffic\/(speeds|incidents)$/.test(u))).toBe(true);
    // 출처는 접어 둔다
    expect(screen.getByText("출처 보기").closest("details")?.open).toBe(false);
  });

  it("버튼: 도로 소통 → 정체 지도, 막대 글자 → 그 상태, 내 주변 → 고르기 → 주차장 지도, 교통 현황 전체 보기 → /traffic", async () => {
    render(<TrafficApp />);
    fireEvent.click(screen.getByRole("button", { name: /^내 주변/ }));
    expect(window.location.pathname).toBe("/nearby");
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("내 주변");
    expect(within(screen.getByRole("list", { name: "내 주변 종류" })).getAllByRole("button").map((b) => b.textContent?.split("반경")[0])).toEqual(["주차장", "주유소", "전기차 충전소", "LPG 충전소", "주정차 단속"]);
    fireEvent.click(screen.getByRole("button", { name: /^주차장/ }));
    expect(window.location.pathname).toBe("/map/parking");
    window.history.pushState(null, "", "/");
    cleanup();
    render(<TrafficApp />);
    fireEvent.click(screen.getByRole("button", { name: /^도로 소통/ }));
    expect(window.location.pathname).toBe("/map/congested");
    window.history.pushState(null, "", "/");
    cleanup();
    render(<TrafficApp />);
    await waitFor(() => expect(screen.getByRole("button", { name: /^서행 25%/ })).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: /^서행 25%/ }));
    expect(window.location.pathname).toBe("/map/slow");
    window.history.pushState(null, "", "/");
    cleanup();
    render(<TrafficApp />);
    fireEvent.click(screen.getByRole("button", { name: "교통 현황 전체 보기 ›" }));
    expect(window.location.pathname).toBe("/traffic");
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("제주 실시간 교통 현황");
    fireEvent.click(screen.getByRole("button", { name: "← 홈" }));
    expect(window.location.pathname).toBe("/");
  });
});
