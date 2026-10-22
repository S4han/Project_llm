import { expect, test } from "@playwright/test";
import { newClientContext, shot, uniqueClient } from "./client";

// 관광 통합 검색 페이지(TASK-029). 개발 서버의 /api/traffic/search는 모의 목록(비짓제주·관광공사)과 모의 카카오를 쓴다.
const CITY_HALL = { latitude: 33.4996, longitude: 126.5312, accuracy: 15 };

test.beforeEach(async ({ page }) => {
  await page.setExtraHTTPHeaders(uniqueClient());
  await page.route(/tile\.openstreetmap\.org|api\.vworld\.kr\/req\/wmts/, (route) => route.abort());
});

test.describe("관광 검색 /search (TASK-029)", () => {
  test("대시보드 카드 → 검색 → 같은 장소 합침·출처 표시 → 상세 카드 → 주소에 검색어", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("button", { name: /^관광 검색/ }).click();
    await expect(page).toHaveURL(/\/search$/);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("제주 관광 검색");
    await expect(page.getByRole("status", { name: "검색 자료 상태" })).toContainText(/비짓제주·한국관광공사 \d+곳\(모의 데이터\)/);
    await shot(page, "TASK-029-01-start-390");

    await page.getByRole("searchbox", { name: "관광 검색어" }).fill("모의 사라봉");
    await page.getByRole("button", { name: "검색", exact: true }).click();
    await expect(page).toHaveURL(/\/search\?q=%EB%AA%A8%EC%9D%98\+%EC%82%AC%EB%9D%BC%EB%B4%89$/);
    const results = page.getByRole("list", { name: "검색 결과" });
    // 비짓제주 "모의 사라봉"과 관광공사 "모의 사라봉 (제주시)"은 이름이 같고 100m 안이라 한 곳
    await expect(results.getByRole("listitem")).toHaveCount(1);
    await expect(results).toContainText("출처 비짓제주·한국관광공사");
    await results.getByRole("button", { name: /모의 사라봉/ }).click();
    const card = page.locator(".leaflet-popup .popup-card-lg");
    await expect(card).toContainText("관광지 · 비짓제주·한국관광공사");
    await expect(card).toContainText("064-000-0020");
    await expect(card.getByRole("link", { name: "비짓제주에서 자세히 보기 ↗" })).toHaveAttribute("href", "https://www.visitjeju.net/kr/detail/view?contentsid=MOCK-V1");
    await expect(card.getByRole("link", { name: "카카오맵 길찾기 ↗" })).toHaveAttribute("href", /^https:\/\/map\.kakao\.com\/link\/to\//);
    await expect(card.getByRole("link", { name: "현재 위치에서 경로 안내" })).toHaveAttribute("href", /^\/route\?to=/);
    // 큰 카드 위가 지도 밖으로 잘리지 않는다(지도를 내려 맞춘 뒤)
    await expect.poll(async () => ((await card.boundingBox())?.y ?? 0) - ((await page.getByRole("region", { name: "관광 검색 지도" }).boundingBox())?.y ?? 0)).toBeGreaterThanOrEqual(0);
    await shot(page, "TASK-029-02-card-390");

    // 새로 고쳐도 검색어가 남는다. 카테고리 카페: 비짓제주 카페 + 카카오 실시간 카페
    await page.goto("/search?q=%EB%AA%A8%EC%9D%98&cat=CAFE");
    await expect(page.getByRole("searchbox", { name: "관광 검색어" })).toHaveValue("모의");
    await expect(page.getByRole("button", { name: /카페/, pressed: true })).toBeVisible();
    await expect(results.getByRole("listitem")).toHaveCount(2);
    await expect(results).toContainText("모의 바다 카페");
    await expect(results).toContainText("모의 시청 커피");
    await expect(results).toContainText("출처 카카오");
    // 음식점: 비짓제주 "모의 고기국수"와 카카오 "모의 고기국수"(30m 안)는 한 곳
    await page.getByRole("button", { name: /음식점/ }).click();
    await expect(page).toHaveURL(/cat=RESTAURANT/);
    await expect(results.getByRole("button", { name: /모의 고기국수/ })).toHaveCount(1);
    await expect(results.getByRole("button", { name: /모의 고기국수/ })).toContainText("출처 비짓제주·카카오");
    await expect(results).toContainText("모의 흑돼지");
    await page.getByRole("button", { name: /^전체/ }).click();
    await expect(page).toHaveURL(/\/search\?q=%EB%AA%A8%EC%9D%98$/);
    await page.getByRole("searchbox", { name: "관광 검색어" }).fill("없는 장소 이름");
    await page.getByRole("button", { name: "검색", exact: true }).click();
    await expect(page.getByText("검색 결과가 없습니다.")).toBeVisible();
  });

  test("내 주변: 위치 허용이면 반경 3km 가까운 순과 거리, 거부면 지역 고르기", async ({ browser }) => {
    const context = await newClientContext(browser, { permissions: ["geolocation"], geolocation: CITY_HALL, viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
    const page = await context.newPage();
    await page.route(/tile\.openstreetmap\.org|api\.vworld\.kr\/req\/wmts/, (route) => route.abort());
    await page.goto("/search");
    await page.getByRole("button", { name: "내 주변" }).click();
    await expect(page.getByRole("button", { name: "내 주변 ✓" })).toBeVisible();
    await expect(page.getByRole("heading", { name: /검색 결과/ })).toContainText("내 위치 반경 3km");
    const results = page.getByRole("list", { name: "검색 결과" });
    // 서귀포(모의 성산 일출봉)는 반경 밖
    await expect(results).not.toContainText("모의 성산 일출봉");
    await expect(results.getByRole("listitem").first()).toContainText(/\d+m/);
    await expect(results).toContainText("모의 시청 커피");
    await expect(page.getByRole("region", { name: "관광 검색 지도" })).toHaveAttribute("data-nearby", "1");
    await shot(page, "TASK-029-03-near-390");
    await context.close();

    const denied = await newClientContext(browser, { permissions: [] });
    const p2 = await denied.newPage();
    await p2.route(/tile\.openstreetmap\.org|api\.vworld\.kr\/req\/wmts/, (route) => route.abort());
    await p2.addInitScript(() => {
      Object.defineProperty(navigator, "geolocation", { value: { getCurrentPosition: (_ok: unknown, err: (e: { code: number }) => void) => err({ code: 1 }) } });
    });
    await p2.goto("/search");
    await p2.getByRole("button", { name: "내 주변" }).click();
    await expect(p2.getByRole("alert").filter({ hasText: "위치 권한이 꺼져 있습니다" })).toBeVisible();
    await p2.getByRole("group", { name: "지역 고르기" }).getByRole("button", { name: "제주시내" }).click();
    await expect(p2.getByRole("heading", { name: /검색 결과/ })).toContainText("제주시내 반경 3km");
    await expect(p2.getByRole("list", { name: "검색 결과" })).toContainText("모의 사라봉");
    await denied.close();
  });

  test("넓은 화면: 지도 왼쪽, 결과 오른쪽", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto("/search?q=%EB%AA%A8%EC%9D%98");
    await expect(page.getByRole("list", { name: "검색 결과" }).getByRole("listitem").first()).toBeVisible();
    const map = await page.getByRole("region", { name: "관광 검색 지도" }).boundingBox();
    const list = await page.getByRole("list", { name: "검색 결과" }).boundingBox();
    expect(map && list && map.x < list.x).toBe(true);
    await shot(page, "TASK-029-04-wide");
  });
});
