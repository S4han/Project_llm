// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MOCK_PLACES } from "../../api/_lib/providers/mockPlaces";
import type { ApiErrorBody } from "../../shared/contracts/common";
import { TripForm } from "../../web/src/features/trip/TripForm";
import type { LocationResult } from "../../web/src/services/geolocation";
import { parkingRouteHref, readRouteTarget } from "../../web/src/features/trip/routeLink";

const AIRPORT = MOCK_PLACES[0]!;

let respond: (q: string) => Response;
beforeEach(() => {
  respond = (q) => Response.json({ query: q, places: MOCK_PLACES.filter((p) => p.name.includes(q)), observedAt: "x" });
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string) => respond(decodeURIComponent(new URL(input, "http://t").searchParams.get("q") ?? ""))),
  );
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function renderForm(locate: () => Promise<LocationResult> = async () => ({ kind: "denied" })) {
  const onRequestRoute = vi.fn();
  render(<TripForm onRequestRoute={onRequestRoute} locate={locate} />);
  return { onRequestRoute };
}

const routeButton = () => screen.getByRole("button", { name: "경로 조회" });

async function search(label: "출발지" | "목적지", q: string) {
  const box = screen.getByRole("searchbox", { name: label });
  fireEvent.change(box, { target: { value: q } });
  fireEvent.submit(box.closest("form")!);
}

async function pick(label: "출발지" | "목적지", q: string, name: string) {
  await search(label, q);
  const list = await screen.findByRole("list", { name: `${label} 검색 결과` });
  fireEvent.click(within(list).getByText(name));
}

describe("TripForm", () => {
  it("처음에는 경로 조회가 꺼져 있다", () => {
    renderForm();
    expect((routeButton() as HTMLButtonElement).disabled).toBe(true);
  });

  it("현재 위치 허용 → 출발지 '현재 위치', 목적지 선택 후 조회 버튼이 켜지고 선택값을 넘긴다 (AC-001-01, AC-002-02)", async () => {
    const { onRequestRoute } = renderForm(async () => ({
      kind: "ok",
      location: AIRPORT.location,
      accuracyMeters: 15,
    }));
    fireEvent.click(screen.getByRole("button", { name: "현재 위치 사용" }));
    expect(await screen.findByText("현재 위치")).toBeTruthy();
    expect(screen.getByText("오차 약 ±15m")).toBeTruthy();
    expect((routeButton() as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText("목적지를 검색해서 선택하세요.")).toBeTruthy();

    await pick("목적지", "성산", "성산일출봉");
    await waitFor(() => expect((routeButton() as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(routeButton());
    expect(onRequestRoute).toHaveBeenCalledWith(
      { kind: "current", location: AIRPORT.location, accuracyMeters: 15 },
      expect.objectContaining({ id: "mock-seongsan" }),
    );
  });

  it("권한 거부 → 안내와 출발지 직접 검색 칸이 열리고, 수동 출발지로 조회할 수 있다 (AC-001-02·03, AC-011-04)", async () => {
    const { onRequestRoute } = renderForm(async () => ({ kind: "denied" }));
    fireEvent.click(screen.getByRole("button", { name: "현재 위치 사용" }));
    expect(await screen.findByText("위치 권한이 거부되었습니다. 출발지를 직접 검색하세요.")).toBeTruthy();
    await pick("출발지", "공항", "제주국제공항");
    await pick("목적지", "성산", "성산일출봉");
    fireEvent.click(routeButton());
    expect(onRequestRoute.mock.calls[0]![0]).toEqual({ kind: "place", place: AIRPORT });
  });

  it("정확도 부족 → 재확인 안내와 '다시 확인' 버튼 (AC-011-05)", async () => {
    const results: LocationResult[] = [
      { kind: "inaccurate", accuracyMeters: 850 },
      { kind: "ok", location: AIRPORT.location, accuracyMeters: 20 },
    ];
    renderForm(async () => results.shift()!);
    fireEvent.click(screen.getByRole("button", { name: "현재 위치 사용" }));
    expect(await screen.findByText(/위치가 정확하지 않습니다\(오차 약 850m, 기준 200m\)/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "현재 위치 다시 확인" }));
    expect(await screen.findByText("현재 위치")).toBeTruthy();
  });

  it("검색 결과가 없으면 결과 없음 상태 (AC-002-03)", async () => {
    renderForm();
    await search("목적지", "없는장소");
    expect(await screen.findByText("제주에서 검색 결과가 없습니다.")).toBeTruthy();
  });

  it("조회 제한이면 사유와 다시 사용 가능한 시각을 보여 준다", async () => {
    respond = () =>
      Response.json(
        { error: { code: "QUOTA_BLOCKED", message: "오늘 사용할 수 있는 조회 한도에 도달했습니다.", retryAfter: "2026-10-19T15:00:00.000Z" } } satisfies ApiErrorBody,
        { status: 429 },
      );
    renderForm();
    await search("목적지", "공항");
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("오늘 사용할 수 있는 조회 한도에 도달했습니다.");
    expect(alert.textContent).toContain("(10월 20일 00:00 이후 다시 사용 가능)");
  });

  it("네트워크 오류면 연결 확인 안내", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Promise.reject(new TypeError("offline"))));
    renderForm();
    await search("목적지", "공항");
    expect((await screen.findByRole("alert")).textContent).toBe("네트워크 연결을 확인한 뒤 다시 시도하세요.");
  });

  it("출발지와 목적지가 같으면 조회를 막는다 (AC-001-04)", async () => {
    renderForm(async () => ({ kind: "ok", location: AIRPORT.location, accuracyMeters: 10 }));
    fireEvent.click(screen.getByRole("button", { name: "현재 위치 사용" }));
    await screen.findByText("현재 위치");
    await pick("목적지", "공항", "제주국제공항");
    expect(await screen.findByText("출발지와 목적지가 같습니다. 다른 목적지를 선택하세요.")).toBeTruthy();
    expect((routeButton() as HTMLButtonElement).disabled).toBe(true);
  });

  it("목적지를 '변경'하면 다시 검색 상태가 되고 조회가 꺼진다 (AC-002-04)", async () => {
    renderForm(async () => ({ kind: "ok", location: AIRPORT.location, accuracyMeters: 10 }));
    fireEvent.click(screen.getByRole("button", { name: "현재 위치 사용" }));
    await screen.findByText("현재 위치");
    await pick("목적지", "성산", "성산일출봉");
    const changeButtons = screen.getAllByRole("button", { name: "변경" });
    fireEvent.click(changeButtons[1]!);
    expect(screen.getByRole("searchbox", { name: "목적지" })).toBeTruthy();
    expect((routeButton() as HTMLButtonElement).disabled).toBe(true);
  });

  it("모의 데이터 결과에는 '모의 데이터' 표시가 붙는다", async () => {
    renderForm();
    await search("목적지", "성산");
    const list = await screen.findByRole("list", { name: "목적지 검색 결과" });
    expect(within(list).getByText("모의 데이터")).toBeTruthy();
  });
});

describe("주차장 경로 안내로 넘어오기 (TASK-017)", () => {
  it("주소: 주차장 이름·주소·좌표만 담고(내 위치 없음), 읽으면 목적지. 제주 밖·이름 없음은 무시", () => {
    const href = parkingRouteHref({ id: "406-2-000102", name: "대정상모 공영노외1주차장", address: "서귀포시 대정읍 상모리 3964-1", lat: 33.2205, lng: 126.2505 });
    expect(href).toBe("/route?to=%EB%8C%80%EC%A0%95%EC%83%81%EB%AA%A8+%EA%B3%B5%EC%98%81%EB%85%B8%EC%99%B81%EC%A3%BC%EC%B0%A8%EC%9E%A5&addr=%EC%84%9C%EA%B7%80%ED%8F%AC%EC%8B%9C+%EB%8C%80%EC%A0%95%EC%9D%8D+%EC%83%81%EB%AA%A8%EB%A6%AC+3964-1&lat=33.220500&lng=126.250500&id=406-2-000102");
    expect(readRouteTarget(href.slice("/route".length))).toEqual({
      id: "parking-406-2-000102",
      name: "대정상모 공영노외1주차장",
      address: "서귀포시 대정읍 상모리 3964-1",
      roadAddress: null,
      location: { lat: 33.2205, lng: 126.2505 },
      provider: "parking",
    });
    expect(readRouteTarget("?to=x&lat=37.5&lng=127")).toBeNull();
    expect(readRouteTarget("?lat=33.5&lng=126.5")).toBeNull();
    expect(readRouteTarget("")).toBeNull();
  });

  it("목적지가 정해진 채로 열리면 현재 위치를 바로 확인하고, 정해지면 한 번 자동 조회", async () => {
    const onRequestRoute = vi.fn();
    const target = readRouteTarget("?to=시청 공영주차장&addr=제주시 이도2동&lat=33.5005&lng=126.5325&id=P1")!;
    const locate = vi.fn(async (): Promise<LocationResult> => ({ kind: "ok", location: AIRPORT.location, accuracyMeters: 20 }));
    render(<TripForm onRequestRoute={onRequestRoute} locate={locate} initialDestination={target} autoStart />);
    expect(screen.getByText("시청 공영주차장")).toBeTruthy();
    expect(screen.getByText(/교통 현황에서 고른 주차장/)).toBeTruthy();
    await waitFor(() => expect(onRequestRoute).toHaveBeenCalledTimes(1));
    expect(locate).toHaveBeenCalledTimes(1);
    expect(onRequestRoute.mock.calls[0]![1]).toBe(target);
    // 이후에는 버튼으로만 조회
    fireEvent.click(routeButton());
    expect(onRequestRoute).toHaveBeenCalledTimes(2);
  });

  it("위치를 못 받으면 자동 조회하지 않고 직접 검색 안내", async () => {
    const onRequestRoute = vi.fn();
    const target = readRouteTarget("?to=시청 공영주차장&lat=33.5005&lng=126.5325")!;
    render(<TripForm onRequestRoute={onRequestRoute} locate={async () => ({ kind: "denied" })} initialDestination={target} autoStart />);
    expect(await screen.findByText(/위치 권한이 거부되었습니다/)).toBeTruthy();
    expect(onRequestRoute).not.toHaveBeenCalled();
  });
});
