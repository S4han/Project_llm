import { expect, test } from "@playwright/test";
import { shot, uniqueClient } from "./client";

// 첫 화면 단순화(TASK-032). 개발 서버는 모의 도로 소통(원활 2·서행 1·정체 1)·모의 사건 2건.
test.beforeEach(async ({ page }) => {
  await page.setExtraHTTPHeaders(uniqueClient());
  await page.route(/tile\.openstreetmap\.org|api\.vworld\.kr\/req\/wmts/, (route) => route.abort());
});

async function noHorizontalScroll(page: import("@playwright/test").Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);
}

test.describe("첫 화면 / (TASK-032)", () => {
  test("검색창·지금 도로·큰 버튼 4개, 위치를 묻지 않음, 출처 접힘", async ({ page, context }) => {
    let asked = false;
    await page.exposeFunction("__geoAsked", () => (asked = true));
    await page.addInitScript(() => {
      Object.defineProperty(navigator, "geolocation", { value: { getCurrentPosition: () => (window as unknown as { __geoAsked: () => void }).__geoAsked() } });
    });
    void context;
    await page.goto("/");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("제주 교통·관광");
    await expect(page.getByRole("img", { name: "원활 50% 서행 25% 정체 25%" })).toBeVisible();
    await expect(page.getByRole("button", { name: "돌발·통제·공사 2건 ›" })).toBeVisible();
    await expect(page.getByRole("navigation", { name: "바로 가기" }).getByRole("button")).toHaveCount(4);
    await expect(page.getByText("운전 중에는 화면을 조작하지 마세요.")).toBeVisible();
    await expect(page.getByText(/주정차 단속 CCTV 제주시/)).toBeHidden();
    await noHorizontalScroll(page);
    await shot(page, "TASK-032-01-start-390");
    await page.getByText("출처 보기").click();
    await expect(page.getByText(/주정차 단속 CCTV 제주시/)).toBeVisible();
    expect(asked).toBe(false);

    // 검색창 → 관광지 검색
    await page.getByRole("searchbox", { name: "관광지 검색어" }).fill("모의");
    await page.getByRole("button", { name: "검색", exact: true }).click();
    await expect(page).toHaveURL(/\/search\?q=%EB%AA%A8%EC%9D%98$/);
    await expect(page.getByRole("list", { name: "검색 결과" }).getByRole("listitem")).toHaveCount(3);
  });

  test("내 주변 → 고르기 → 주차장 지도, 뒤로 가기로 고르기·첫 화면", async ({ browser }) => {
    const context = await browser.newContext({ permissions: ["geolocation"], geolocation: { latitude: 33.5066, longitude: 126.4929, accuracy: 15 }, viewport: { width: 390, height: 844 }, extraHTTPHeaders: uniqueClient() });
    const page = await context.newPage();
    await page.route(/tile\.openstreetmap\.org|api\.vworld\.kr\/req\/wmts/, (route) => route.abort());
    await page.goto("/");
    await page.getByRole("button", { name: /^내 주변/ }).click();
    await expect(page).toHaveURL(/\/nearby$/);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("내 주변");
    await expect(page.getByRole("list", { name: "내 주변 종류" }).getByRole("button")).toHaveCount(5);
    await shot(page, "TASK-032-02-nearby-390");
    await page.getByRole("button", { name: /^주차장/ }).click();
    await expect(page).toHaveURL(/\/map\/parking$/);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("주차장");
    await expect(page.getByRole("region", { name: "교통 현황 지도" })).toBeVisible();
    await page.goBack();
    await expect(page).toHaveURL(/\/nearby$/);
    await page.goBack();
    await expect(page).toHaveURL(/\/$/);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("제주 교통·관광");
    await context.close();
  });

  test("도로 소통 → 정체 지도, 교통 현황 전체 보기 → 카드 화면(← 홈)", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("button", { name: /^도로 소통/ }).click();
    await expect(page).toHaveURL(/\/map\/congested$/);
    await page.goto("/");
    await page.getByRole("button", { name: "교통 현황 전체 보기 ›" }).click();
    await expect(page).toHaveURL(/\/traffic$/);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("제주 실시간 교통 현황");
    await page.getByRole("button", { name: "← 홈" }).click();
    await expect(page).toHaveURL(/\/$/);
  });

  test("넓은 화면: 가운데 좁은 칸, 가로 스크롤 없음", async ({ page }) => {
    await page.setViewportSize({ width: 1180, height: 820 });
    await page.goto("/");
    await expect(page.getByRole("img", { name: /원활/ })).toBeVisible();
    await noHorizontalScroll(page);
    const nav = (await page.getByRole("navigation", { name: "바로 가기" }).boundingBox())!;
    expect(nav.width).toBeLessThanOrEqual(700);
    await shot(page, "TASK-032-03-start-wide");
  });
});
