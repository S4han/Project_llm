import { expect, test } from "@playwright/test";
import { newClientContext, shot, uniqueClient } from "./client";

// 관광지 검색 페이지(TASK-031, 이전 TASK-029·030). 개발 서버의 /api/traffic/search는 모의 목록(비짓제주·관광공사·반려동물 동반여행)을 쓴다.
// 모의 관광지 3곳: 모의 사라봉(비짓제주·관광공사·관광공사 반려동물), 모의 성산 일출봉(서귀포), 모의 반려 승마장(관광공사 반려동물).
const CITY_HALL = { latitude: 33.4996, longitude: 126.5312, accuracy: 15 };
const MOBILE = { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 };

test.beforeEach(async ({ page }) => {
  await page.setExtraHTTPHeaders(uniqueClient());
  await page.route(/tile\.openstreetmap\.org|api\.vworld\.kr\/req\/wmts/, (route) => route.abort());
});

test.describe("관광지 검색 /search (TASK-031)", () => {
  test("처음엔 관광지 전체 → 관광지만 검색 → 카드(운영시간·주차·소요시간·반려동물·주변 맛집·숙소) → 주변 맛집·숙소 지도", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("button", { name: /^관광지 검색/ }).click();
    await expect(page).toHaveURL(/\/search$/);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("제주 관광지 검색");
    await expect(page.getByRole("status", { name: "검색 자료 상태" })).toContainText("제주 관광지 3곳(모의 데이터)");
    // 처음 열면 관광지 전체(음식점·숙소는 지도에 없음)
    const map = page.getByRole("region", { name: "관광지 검색 지도" });
    await expect(map).toHaveAttribute("data-facilities", "3");
    await expect(page.getByRole("heading", { name: "지도에 관광지 3곳" })).toBeVisible();
    await expect(page.getByRole("button", { name: /음식점|카페/ })).toHaveCount(0);
    await shot(page, "TASK-031-01-start-390");

    // 관광지만 검색: "모의"는 관광지 3곳(음식점 "모의 고기국수" 등은 나오지 않음)
    await page.getByRole("searchbox", { name: "관광지 검색어" }).fill("모의");
    await page.getByRole("button", { name: "검색", exact: true }).click();
    const results = page.getByRole("list", { name: "검색 결과" });
    await expect(results.getByRole("listitem")).toHaveCount(3);
    await expect(results).not.toContainText("고기국수");
    await expect(map).toHaveClass(/leaflet-container/);

    await results.getByRole("button", { name: /모의 사라봉/ }).click();
    const card = page.locator(".leaflet-popup .popup-card-lg");
    const tile = (label: string) => card.locator(".popup-card-tile").filter({ hasText: label });
    await expect(tile("이용시간")).toContainText("상시 개방");
    await expect(tile("주차")).toContainText("가능");
    // 위치 권한이 없는 브라우저: 소요시간은 위치 허용 시 표시
    await expect(tile("현재 위치에서")).toContainText("위치 허용 시 표시");
    await expect(tile("반려동물")).toContainText("전구역 동반가능");
    await expect(tile("주변 맛집 2km")).toContainText("2곳");
    await expect(tile("주변 숙소 2km")).toContainText("1곳");
    await expect(card).toContainText("모의 신산 호텔");
    // 지도 가장자리 관광지를 목록에서 골라도 큰 카드는 지도 안에 들어온다(TASK-031 점검: 왼쪽 잘림)
    await expect
      .poll(async () => {
        const c = await card.boundingBox();
        const m = await map.boundingBox();
        return c && m ? Math.min(c.x - m.x, m.x + m.width - (c.x + c.width), c.y - m.y) : -1;
      })
      .toBeGreaterThanOrEqual(0);
    await shot(page, "TASK-031-02-card-390");

    // 주변 맛집 지도에 보기 → 관광지·맛집 2곳, 주소에 남고 숙소로 바꾸기, 관광지로 돌아오기
    await tile("주변 맛집 2km").click();
    await expect(page).toHaveURL(/around=visitJeju%3AMOCK-V1&show=food/);
    await expect(page.getByRole("heading", { name: /모의 사라봉 주변 맛집 · 반경 2km 2곳/ })).toBeVisible();
    const aroundList = page.getByRole("list", { name: "주변 목록" });
    await expect(aroundList).toContainText("모의 바다 카페");
    await expect(aroundList).toContainText("모의 고기국수");
    await expect(map).toHaveAttribute("data-facilities", "3");
    await expect(map).toHaveAttribute("data-nearby", "1");
    await aroundList.getByRole("button", { name: /모의 고기국수/ }).click();
    await expect(page.locator(".leaflet-popup .popup-card-lg .popup-card-tile").filter({ hasText: "모의 사라봉에서" })).toContainText("km");
    await shot(page, "TASK-031-03-around-food-390");
    await page.getByRole("button", { name: "주변 숙소", exact: true }).click();
    await expect(page.getByRole("heading", { name: /모의 사라봉 주변 숙소 · 반경 2km 1곳/ })).toBeVisible();
    await expect(page).toHaveURL(/show=stay/);
    await page.getByRole("button", { name: "← 관광지로" }).click();
    await expect(page).toHaveURL(/\/search\?q=%EB%AA%A8%EC%9D%98$/);
    await expect(results.getByRole("listitem")).toHaveCount(3);

    // 반려동물 거르기: 관광공사 반려동물 동반여행·비짓제주 태그가 있는 관광지만
    await page.getByRole("button", { name: "🐾 반려동물 동반" }).click();
    await expect(page).toHaveURL(/pet=1/);
    await expect(results.getByRole("listitem")).toHaveCount(2);
    await expect(results).toContainText("모의 반려 승마장");
    // 검색 지우고 전체 보기: 반려동물 거르기만 남아 관광지 2곳
    await page.getByRole("button", { name: "검색 지우고 전체 보기" }).click();
    await expect(page.getByRole("heading", { name: "지도에 반려동물 동반 관광지 2곳" })).toBeVisible();
    await expect(map).toHaveAttribute("data-facilities", "2");

    await page.getByRole("button", { name: "🐾 반려동물 동반", pressed: true }).click();
    await page.getByRole("searchbox", { name: "관광지 검색어" }).fill("없는 장소 이름");
    await page.getByRole("button", { name: "검색", exact: true }).click();
    await expect(page.getByText("검색 결과가 없습니다.")).toBeVisible();
  });

  test("처음 화면의 관광지 점을 누르면 카드가 열린다(TASK-031 점검: 점을 눌러도 상세가 안 나옴)", async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.goto("/search");
    await expect(page.getByRole("region", { name: "관광지 검색 지도" })).toHaveAttribute("data-facilities", "3");
    // 캔버스에 그린 관광지 점(#4f46e5)을 화면 좌표로 찾는다.
    const dot = await page.evaluate(() => {
      const canvas = document.querySelector<HTMLCanvasElement>(".leaflet-facilities-pane canvas");
      const ctx = canvas?.getContext("2d");
      if (!canvas || !ctx) return null;
      const { data, width, height } = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const r = canvas.getBoundingClientRect();
      for (let y = 0; y < height; y++)
        for (let x = 0; x < width; x++) {
          const i = (y * width + x) * 4;
          if (Math.abs(data[i]! - 0x4f) < 6 && Math.abs(data[i + 1]! - 0x46) < 6 && Math.abs(data[i + 2]! - 0xe5) < 6) return { x: r.left + (x / width) * r.width + 2, y: r.top + (y / height) * r.height + 2 };
        }
      return null;
    });
    expect(dot).not.toBeNull();
    await page.mouse.click(dot!.x, dot!.y);
    const card = page.locator(".leaflet-popup .popup-card-lg");
    await expect(card).toBeVisible();
    await expect(card.locator(".popup-card-tile").filter({ hasText: "주변 맛집 2km" })).toBeVisible();
    expect(errors).toEqual([]);
  });

  test("위치 허용: 카드에 현재 위치에서 자동차 소요시간, 내 주변 반경 3km", async ({ browser }) => {
    const context = await newClientContext(browser, { permissions: ["geolocation"], geolocation: CITY_HALL, ...MOBILE });
    const page = await context.newPage();
    await page.route(/tile\.openstreetmap\.org|api\.vworld\.kr\/req\/wmts/, (route) => route.abort());
    await page.goto("/search?q=%EB%AA%A8%EC%9D%98%20%EC%82%AC%EB%9D%BC%EB%B4%89");
    const results = page.getByRole("list", { name: "검색 결과" });
    // 한 곳만 찾으면 확대 15로 맞춰 이름이 보인다(많이 확대하면 이름, TASK-031 1.(a))
    await expect(page.locator(".map-label").filter({ hasText: "모의 사라봉" })).toBeVisible();
    await results.getByRole("button", { name: /모의 사라봉/ }).click();
    const travel = page.locator(".leaflet-popup .popup-card-lg .popup-card-tile").filter({ hasText: "현재 위치에서" });
    await expect(travel).toContainText("약");
    await expect(travel).toContainText("모의 경로");
    await shot(page, "TASK-031-04-travel-390");

    await page.getByRole("button", { name: "검색 지우고 전체 보기" }).click();
    await page.getByRole("button", { name: "내 주변" }).click();
    await expect(page.getByRole("button", { name: "내 주변 ✓" })).toBeVisible();
    await expect(page.getByRole("heading", { name: /관광지 \d+곳/ })).toContainText("내 위치 반경 3km");
    // 서귀포(모의 성산 일출봉)는 반경 밖
    await expect(results).not.toContainText("모의 성산 일출봉");
    await expect(results.getByRole("listitem").first()).toContainText(/\d+(m|\.\dkm)/);
    await expect(page.getByRole("region", { name: "관광지 검색 지도" })).toHaveAttribute("data-nearby", "1");
    await context.close();
  });

  test("위치 거부: 내 주변 → 이유와 지역 고르기", async ({ browser }) => {
    const denied = await newClientContext(browser, { permissions: [] });
    const page = await denied.newPage();
    await page.route(/tile\.openstreetmap\.org|api\.vworld\.kr\/req\/wmts/, (route) => route.abort());
    await page.addInitScript(() => {
      Object.defineProperty(navigator, "geolocation", { value: { getCurrentPosition: (_ok: unknown, err: (e: { code: number }) => void) => err({ code: 1 }) } });
    });
    await page.goto("/search");
    await page.getByRole("button", { name: "내 주변" }).click();
    await expect(page.getByRole("alert").filter({ hasText: "위치 권한이 꺼져 있습니다" })).toBeVisible();
    await page.getByRole("group", { name: "지역 고르기" }).getByRole("button", { name: "제주시내" }).click();
    await expect(page.getByRole("heading", { name: /관광지 \d+곳/ })).toContainText("제주시내 반경 3km");
    await expect(page.getByRole("list", { name: "검색 결과" })).toContainText("모의 사라봉");
    await denied.close();
  });

  test("넓은 화면: 지도 왼쪽, 결과 오른쪽", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto("/search?q=%EB%AA%A8%EC%9D%98");
    await expect(page.getByRole("list", { name: "검색 결과" }).getByRole("listitem").first()).toBeVisible();
    const map = await page.getByRole("region", { name: "관광지 검색 지도" }).boundingBox();
    const list = await page.getByRole("list", { name: "검색 결과" }).boundingBox();
    expect(map && list && map.x < list.x).toBe(true);
    await shot(page, "TASK-031-05-wide");
  });
});
