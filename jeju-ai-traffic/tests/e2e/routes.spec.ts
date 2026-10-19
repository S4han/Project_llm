import { expect, test, type Page } from "@playwright/test";
import { uniqueClient } from "./client";

const SHOTS = "reports/screenshots";
const AIRPORT = { latitude: 33.5066, longitude: 126.4929 };

async function setup(page: Page, destinationQuery: string, destinationName: string) {
  await page.goto("/");
  await page.getByRole("button", { name: "현재 위치 사용" }).click();
  await expect(page.getByText("현재 위치", { exact: true })).toBeVisible();
  await page.getByRole("searchbox", { name: "목적지" }).fill(destinationQuery);
  await page.getByRole("searchbox", { name: "목적지" }).press("Enter");
  await page.getByRole("list", { name: "목적지 검색 결과" }).getByText(destinationName).click();
}

test.use({ permissions: ["geolocation"], geolocation: { ...AIRPORT, accuracy: 15 } });
test.beforeEach(async ({ page }) => page.setExtraHTTPHeaders(uniqueClient()));

test("한라산 횡단: 경로 4개, 추천과 차이 표시 (개발 서버 모의 경로)", async ({ page }) => {
  await setup(page, "서귀포", "서귀포시청 제1청사");
  await page.getByRole("button", { name: "경로 조회" }).click();
  const section = page.getByRole("region", { name: "경로 비교" });
  await expect(section).toBeVisible();
  await expect(section.getByRole("list", { name: "경로 목록" }).getByRole("listitem")).toHaveCount(4);
  await expect(section.getByText("모의 데이터")).toBeVisible();
  await expect(section.getByRole("list", { name: "경로 목록" }).getByRole("listitem").first().getByText("추천", { exact: true })).toBeVisible();
  await page.getByRole("region", { name: "경로 비교" }).scrollIntoViewIfNeeded();
  await page.screenshot({ path: `${SHOTS}/TASK-005-01-routes.png`, fullPage: true });
});

test("같은 쪽 이동: 경로 2개", async ({ page }) => {
  await setup(page, "성산", "성산일출봉");
  await page.getByRole("button", { name: "경로 조회" }).click();
  await expect(page.getByRole("list", { name: "경로 목록" }).getByRole("listitem")).toHaveCount(2);
});

test("단일 경로·동률 표시 (응답 대체)", async ({ page }) => {
  const at = "2026-10-19T07:05:00.000Z";
  const r = (id: string, label: string, d: number, m: number) => ({
    id, provider: "kakao", label, durationSeconds: d, distanceMeters: m, geometry: [], observedAt: at, trafficStatus: "unknown", segments: [], incidentIds: [],
  });
  await page.route("**/api/routes/compare", (route) =>
    route.fulfill({
      json: {
        routes: [r("recommend", "카카오 추천", 4000, 50000), r("distance", "최단거리", 4000, 45000)],
        recommendedRouteId: "distance",
        tiedRouteIds: ["recommend", "distance"],
        observedAt: at,
        stale: false,
        incidents: [],
        incidentsStatus: "ok",
        incidentsObservedAt: at,
      },
    }),
  );
  await setup(page, "서귀포", "서귀포시청 제1청사");
  await page.getByRole("button", { name: "경로 조회" }).click();
  await expect(page.getByText("예상시간이 같은 경로가 있어 거리가 짧은 경로를 추천합니다.")).toBeVisible();
  await page.screenshot({ path: `${SHOTS}/TASK-005-02-tie.png`, fullPage: true });

  await page.unroute("**/api/routes/compare");
  await page.route("**/api/routes/compare", (route) =>
    route.fulfill({
      json: { routes: [r("recommend", "카카오 추천", 4166, 52300)], recommendedRouteId: "recommend", tiedRouteIds: [], observedAt: at, stale: false, incidents: [], incidentsStatus: "ok", incidentsObservedAt: at },
    }),
  );
  await page.getByRole("button", { name: "경로 조회" }).click();
  await expect(page.getByText("대체 경로 없음: 제공된 경로가 하나입니다.")).toBeVisible();
  await page.screenshot({ path: `${SHOTS}/TASK-005-03-single.png`, fullPage: true });
});

test("장애 → 다시 시도 → 성공", async ({ page }) => {
  let fail = true;
  await page.route("**/api/routes/compare", async (route) => {
    if (fail) return route.fulfill({ status: 503, json: { error: { code: "PROVIDER_UNAVAILABLE", message: "일시적으로 정보를 가져올 수 없습니다." } } });
    return route.continue();
  });
  await setup(page, "서귀포", "서귀포시청 제1청사");
  await page.getByRole("button", { name: "경로 조회" }).click();
  await expect(page.getByRole("button", { name: "다시 시도" })).toBeVisible();
  await page.screenshot({ path: `${SHOTS}/TASK-005-04-error.png`, fullPage: true });
  fail = false;
  await page.getByRole("button", { name: "다시 시도" }).click();
  await expect(page.getByRole("region", { name: "경로 비교" })).toBeVisible();
});

test("목적지 근처 도로 없음 안내", async ({ page }) => {
  await page.route("**/api/routes/compare", (route) =>
    route.fulfill({
      status: 400,
      json: { error: { code: "INVALID_INPUT", message: "목적지 근처에서 도로를 찾을 수 없습니다. 주차장·입구 등 도로와 가까운 장소를 선택하세요." } },
    }),
  );
  await setup(page, "성산", "성산일출봉");
  await page.getByRole("button", { name: "경로 조회" }).click();
  await expect(page.getByRole("alert")).toContainText("목적지 근처에서 도로를 찾을 수 없습니다");
  await expect(page.getByRole("button", { name: "다시 시도" })).toHaveCount(0);
  await page.screenshot({ path: `${SHOTS}/TASK-005-05-unreachable.png`, fullPage: true });
});

test.describe("지도 (OSM 타일 차단 상태)", () => {
  test.beforeEach(async ({ page }) => page.route("https://tile.openstreetmap.org/**", (route) => route.abort()));

  test("경로 선·혼잡 구간·사건 표시, 카드 선택 시 강조 변경, 배경 실패 안내 (AC-007-01~04)", async ({ page }) => {
    await setup(page, "서귀포", "서귀포시청 제1청사");
    await page.getByRole("button", { name: "경로 조회" }).click();
    const map = page.getByRole("region", { name: "경로 지도" });
    await expect(map).toBeVisible();
    // 선택(카카오 추천) 경로의 혼잡 구간이 그려진다. 모의 혼잡: 원활·서행 반복
    await expect(map.locator("path.route-seg")).not.toHaveCount(0);
    await expect(map.locator("path.route-seg-smooth")).not.toHaveCount(0);
    await expect(page.getByText("지도 배경을 불러오지 못했습니다", { exact: false })).toBeVisible();
    await page.screenshot({ path: `${SHOTS}/TASK-006-01-map.png`, fullPage: true });

    // 1100도로 경유(모의 혼잡: 전부 정보 미확보)를 선택하면 강조가 바뀐다
    await page.getByRole("button", { name: /1100도로 경유/ }).click();
    await expect(map.locator("path.route-seg-smooth")).toHaveCount(0);
    await expect(map.locator("path.route-seg-unknown")).not.toHaveCount(0);
    await expect(page.getByRole("button", { name: /1100도로 경유/ })).toHaveAttribute("aria-pressed", "true");
    await page.screenshot({ path: `${SHOTS}/TASK-006-02-select.png`, fullPage: true });
  });

  test("516도로 경유 선택 시 모의 공사 사건 표시", async ({ page }) => {
    await setup(page, "서귀포", "서귀포시청 제1청사");
    await page.getByRole("button", { name: "경로 조회" }).click();
    const card = page.getByRole("button", { name: /516도로 경유/ });
    await expect(card).toContainText("확인된 교통 사건 1건");
    await card.click();
    await expect(card).toContainText("공사 도로 공사");
    await expect(page.getByRole("region", { name: "경로 지도" }).locator("path.incident-marker")).toHaveCount(1);
    await card.scrollIntoViewIfNeeded();
    await page.screenshot({ path: `${SHOTS}/TASK-006-03-incident.png`, fullPage: true });
  });

  test("ITS 미확보와 오래된 정보 표시", async ({ page }) => {
    const old = new Date(Date.now() - 11 * 60_000).toISOString();
    await page.route("**/api/routes/compare", async (route) => {
      const res = await route.fetch();
      const body = await res.json();
      await route.fulfill({ json: { ...body, observedAt: old, incidents: [], incidentsStatus: "unavailable", incidentsObservedAt: null } });
    });
    await setup(page, "서귀포", "서귀포시청 제1청사");
    await page.getByRole("button", { name: "경로 조회" }).click();
    await expect(page.getByText(/교통 사건 정보 미확보\(조회 실패\)/)).toBeVisible();
    await expect(page.getByRole("alert")).toContainText("오래된 정보입니다(11분 전 조회)");
    await page.screenshot({ path: `${SHOTS}/TASK-006-04-stale.png`, fullPage: true });
  });
});
