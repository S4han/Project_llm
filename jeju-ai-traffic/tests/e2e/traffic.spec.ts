import { expect, test } from "@playwright/test";
import { shot, uniqueClient } from "./client";

test.beforeEach(async ({ page }) => {
  await page.setExtraHTTPHeaders(uniqueClient());
  await page.route("https://tile.openstreetmap.org/**", (route) => route.abort());
});

test.describe("교통 현황 대시보드 /traffic (TASK-012, 개발 서버 모의 사건)", () => {
  test("경로 화면에서 링크로 이동, 건수·지도·묶음 목록, 지도에서 보기", async ({ page }) => {
    // 첫 화면이 교통 현황. 경로 추천으로 갔다가 돌아온다. 예전 /traffic 주소도 교통 현황.
    await page.goto("/");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("제주 실시간 교통 현황");
    await page.getByRole("link", { name: "경로 추천 →" }).click();
    await expect(page).toHaveURL(/\/route$/);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("제주 AI 교통 경로 추천");
    await page.getByRole("link", { name: "← 교통 현황" }).click();
    await expect(page).toHaveURL(/\/$/);
    await page.goto("/traffic");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("제주 실시간 교통 현황");
    await expect(page.getByText(/조회 · 모의 데이터/)).toBeVisible();

    const counts = page.getByRole("list", { name: "종류별 건수" }).getByRole("button");
    await expect(counts).toHaveText(["전체2", "돌발1", "통제0", "공사1"]);
    const map = page.getByRole("region", { name: "교통 현황 지도" });
    await expect(map.locator("path.incident-marker")).toHaveCount(2);
    // 모의 구간 속도 4개(원활 2·서행 1·정체 1)를 지도에 칠한다
    const speedCards = page.getByRole("list", { name: "구간 소통 건수" }).getByRole("button");
    await expect(speedCards).toHaveText(["전체4", "원활2", "서행1", "정체1"]);
    await expect(map).toHaveAttribute("data-speed-lines", "4");
    await shot(page, "TASK-012-01-dashboard");
    await shot(page, "TASK-012-03-speeds");

    // 원활 카드 → 원활 구간만, 도로 목록 → 도로 강조 → 전체 보기
    await speedCards.filter({ hasText: "원활" }).click();
    await expect(map).toHaveAttribute("data-speed-lines", "2");
    const roadButton = page.getByRole("list", { name: "원활 도로 목록" }).getByRole("button", { name: /모의 공항로/ });
    await expect(roadButton).toContainText("모의 공항로 · 원활 1구간 · 평균 52km/h");
    await roadButton.click();
    await expect(page.getByRole("status").filter({ hasText: "구간 표시 중" })).toHaveText(/모의 공항로 원활 1구간 표시 중/);
    await shot(page, "TASK-012-04-road");
    await page.getByRole("status").filter({ hasText: "구간 표시 중" }).getByRole("button", { name: "전체 보기" }).click();
    await expect(page.getByText(/구간 표시 중/)).toHaveCount(0);
    await speedCards.filter({ hasText: "전체" }).click();
    await expect(map).toHaveAttribute("data-speed-lines", "4");

    await page.getByRole("button", { name: /정지차량 감지 1건/ }).click();
    await expect(page.getByRole("status").filter({ hasText: "지점 표시 중" })).toContainText("정지차량 감지 지점 표시 중");
    await expect(map.locator("path.incident-current")).toHaveCount(1);
    await expect(map.locator(".popup-card-kicker")).toHaveText("돌발 · 모의 데이터");
    await expect(map.locator(".popup-card-title")).toHaveText("정지차량");
    await shot(page, "TASK-012-02-focus");

    await counts.filter({ hasText: "공사" }).click();
    await expect(map.locator("path.incident-marker")).toHaveCount(1);
    await expect(page.getByText(/번째 지점 표시 중|지점 표시 중/)).toHaveCount(0);

    await page.getByRole("link", { name: "경로 추천 →" }).click();
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

  test("구간이 1만 개가 넘어도 상태 카드 숫자가 한 줄 (좁은 휴대폰 폭 360px, 응답 대체)", async ({ page }) => {
    const ids = Array.from({ length: 11906 }, (_, i) => String(4050000000 + i));
    await page.route("**/api/traffic/links?*", (route) =>
      route.fulfill({ json: { links: ids.map((id) => [id, "도로", "_p~iF~ps|U_ulLnnqC"]), builtAt: new Date().toISOString(), source: "vworld" } }),
    );
    await page.route("**/api/traffic/speeds", (route) =>
      route.fulfill({ json: { status: "ok", observedAt: new Date().toISOString(), speeds: Object.fromEntries(ids.map((id, i) => [id, [i % 3 === 0 ? 10 : i % 3 === 1 ? 20 : 40, 60]])), source: "jejuIts", retryAfter: null } }),
    );
    await page.setViewportSize({ width: 360, height: 780 });
    await page.goto("/traffic");
    const all = page.getByRole("list", { name: "구간 소통 건수" }).getByRole("button").first();
    await expect(all).toHaveText("전체11,906");
    const number = all.locator("span").last();
    const box = await number.boundingBox();
    expect(box!.height).toBeLessThan(32);
  });

  test("도로 모양을 늦게 받으면 처리 현황과 지도 안내, 받은 뒤 사라짐 (응답 지연)", async ({ page }) => {
    await page.route("**/api/traffic/links?*", async (route) => {
      const res = await route.fetch();
      await new Promise((r) => setTimeout(r, 2500));
      await route.fulfill({ response: res });
    });
    await page.goto("/traffic");
    const progress = page.getByRole("status", { name: "도로 소통 처리 현황" });
    await expect(progress).toContainText("① 도로 모양 불러오는 중…");
    await expect(progress).toContainText("② 구간 속도 ✓");
    await expect(page.getByText("도로 소통 불러오는 중…")).toBeVisible();
    await expect(progress).toContainText(/불러오는 중… [12]초/);
    await shot(page, "TASK-012-07-progress");
    await expect(progress).toHaveCount(0, { timeout: 10_000 });
    await expect(page.getByRole("region", { name: "교통 현황 지도" })).toHaveAttribute("data-speed-lines", "4");
  });

  test("교통시설물: 기본 꺼짐, 유형을 누르면 지도에 표시 (TASK-013, 개발 서버 모의)", async ({ page }) => {
    await page.goto("/");
    const list = page.getByRole("list", { name: "교통시설물 유형" });
    const buttons = list.getByRole("button");
    await expect(buttons).toHaveText(["VMS2", "CCTV3", "웹카메라0", "영상VDS0", "AVI0", "신호제어기0", "RWIS1", "주정차 단속3", "주차장3", "주유소4"]);
    const map = page.getByRole("region", { name: "교통 현황 지도" });
    await expect(map).toHaveAttribute("data-facilities", "0");
    await list.getByRole("button", { name: /^CCTV/ }).click();
    await list.getByRole("button", { name: /VMS/ }).click();
    await expect(map).toHaveAttribute("data-facilities", "5");
    await expect(list.getByRole("button", { name: /^CCTV/ })).toHaveAttribute("aria-pressed", "true");
    await shot(page, "TASK-013-01-facilities");
    await list.getByRole("button", { name: /^CCTV/ }).click();
    await expect(map).toHaveAttribute("data-facilities", "2");
  });
  test("정체·서행 카드를 누르면 실시간 정체구간 목록, 누르면 지도 강조 (TASK-015, 개발 서버 모의)", async ({ page }) => {
    await page.goto("/");
    const speedCards = page.getByRole("list", { name: "구간 소통 건수" }).getByRole("button");
    await expect(speedCards).toHaveText(["전체4", "원활2", "서행1", "정체1"]);
    await expect(page.getByRole("list", { name: /구간 목록/ })).toHaveCount(0);
    const map = page.getByRole("region", { name: "교통 현황 지도" });

    await speedCards.filter({ hasText: "정체" }).click();
    await expect(map).toHaveAttribute("data-speed-lines", "1");
    const rows = page.getByRole("list", { name: "실시간 정체구간 목록" }).getByRole("button");
    await expect(rows).toHaveCount(1);
    await expect(rows.nth(0)).toContainText("모의 평화로정체모의 어승생 → 모의 서귀포9km/h");
    await shot(page, "TASK-015-01-list");
    await rows.nth(0).click();
    await expect(rows.nth(0)).toHaveAttribute("aria-pressed", "true");
    const bar = page.getByRole("status").filter({ hasText: "모의 서귀포 표시 중" });
    await expect(bar).toHaveText(/모의 평화로 정체 · 모의 어승생 → 모의 서귀포 표시 중/);
    await shot(page, "TASK-015-02-focus");
    await bar.getByRole("button", { name: "전체 보기" }).click();
    await expect(rows.nth(0)).toHaveAttribute("aria-pressed", "false");

    await speedCards.filter({ hasText: "서행" }).click();
    await expect(page.getByRole("list", { name: "실시간 서행구간 목록" }).getByRole("button")).toHaveText(["모의 평화로서행모의 노형 → 모의 어승생22km/h지도 ›"]);
  });

});

test.describe("내 위치 반경: 주정차 단속·주차장·주유소 (TASK-016·017·018, 개발 서버 모의)", () => {
  // 모의 단속 3곳 중 2곳(시청·신설오름 부근, 약 0.6km)만 1km 안, 노형 부근은 밖인 위치
  test.use({ permissions: ["geolocation"], geolocation: { latitude: 33.502, longitude: 126.536, accuracy: 30 } });

  test("켜면 현재 위치를 확인해 반경 1km 안만 지도에, 원과 내 위치 표시, 끄면 사라짐", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/");
    const list = page.getByRole("list", { name: "교통시설물 유형" });
    const enf = list.getByRole("button", { name: /주정차 단속/ });
    await expect(enf).toHaveText("주정차 단속3");
    const map = page.getByRole("region", { name: "교통 현황 지도" });
    await enf.click();
    await expect(page.getByRole("status", { name: "내 위치 주변 조회 범위" })).toContainText("내 위치 반경 1km 안 주정차 단속 CCTV 2곳");
    await expect(map).toHaveAttribute("data-facilities", "2");
    await expect(map).toHaveAttribute("data-nearby", "1");
    await expect(page.getByText(/켜면 현재 위치를 한 번 확인해 반경 안만/)).toBeVisible();
    await shot(page, "TASK-016-02-nearby");
    await enf.click();
    await expect(map).toHaveAttribute("data-facilities", "0");
    await expect(map).toHaveAttribute("data-nearby", "0");
  });

  test("주차장(TASK-017): 켜면 반경 1km 안 주차장만, 주정차 단속과 함께 켜기", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/");
    const list = page.getByRole("list", { name: "교통시설물 유형" });
    const park = list.getByRole("button", { name: /주차장/ });
    await expect(park).toHaveText("주차장3");
    await park.click();
    const status = page.getByRole("status", { name: "내 위치 주변 조회 범위" });
    await expect(status).toContainText("내 위치 반경 1km 안 주차장 2곳");
    const map = page.getByRole("region", { name: "교통 현황 지도" });
    await expect(map).toHaveAttribute("data-facilities", "2");
    await list.getByRole("button", { name: /주정차 단속/ }).click();
    await expect(status).toContainText("주정차 단속 CCTV 2곳 · 주차장 2곳");
    await expect(map).toHaveAttribute("data-facilities", "4");
    await shot(page, "TASK-017-01-parking");
  });

  test("주차장 팝업의 경로 안내 주소로 열면 목적지는 주차장, 출발지는 현재 위치로 바로 조회 (TASK-017)", async ({ page }) => {
    await page.goto("/route?to=%EB%AA%A8%EC%9D%98+%EC%8B%9C%EC%B2%AD+%EA%B3%B5%EC%98%81%EC%A3%BC%EC%B0%A8%EC%9E%A5&addr=%EC%A0%9C%EC%A3%BC%EC%8B%9C+%EB%AA%A8%EC%9D%98%EB%8F%99+10&lat=33.500500&lng=126.532500&id=MOCK-P1");
    await expect(page.getByText("모의 시청 공영주차장")).toBeVisible();
    await expect(page.getByText(/교통 현황에서 고른 주차장/)).toBeVisible();
    await expect(page.getByText("현재 위치", { exact: true })).toBeVisible();
    await expect(page.getByRole("region", { name: "경로 비교" })).toBeVisible();
    await expect(page.getByText("카카오 추천 경로(실시간 교통 반영)를 보여 줍니다. 다른 경로와는 비교하지 않습니다.")).toBeVisible();
    await shot(page, "TASK-017-02-route");
  });

  test("주차장 점을 누르면 카드 팝업(구분·면수·운영·주소·경로 안내 버튼) (TASK-017, 휴대폰 폭)", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/");
    await page.getByRole("list", { name: "교통시설물 유형" }).getByRole("button", { name: /주차장/ }).click();
    await expect(page.getByRole("status", { name: "내 위치 주변 조회 범위" })).toContainText("주차장 2곳");
    await page.getByRole("region", { name: "교통 현황 지도" }).scrollIntoViewIfNeeded();
    // 주차장 점(파란 테두리)을 캔버스에서 찾아 누른다
    await expect
      .poll(async () =>
        page.evaluate(() => {
          for (const c of Array.from(document.querySelectorAll(".leaflet-facilities-pane canvas")) as HTMLCanvasElement[]) {
            const d = c.getContext("2d")!.getImageData(0, 0, c.width, c.height).data;
            for (let p = 0; p < d.length; p += 4) if (d[p]! < 50 && d[p + 1]! > 60 && d[p + 1]! < 100 && d[p + 2]! > 200) return true;
          }
          return false;
        }),
      )
      .toBe(true);
    const pt = await page.evaluate(() => {
      for (const c of Array.from(document.querySelectorAll(".leaflet-facilities-pane canvas")) as HTMLCanvasElement[]) {
        const { width, height } = c;
        const d = c.getContext("2d")!.getImageData(0, 0, width, height).data;
        for (let y = 0; y < height; y++)
          for (let x = 0; x < width; x++) {
            const i = (y * width + x) * 4;
            if (d[i]! < 50 && d[i + 1]! > 60 && d[i + 1]! < 100 && d[i + 2]! > 200) {
              const r = c.getBoundingClientRect();
              return { x: r.left + (x / width) * r.width, y: r.top + (y / height) * r.height + 4 };
            }
          }
      }
      return null;
    });
    expect(pt).not.toBeNull();
    await page.mouse.click(pt!.x, pt!.y);
    const card = page.locator(".leaflet-popup .popup-card");
    await expect(card).toBeVisible();
    await expect(card.locator(".popup-card-kicker")).toHaveText("주차장");
    await expect(card).toContainText("실시간 남은 칸 정보는 없습니다.");
    const action = card.getByRole("link", { name: "현재 위치에서 경로 안내" });
    await expect(action).toHaveAttribute("href", /^\/route\?to=/);
    await expect(action).not.toHaveAttribute("target", "_blank");
    await page.locator(".leaflet-popup").scrollIntoViewIfNeeded();
    await shot(page, "TASK-017-03-popup");
  });

  test("주유소(TASK-018): 반경 3km 안 상표 색 가격 표시, 최저가 강조, 누르면 가격 카드", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/");
    await page.getByRole("list", { name: "교통시설물 유형" }).getByRole("button", { name: /주유소/ }).click();
    await expect(page.getByRole("status", { name: "내 위치 주변 조회 범위" })).toContainText("내 위치 반경 3km 안 주유소 3곳 · 휘발유 최저 1,849원");
    const map = page.getByRole("region", { name: "교통 현황 지도" });
    await expect(map.locator(".gas-pin")).toHaveCount(3);
    await expect(map.locator(".gas-pin-low")).toHaveCount(1);
    await expect(map.locator(".gas-pin-low")).toContainText("알뜰1,849최저");
    await map.scrollIntoViewIfNeeded();
    await map.locator(".gas-pin-low").click();
    const card = page.locator(".leaflet-popup .popup-card");
    await expect(card.locator(".popup-card-kicker")).toHaveText("주유소 · 알뜰주유소");
    await expect(card).toContainText("반경 안 휘발유 최저가");
    await expect(card.locator("dd").first()).toHaveText("1,849원/L");
    await expect(card.getByRole("link", { name: "현재 위치에서 경로 안내" })).toHaveAttribute("href", /^\/route\?to=/);
    await page.locator(".leaflet-popup").scrollIntoViewIfNeeded();
    await shot(page, "TASK-018-01-gas");
  });
});
