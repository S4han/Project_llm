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
  await expect(section.getByRole("listitem")).toHaveCount(4);
  await expect(section.getByText("모의 데이터")).toBeVisible();
  await expect(section.getByRole("listitem").first().getByText("추천", { exact: true })).toBeVisible();
  await page.getByRole("region", { name: "경로 비교" }).scrollIntoViewIfNeeded();
  await page.screenshot({ path: `${SHOTS}/TASK-005-01-routes.png`, fullPage: true });
});

test("같은 쪽 이동: 경로 2개", async ({ page }) => {
  await setup(page, "성산", "성산일출봉");
  await page.getByRole("button", { name: "경로 조회" }).click();
  await expect(page.getByRole("region", { name: "경로 비교" }).getByRole("listitem")).toHaveCount(2);
});

test("단일 경로·동률 표시 (응답 대체)", async ({ page }) => {
  const at = "2026-10-19T07:05:00.000Z";
  const r = (id: string, label: string, d: number, m: number) => ({
    id, provider: "kakao", label, durationSeconds: d, distanceMeters: m, geometry: [], observedAt: at, trafficStatus: "unknown",
  });
  await page.route("**/api/routes/compare", (route) =>
    route.fulfill({
      json: {
        routes: [r("recommend", "카카오 추천", 4000, 50000), r("distance", "최단거리", 4000, 45000)],
        recommendedRouteId: "distance",
        tiedRouteIds: ["recommend", "distance"],
        observedAt: at,
        stale: false,
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
      json: { routes: [r("recommend", "카카오 추천", 4166, 52300)], recommendedRouteId: "recommend", tiedRouteIds: [], observedAt: at, stale: false },
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
