// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MOCK_PLACES } from "../../api/_lib/providers/mockPlaces";
import type { RouteCompareResponse, RouteOption } from "../../shared/contracts/route";
import { App } from "../../web/src/App";

const OBSERVED = "2026-10-19T07:05:00.000Z"; // KST 16:05

function route(id: string, label: string, durationSeconds: number, distanceMeters: number): RouteOption {
  return { id, provider: "kakao", label, durationSeconds, distanceMeters, geometry: [], observedAt: OBSERVED, trafficStatus: "unknown" };
}

const FOUR: RouteCompareResponse = {
  routes: [
    route("recommend", "카카오 추천", 4166, 52300),
    route("distance", "최단거리", 4770, 43000),
    route("via1100", "1100도로 경유", 4961, 46900),
    route("via516", "516도로 경유", 4601, 43500),
  ],
  recommendedRouteId: "recommend",
  tiedRouteIds: [],
  observedAt: OBSERVED,
  stale: false,
};

let compare: () => Response;
let compareCalls = 0;
beforeEach(() => {
  compareCalls = 0;
  compare = () => Response.json(FOUR);
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string) => {
      if (input.startsWith("/api/routes/compare")) {
        compareCalls += 1;
        return compare();
      }
      const q = decodeURIComponent(new URL(input, "http://t").searchParams.get("q") ?? "");
      return Response.json({ query: q, places: MOCK_PLACES.filter((p) => p.name.includes(q)), observedAt: OBSERVED });
    }),
  );
  // 위치 권한 거부 → 출발지 직접 검색
  vi.stubGlobal("navigator", { geolocation: { getCurrentPosition: (_ok: unknown, fail: (e: { code: number }) => void) => fail({ code: 1 }) } });
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

async function pick(label: "출발지" | "목적지", q: string, name: string) {
  const box = screen.getByRole("searchbox", { name: label });
  fireEvent.change(box, { target: { value: q } });
  fireEvent.submit(box.closest("form")!);
  const list = await screen.findByRole("list", { name: `${label} 검색 결과` });
  fireEvent.click(within(list).getByText(name));
}

async function selectAndQuery() {
  render(<App />);
  fireEvent.click(screen.getByRole("button", { name: "직접 검색" }));
  await pick("출발지", "공항", "제주국제공항");
  await pick("목적지", "서귀포", "서귀포시청 제1청사");
  fireEvent.click(screen.getByRole("button", { name: "경로 조회" }));
}

describe("경로 조회 화면", () => {
  it("경로별 예상시간·거리, 추천 표시, 추천과의 차이, 조회 시각 (AC-003-02·05, AC-004-02·03)", async () => {
    await selectAndQuery();
    const section = await screen.findByRole("region", { name: "경로 비교" });
    expect(within(section).getByText("10월 19일 16:05 조회 기준 · 카카오모빌리티 예상시간")).toBeTruthy();
    const cards = within(section).getAllByRole("listitem");
    expect(cards.map((c) => c.getAttribute("aria-label"))).toEqual(["카카오 추천", "516도로 경유", "최단거리", "1100도로 경유"]);
    expect(within(cards[0]!).getByText("추천")).toBeTruthy();
    expect(within(cards[0]!).getByText("1시간 9분")).toBeTruthy();
    expect(cards[1]!.textContent).toContain("43.5km · 추천 경로보다 7분 느림");
    expect(cards[2]!.textContent).toContain("추천 경로보다 10분 느림");
    expect(screen.queryByText(/대체 경로 없음/)).toBeNull();
  });

  it("경로가 하나면 '대체 경로 없음' (AC-003-03)", async () => {
    compare = () => Response.json({ ...FOUR, routes: [FOUR.routes[0]] });
    await selectAndQuery();
    expect(await screen.findByText("대체 경로 없음: 제공된 경로가 하나입니다.")).toBeTruthy();
  });

  it("동률이면 안내와 '동률' 표시 (AC-004-04)", async () => {
    compare = () =>
      Response.json({
        ...FOUR,
        routes: [route("recommend", "카카오 추천", 4000, 50000), route("distance", "최단거리", 4000, 45000)],
        recommendedRouteId: "distance",
        tiedRouteIds: ["recommend", "distance"],
      });
    await selectAndQuery();
    expect(await screen.findByText("예상시간이 같은 경로가 있어 거리가 짧은 경로를 추천합니다.")).toBeTruthy();
    expect(screen.getAllByText("동률")).toHaveLength(2);
    expect(screen.getByRole("listitem", { name: "카카오 추천" }).textContent).toContain("추천 경로와 예상시간 같음");
  });

  it("장애면 오류와 '다시 시도', 다시 시도하면 결과 표시 (AC-003-04)", async () => {
    compare = () => Response.json({ error: { code: "PROVIDER_UNAVAILABLE", message: "일시적으로 정보를 가져올 수 없습니다." } }, { status: 503 });
    await selectAndQuery();
    expect((await screen.findByRole("alert")).textContent).toContain("일시적으로 정보를 가져올 수 없습니다.");
    compare = () => Response.json(FOUR);
    fireEvent.click(screen.getByRole("button", { name: "다시 시도" }));
    expect(await screen.findByRole("region", { name: "경로 비교" })).toBeTruthy();
    expect(compareCalls).toBe(2);
  });

  it("조회 제한이면 '다시 시도' 없이 재사용 시각", async () => {
    compare = () =>
      Response.json(
        { error: { code: "QUOTA_BLOCKED", message: "오늘 사용할 수 있는 조회 한도에 도달했습니다.", retryAfter: "2026-10-19T15:00:00.000Z" } },
        { status: 429 },
      );
    await selectAndQuery();
    expect((await screen.findByRole("alert")).textContent).toContain("10월 20일 00:00 이후 다시 사용 가능");
    expect(screen.queryByRole("button", { name: "다시 시도" })).toBeNull();
  });

  it("목적지 근처 도로 없음 안내", async () => {
    compare = () =>
      Response.json(
        { error: { code: "INVALID_INPUT", message: "목적지 근처에서 도로를 찾을 수 없습니다. 주차장·입구 등 도로와 가까운 장소를 선택하세요." } },
        { status: 400 },
      );
    await selectAndQuery();
    expect((await screen.findByRole("alert")).textContent).toContain("목적지 근처에서 도로를 찾을 수 없습니다");
    expect(screen.queryByRole("button", { name: "다시 시도" })).toBeNull();
  });

  it("목적지를 바꾸면 이전 결과를 지운다", async () => {
    await selectAndQuery();
    await screen.findByRole("region", { name: "경로 비교" });
    fireEvent.click(screen.getAllByRole("button", { name: "변경" })[1]!);
    await waitFor(() => expect(screen.queryByRole("region", { name: "경로 비교" })).toBeNull());
  });
});
