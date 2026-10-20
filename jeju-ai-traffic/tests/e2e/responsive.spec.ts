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
  await page.route("https://tile.openstreetmap.org/**", (route) => route.abort());
});

async function noHorizontalScroll(page: Page) {
  const [scroll, inner] = await page.evaluate(() => [document.documentElement.scrollWidth, window.innerWidth]);
  expect(scroll).toBeLessThanOrEqual(inner);
}

for (const vp of WIDTHS) {
  test.describe(`${vp.name} ${vp.width}px`, () => {
    test.use({ viewport: { width: vp.width, height: vp.height } });

    test("교통 현황: 배치와 가로 스크롤 없음", async ({ page }) => {
      await page.goto("/traffic");
      const map = page.getByRole("region", { name: "교통 현황 지도" });
      const panel = page.getByRole("list", { name: "구간 소통 건수" });
      await expect(panel.getByRole("button").first()).toHaveText("전체4");
      await noHorizontalScroll(page);
      const m = (await map.boundingBox())!;
      const p = (await panel.boundingBox())!;
      if (vp.width >= 1280) {
        // 지도는 왼쪽, 정보 패널은 오른쪽. 지도는 화면 높이에 가깝게.
        expect(m.x + m.width).toBeLessThanOrEqual(p.x);
        expect(m.height).toBeGreaterThan(vp.height * 0.7);
      } else if (vp.width >= 768) {
        // 지도를 크게(화면 높이 약 60%), 도로 소통·사건 목록은 지도 아래 2단
        expect(m.height).toBeGreaterThan(vp.height * 0.5);
        const speeds = (await page.getByRole("region", { name: "도로 소통" }).boundingBox())!;
        const groups = (await page.getByRole("region", { name: /감지된 사건/ }).boundingBox())!;
        expect(speeds.y).toBeGreaterThan(m.y + m.height - 1);
        expect(Math.abs(speeds.y - groups.y)).toBeLessThan(2);
        expect(groups.x).toBeGreaterThan(speeds.x + speeds.width - 1);
      } else {
        // 휴대폰: 세로 한 줄(도로 소통 → 지도)
        expect(m.y).toBeGreaterThan(p.y);
      }
      await shot(page, `TASK-012-05-traffic-${vp.width}`);
    });

    test("경로 추천: 배치와 가로 스크롤 없음", async ({ page }) => {
      await page.goto("/");
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

  test("교통 현황 오른쪽 패널은 지도 높이에 맞춰 벌어지지 않는다", async ({ page }) => {
    await page.goto("/traffic");
    await expect(page.getByRole("list", { name: "구간 소통 건수" }).getByRole("button").first()).toHaveText("전체4");
    const title = (await page.getByRole("heading", { level: 1 }).boundingBox())!;
    const cards = (await page.getByRole("list", { name: "종류별 건수" }).boundingBox())!;
    expect(cards.y - (title.y + title.height)).toBeLessThan(120);
  });

  test("경로 추천 왼쪽 출발지는 결과가 길어도 제목 바로 아래", async ({ page }) => {
    await page.goto("/");
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
