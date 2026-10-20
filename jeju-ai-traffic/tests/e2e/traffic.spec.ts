import { expect, test } from "@playwright/test";
import { shot, uniqueClient } from "./client";

test.beforeEach(async ({ page }) => {
  await page.setExtraHTTPHeaders(uniqueClient());
  await page.route("https://tile.openstreetmap.org/**", (route) => route.abort());
});

test.describe("교통 현황 대시보드 /traffic (TASK-012, 개발 서버 모의 사건)", () => {
  test("경로 화면에서 링크로 이동, 건수·지도·묶음 목록, 지도에서 보기", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("link", { name: "교통 현황 →" }).click();
    await expect(page).toHaveURL(/\/traffic$/);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("제주 실시간 교통 현황");
    await expect(page.getByText(/조회 · 모의 데이터/)).toBeVisible();

    const counts = page.getByRole("list", { name: "종류별 건수" }).getByRole("button");
    await expect(counts).toHaveText(["전체2", "돌발1", "통제0", "공사1"]);
    const map = page.getByRole("region", { name: "교통 현황 지도" });
    await expect(map.locator("path.incident-marker")).toHaveCount(2);
    await shot(page, "TASK-012-01-dashboard");

    await page.getByRole("button", { name: /정지차량 감지 1건/ }).click();
    await expect(page.getByRole("status").filter({ hasText: "지점 표시 중" })).toContainText("정지차량 감지 지점 표시 중");
    await expect(map.locator("path.incident-current")).toHaveCount(1);
    await expect(map.locator(".leaflet-popup-content")).toContainText("정지차량(모의 데이터)");
    await shot(page, "TASK-012-02-focus");

    await counts.filter({ hasText: "공사" }).click();
    await expect(map.locator("path.incident-marker")).toHaveCount(1);
    await expect(page.getByText(/번째 지점 표시 중|지점 표시 중/)).toHaveCount(0);

    await page.getByRole("link", { name: "← 경로 추천" }).click();
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("제주 AI 교통 경로 추천");
  });

  test("조회 한도면 정보 미확보 안내 (응답 대체)", async ({ page }) => {
    await page.route("**/api/traffic/incidents", (route) =>
      route.fulfill({ json: { incidents: [], status: "quotaBlocked", observedAt: null, retryAfter: "2026-10-20T15:00:00.000Z" } }),
    );
    await page.goto("/traffic");
    await expect(page.getByRole("alert")).toContainText("교통 사건 정보 미확보(오늘 조회 한도 도달");
    await expect(page.getByText(/감지된 돌발·통제·공사가 없습니다/)).toHaveCount(0);
  });

  test("화면 시계 1분 경과 시 자동 갱신", async ({ page }) => {
    await page.clock.install();
    let calls = 0;
    page.on("request", (r) => {
      if (r.url().includes("/api/traffic/incidents")) calls += 1;
    });
    await page.goto("/traffic");
    await expect(page.getByRole("list", { name: "종류별 건수" }).getByRole("button").first()).toHaveText("전체2");
    // 개발 모드(StrictMode)는 처음에 두 번 조회할 수 있어 1분 뒤 늘어난 횟수만 본다.
    const before = calls;
    await page.clock.fastForward("01:01");
    await expect.poll(() => calls).toBe(before + 1);
  });
});
