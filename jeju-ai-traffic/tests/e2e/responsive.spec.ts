import { expect, test, type Page } from "@playwright/test";
import { shot, uniqueClient } from "./client";

// TASK-012 반응형: 휴대폰·아이패드 세로·아이패드 가로·PC
const WIDTHS = [
  { name: "phone", width: 390, height: 844 },
  { name: "tablet", width: 820, height: 1180 },
  { name: "tablet-landscape", width: 1180, height: 820 },
  { name: "desktop", width: 1440, height: 900 },
] as const;

test.use({ permissions: ["geolocation"], geolocation: { latitude: 33.5066, longitude: 126.4929, accuracy: 15 } });
test.beforeEach(async ({ page }) => {
  await page.setExtraHTTPHeaders(uniqueClient());
  await page.route(/tile\.openstreetmap\.org|api\.vworld\.kr\/req\/wmts/, (route) => route.abort());
});

async function noHorizontalScroll(page: Page) {
  const [scroll, inner] = await page.evaluate(() => [document.documentElement.scrollWidth, window.innerWidth]);
  expect(scroll).toBeLessThanOrEqual(inner);
}

for (const vp of WIDTHS) {
  test.describe(`${vp.name} ${vp.width}px`, () => {
    test.use({ viewport: { width: vp.width, height: vp.height } });

    test("교통 현황: 대시보드 카드와 지도 페이지 배치, 가로 스크롤 없음 (TASK-025, TASK-032부터 /traffic)", async ({ page }) => {
      await page.goto("/traffic");
      const speedCards = page.getByRole("list", { name: "도로 소통 카드" }).getByRole("button");
      await expect(speedCards.first()).toContainText("2구간");
      await expect(page.getByRole("list", { name: "내 주변 카드" }).getByRole("button")).toHaveCount(5);
      await expect(page.getByRole("region", { name: "교통 현황 지도" })).toHaveCount(0);
      await noHorizontalScroll(page);
      // 카드는 한 줄에 여러 장(휴대폰도 도로 소통 3장은 한 줄)
      const [c1, c3] = [(await speedCards.nth(0).boundingBox())!, (await speedCards.nth(2).boundingBox())!];
      expect(Math.abs(c1.y - c3.y)).toBeLessThan(2);
      await shot(page, `TASK-025-01-home-${vp.width}`);

      await speedCards.filter({ hasText: "정체" }).click();
      await expect(page).toHaveURL(/\/map\/congested$/);
      const map = page.getByRole("region", { name: "교통 현황 지도" });
      const panel = page.getByRole("region", { name: "도로 소통" });
      await expect(page.getByRole("list", { name: "실시간 정체구간 목록" })).toBeVisible();
      await noHorizontalScroll(page);
      const m = (await map.boundingBox())!;
      const p = (await panel.boundingBox())!;
      if (vp.width >= 1280) {
        // 지도는 왼쪽, 정보 패널은 오른쪽. 지도는 화면 높이에 가깝게.
        expect(m.x + m.width).toBeLessThanOrEqual(p.x);
        expect(m.height).toBeGreaterThan(vp.height * 0.7);
      } else {
        // 휴대폰·태블릿 세로: 제목 바로 아래 큰 지도, 그 아래 목록
        expect(m.height).toBeGreaterThan(vp.height * 0.5);
        expect(p.y).toBeGreaterThan(m.y + m.height - 1);
      }
      await shot(page, `TASK-025-02-congested-${vp.width}`);
    });

    test("경로 추천: 배치와 가로 스크롤 없음", async ({ page }) => {
      await page.goto("/route");
      await page.getByRole("button", { name: "현재 위치 사용" }).click();
      await page.getByRole("searchbox", { name: "목적지" }).fill("서귀포");
      await page.getByRole("searchbox", { name: "목적지" }).press("Enter");
      await page.getByRole("list", { name: "목적지 검색 결과" }).getByText("서귀포시청 제1청사").click();
      await page.getByRole("button", { name: "경로 조회" }).click();
      const map = page.getByRole("region", { name: "경로 지도" });
      const cards = page.getByRole("list", { name: "경로 목록" });
      await expect(cards.locator(":scope > li")).toHaveCount(1);
      await noHorizontalScroll(page);
      const m = (await map.boundingBox())!;
      const c = (await cards.boundingBox())!;
      const form = (await page.getByRole("region", { name: "출발지" }).boundingBox())!;
      if (vp.width >= 1024) {
        // 왼쪽 입력, 가운데 조회 정보·경로 카드, 오른쪽 지도
        expect(form.x + form.width).toBeLessThanOrEqual(c.x);
        expect(c.x + c.width).toBeLessThanOrEqual(m.x);
      } else if (vp.width >= 768) {
        // 왼쪽 입력, 오른쪽 결과(지도 위, 카드 아래)
        expect(form.x + form.width).toBeLessThanOrEqual(m.x);
        expect(c.y).toBeGreaterThan(m.y);
      } else {
        expect(m.y).toBeGreaterThan(form.y);
        expect(c.y).toBeGreaterThan(m.y);
      }
      await shot(page, `TASK-012-05-route-${vp.width}`);
    });
  });
}

test.describe("넓은 화면 간격", () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test("교통 현황 지도 페이지의 오른쪽 패널은 지도 높이에 맞춰 벌어지지 않는다", async ({ page }) => {
    await page.goto("/map/smooth");
    await expect(page.getByRole("list", { name: "구간 소통 건수" }).getByRole("button").first()).toHaveText("원활2");
    const title = (await page.getByRole("heading", { level: 1 }).boundingBox())!;
    // 맨 위 카드(도로 소통)는 제목·갱신 안내 바로 아래
    const first = (await page.getByRole("region", { name: "도로 소통" }).boundingBox())!;
    expect(first.y - (title.y + title.height)).toBeLessThan(140);
  });

  test("경로 추천 왼쪽 출발지는 결과가 길어도 제목 바로 아래", async ({ page }) => {
    await page.goto("/route");
    await page.getByRole("button", { name: "현재 위치 사용" }).click();
    await page.getByRole("searchbox", { name: "목적지" }).fill("서귀포");
    await page.getByRole("searchbox", { name: "목적지" }).press("Enter");
    await page.getByRole("list", { name: "목적지 검색 결과" }).getByText("서귀포시청 제1청사").click();
    await page.getByRole("button", { name: "경로 조회" }).click();
    await expect(page.getByRole("list", { name: "경로 목록" })).toBeVisible();
    const title = (await page.getByRole("heading", { level: 1 }).boundingBox())!;
    const origin = (await page.getByRole("region", { name: "출발지" }).boundingBox())!;
    expect(origin.y - (title.y + title.height)).toBeLessThan(60);
  });
});
