import { expect, test, type Page } from "@playwright/test";
import { newClientContext, shot, uniqueClient } from "./client";

const AIRPORT = { latitude: 33.5066, longitude: 126.4929 };

async function pickDestination(page: Page, query: string, name: string) {
  await page.getByRole("searchbox", { name: "목적지" }).fill(query);
  await page.getByRole("searchbox", { name: "목적지" }).press("Enter");
  await page.getByRole("list", { name: "목적지 검색 결과" }).getByText(name).click();
}

test.describe("출발지·목적지 선택 (모바일 390×844)", () => {
  test.beforeEach(async ({ page }) => page.setExtraHTTPHeaders(uniqueClient()));
  test("위치 권한 허용 → 현재 위치 출발지, 목적지 선택, 경로 조회 버튼 활성", async ({ browser }) => {
    const context = await newClientContext(browser, { permissions: ["geolocation"], geolocation: { ...AIRPORT, accuracy: 15 } });
    const page = await context.newPage();
    await page.goto("/");
    await shot(page, "TASK-004-01-initial");

    await page.getByRole("button", { name: "현재 위치 사용" }).click();
    await expect(page.getByText("현재 위치", { exact: true })).toBeVisible();
    await expect(page.getByText("오차 약 ±15m")).toBeVisible();

    await page.getByRole("searchbox", { name: "목적지" }).fill("성산");
    await page.getByRole("searchbox", { name: "목적지" }).press("Enter");
    await expect(page.getByRole("list", { name: "목적지 검색 결과" })).toBeVisible();
    await shot(page, "TASK-004-02-results");

    await page.getByRole("list", { name: "목적지 검색 결과" }).getByText("성산일출봉").click();
    const route = page.getByRole("button", { name: "경로 조회" });
    await expect(route).toBeEnabled();
    await shot(page, "TASK-004-03-ready");

    await route.click();
    await expect(page.getByRole("region", { name: "경로 비교" })).toBeVisible();
    await context.close();
  });

  test("위치 권한 거부 → 안내 후 출발지 직접 검색", async ({ browser }) => {
    const context = await newClientContext(browser, { permissions: [] });
    const page = await context.newPage();
    await page.goto("/");
    await page.getByRole("button", { name: "현재 위치 사용" }).click();
    await expect(page.getByText("위치 권한이 거부되었습니다. 출발지를 직접 검색하세요.")).toBeVisible();
    await expect(page.getByRole("searchbox", { name: "출발지" })).toBeVisible();
    await shot(page, "TASK-004-04-denied");

    await page.getByRole("searchbox", { name: "출발지" }).fill("공항");
    await page.getByRole("searchbox", { name: "출발지" }).press("Enter");
    await page.getByRole("list", { name: "출발지 검색 결과" }).getByText("제주국제공항").click();
    await pickDestination(page, "서귀포", "서귀포시청 제1청사");
    await expect(page.getByRole("button", { name: "경로 조회" })).toBeEnabled();
    await context.close();
  });

  test("제주 밖 위치 → 안내 후 직접 검색", async ({ browser }) => {
    const context = await newClientContext(browser, {
      permissions: ["geolocation"],
      geolocation: { latitude: 37.5665, longitude: 126.978, accuracy: 10 },
    });
    const page = await context.newPage();
    await page.goto("/");
    await page.getByRole("button", { name: "현재 위치 사용" }).click();
    await expect(page.getByText("현재 위치가 제주 밖입니다. 출발지를 직접 검색하세요.")).toBeVisible();
    await expect(page.getByRole("searchbox", { name: "출발지" })).toBeVisible();
    await context.close();
  });

  test("정확도 부족 → 재확인 안내", async ({ browser }) => {
    const context = await newClientContext(browser, { permissions: ["geolocation"], geolocation: { ...AIRPORT, accuracy: 850 } });
    const page = await context.newPage();
    await page.goto("/");
    await page.getByRole("button", { name: "현재 위치 사용" }).click();
    await expect(page.getByText(/위치가 정확하지 않습니다/)).toBeVisible();
    await expect(page.getByRole("button", { name: "현재 위치 다시 확인" })).toBeVisible();
    await shot(page, "TASK-004-05-inaccurate");
    await context.close();
  });

  test("검색 결과 없음 / 조회 제한 안내", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("searchbox", { name: "목적지" }).fill("없는장소이름");
    await page.getByRole("searchbox", { name: "목적지" }).press("Enter");
    await expect(page.getByText("제주에서 검색 결과가 없습니다.")).toBeVisible();
    await shot(page, "TASK-004-06-empty");

    await page.route("**/api/places?*", (route) =>
      route.fulfill({
        status: 429,
        json: {
          error: {
            code: "QUOTA_BLOCKED",
            message: "오늘 사용할 수 있는 조회 한도에 도달했습니다.",
            retryAfter: "2026-10-19T15:00:00.000Z",
          },
        },
      }),
    );
    await page.getByRole("searchbox", { name: "목적지" }).fill("공항");
    await page.getByRole("searchbox", { name: "목적지" }).press("Enter");
    await expect(page.getByRole("alert")).toContainText("(10월 20일 00:00 이후 다시 사용 가능)");
    await shot(page, "TASK-004-07-quota");
  });

  test("출발지와 목적지가 같으면 조회 차단", async ({ browser }) => {
    const context = await newClientContext(browser, { permissions: ["geolocation"], geolocation: { ...AIRPORT, accuracy: 10 } });
    const page = await context.newPage();
    await page.goto("/");
    await page.getByRole("button", { name: "현재 위치 사용" }).click();
    await pickDestination(page, "공항", "제주국제공항");
    await expect(page.getByText("출발지와 목적지가 같습니다. 다른 목적지를 선택하세요.")).toBeVisible();
    await expect(page.getByRole("button", { name: "경로 조회" })).toBeDisabled();
    await context.close();
  });

  test("가로 스크롤이 생기지 않는다", async ({ page }) => {
    await page.goto("/");
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow).toBeLessThanOrEqual(0);
  });
});
