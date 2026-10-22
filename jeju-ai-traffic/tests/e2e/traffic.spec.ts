import { expect, test } from "@playwright/test";
import { shot, uniqueClient } from "./client";

test.beforeEach(async ({ page }) => {
  await page.setExtraHTTPHeaders(uniqueClient());
  await page.route(/tile\.openstreetmap\.org|api\.vworld\.kr\/req\/wmts/, (route) => route.abort());
});

test.describe("교통 현황 대시보드 /traffic (TASK-012, 개발 서버 모의 사건)", () => {
  test("대시보드 → 경로 화면 링크, 카드 → 항목별 지도 페이지 → 대시보드·뒤로 가기 (TASK-025)", async ({ page }) => {
    // 첫 화면이 대시보드. 경로 추천으로 갔다가 돌아온다. 예전 /traffic 주소도 대시보드.
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
    // 모의 구간 속도 4개(원활 2·서행 1·정체 1), 모의 사건 2건
    await expect(page.getByRole("list", { name: "도로 소통 카드" }).getByRole("button")).toHaveText(["원활2구간30km/h 이상지도 보기 ›", "서행1구간15~30km/h지도 보기 ›", "정체1구간15km/h 미만지도 보기 ›"]);
    await expect(page.getByRole("button", { name: /^돌발·통제·공사/ })).toContainText("2건");
    await expect(page.getByRole("region", { name: "교통 현황 지도" })).toHaveCount(0);

    // 원활 카드 → /map/smooth: 원활 구간만, 도로 목록 → 도로 강조 → 전체 보기
    await page.getByRole("button", { name: /^원활/ }).click();
    await expect(page).toHaveURL(/\/map\/smooth$/);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("도로 소통 · 원활");
    const map = page.getByRole("region", { name: "교통 현황 지도" });
    await expect(map).toHaveAttribute("data-speed-lines", "2");
    const roadButton = page.getByRole("list", { name: "원활 도로 목록" }).getByRole("button", { name: /모의 공항로/ });
    await expect(roadButton).toContainText("모의 공항로 · 원활 1구간 · 평균 52km/h");
    await roadButton.click();
    await expect(page.getByRole("status").filter({ hasText: "구간 표시 중" })).toHaveText(/모의 공항로 원활 1구간 표시 중/);
    await shot(page, "TASK-012-04-road");
    await page.getByRole("status").filter({ hasText: "구간 표시 중" }).getByRole("button", { name: "전체 보기" }).click();
    await expect(page.getByText(/구간 표시 중/)).toHaveCount(0);

    // 뒤로 가기 → 대시보드, 돌발·통제·공사 카드 → 사건 지도·묶음 목록
    await page.goBack();
    await expect(page).toHaveURL(/\/traffic$/);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("제주 실시간 교통 현황");
    await page.getByRole("button", { name: /^돌발·통제·공사/ }).click();
    await expect(page).toHaveURL(/\/map\/incidents$/);
    const counts = page.getByRole("list", { name: "종류별 건수" }).getByRole("button");
    await expect(counts).toHaveText(["전체2", "돌발1", "통제0", "공사1"]);
    await expect(map.locator("path.incident-marker")).toHaveCount(2);
    await expect(map).toHaveAttribute("data-speed-lines", "0");
    await page.getByRole("button", { name: /정지차량 감지 1건/ }).click();
    await expect(page.getByRole("status").filter({ hasText: "지점 표시 중" })).toContainText("정지차량 감지 지점 표시 중");
    await expect(map.locator("path.incident-current")).toHaveCount(1);
    await expect(map.locator(".popup-card-kicker")).toHaveText("돌발 · 모의 데이터");
    await expect(map.locator(".popup-card-title")).toHaveText("정지차량");
    await shot(page, "TASK-012-02-focus");
    await counts.filter({ hasText: "공사" }).click();
    await expect(map.locator("path.incident-marker")).toHaveCount(1);
    await expect(page.getByText(/번째 지점 표시 중|지점 표시 중/)).toHaveCount(0);

    // ← 대시보드 버튼
    await page.getByRole("button", { name: "← 대시보드" }).click();
    await expect(page).toHaveURL(/\/$/);
    await expect(page.getByRole("list", { name: "도로 소통 카드" })).toBeVisible();
  });

  test("지도 페이지 주소로 바로 열기 (공유 링크)", async ({ page }) => {
    await page.goto("/map/congested");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("도로 소통 · 정체");
    await expect(page.getByRole("region", { name: "교통 현황 지도" })).toHaveAttribute("data-speed-lines", "1");
    await page.goto("/map/nothing");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("제주 실시간 교통 현황");
  });

  test("조회 한도면 정보 미확보 안내 (응답 대체)", async ({ page }) => {
    await page.route("**/api/traffic/incidents", (route) =>
      route.fulfill({ json: { incidents: [], status: "quotaBlocked", observedAt: null, retryAfter: "2026-10-20T15:00:00.000Z" } }),
    );
    await page.goto("/map/incidents");
    await expect(page.getByRole("alert")).toContainText("교통 사건 정보 미확보(오늘 조회 한도 도달");
    await expect(page.getByText(/감지된 돌발·통제·공사가 없습니다/)).toHaveCount(0);
  });

  test("화면 시계 1분 경과 시 자동 갱신", async ({ page }) => {
    await page.clock.install();
    let calls = 0;
    page.on("request", (r) => {
      if (r.url().includes("/api/traffic/incidents")) calls += 1;
    });
    await page.goto("/map/incidents");
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
    await page.goto("/");
    // 대시보드 카드와 지도 페이지 상태 칸 모두 한 줄
    const card = page.getByRole("button", { name: /^원활/ });
    await expect(card).toContainText("3,968구간");
    expect((await card.locator("span.tabular-nums").boundingBox())!.height).toBeLessThan(40);
    await card.click();
    const smooth = page.getByRole("list", { name: "구간 소통 건수" }).getByRole("button").first();
    await expect(smooth).toHaveText("원활3,968");
    const number = smooth.locator("span").last();
    const box = await number.boundingBox();
    expect(box!.height).toBeLessThan(32);
  });

  test("도로 모양을 늦게 받으면 처리 현황과 지도 안내, 받은 뒤 사라짐 (응답 지연)", async ({ page }) => {
    await page.route("**/api/traffic/links?*", async (route) => {
      const res = await route.fetch();
      await new Promise((r) => setTimeout(r, 2500));
      await route.fulfill({ response: res });
    });
    await page.goto("/map/smooth");
    const progress = page.getByRole("status", { name: "도로 소통 처리 현황" });
    await expect(progress).toContainText("① 도로 모양 불러오는 중…");
    await expect(progress).toContainText("② 구간 속도 ✓");
    await expect(page.getByText("도로 소통 불러오는 중…")).toBeVisible();
    await expect(progress).toContainText(/불러오는 중… [12]초/);
    await shot(page, "TASK-012-07-progress");
    await expect(progress).toHaveCount(0, { timeout: 10_000 });
    await expect(page.getByRole("region", { name: "교통 현황 지도" })).toHaveAttribute("data-speed-lines", "2");
  });

  test("교통시설물: 기본 꺼짐, 유형을 누르면 지도에 표시 (TASK-013, 개발 서버 모의)", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("button", { name: /^CCTV 등 교통시설물/ }).click();
    await expect(page).toHaveURL(/\/map\/facilities$/);
    const list = page.getByRole("list", { name: "교통시설물 유형" });
    const buttons = list.getByRole("button");
    await expect(buttons).toHaveText(["VMS2", "CCTV3", "웹카메라0", "영상VDS0", "AVI0", "신호제어기0", "RWIS1"]);
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
    await page.getByRole("button", { name: /^정체/ }).click();
    const speedCards = page.getByRole("list", { name: "구간 소통 건수" }).getByRole("button");
    await expect(speedCards).toHaveText(["원활2", "서행1", "정체1"]);
    const map = page.getByRole("region", { name: "교통 현황 지도" });

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
    await expect(page).toHaveURL(/\/map\/slow$/);
    await expect(page.getByRole("list", { name: "실시간 서행구간 목록" }).getByRole("button")).toHaveText(["모의 평화로서행모의 노형 → 모의 어승생22km/h지도 ›"]);
  });

});

test.describe("내 위치 반경: 주정차 단속·주차장·주유소·LPG·전기차 충전소 (TASK-016~019, 개발 서버 모의)", () => {
  // 모의 단속 3곳 중 2곳(시청·신설오름 부근, 약 0.6km)만 1km 안, 노형 부근은 밖인 위치
  test.use({ permissions: ["geolocation"], geolocation: { latitude: 33.502, longitude: 126.536, accuracy: 30 } });

  test("대시보드 내 주변 카드는 내 위치 기준 요약, 주정차 단속 페이지는 반경 1km 안만·원과 내 위치 (TASK-016·025)", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/");
    await expect(page.getByRole("status", { name: "대시보드 위치 기준" })).toHaveText("내 위치 기준(이 기기에서만 사용)");
    const cards = page.getByRole("list", { name: "내 주변 카드" }).getByRole("button");
    await expect(cards).toHaveText([
      "주정차 단속2곳반경 1km 안지도 보기 ›",
      "주차장2곳반경 1km · 무료 1곳지도 보기 ›",
      "주유소휘발유1,849원경유1,829원반경 3km 최저 · 3곳지도 보기 ›",
      "LPG 충전소1,178원반경 5km LPG 최저 · 1곳지도 보기 ›",
      "전기차 충전소1곳반경 1km 충전 가능 · 전체 3곳지도 보기 ›",
    ]);
    await cards.filter({ hasText: "주정차 단속" }).click();
    await expect(page).toHaveURL(/\/map\/enforcement$/);
    const map = page.getByRole("region", { name: "교통 현황 지도" });
    await expect(page.getByRole("status", { name: "내 위치 주변 조회 범위" })).toContainText("내 위치 반경 1km 안 주정차 단속 CCTV 2곳");
    await expect(map).toHaveAttribute("data-facilities", "2");
    await expect(map).toHaveAttribute("data-nearby", "1");
    await expect(page.getByText(/제주시 자료\(공공데이터포털\)로 서귀포시는 없고/)).toBeVisible();
    await shot(page, "TASK-025-03-enforcement");
  });

  test("내 위치 기준으로 열기(TASK-023): 위치를 허용하면 내 위치 중심 확대·파란 점, '제주 전체'로 전체 보기", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/map/incidents");
    const map = page.getByRole("region", { name: "교통 현황 지도" });
    const all = page.getByRole("button", { name: "제주 전체" });
    await expect(all).toBeVisible();
    await map.scrollIntoViewIfNeeded();
    await expect(map.locator(".leaflet-control-zoom-in")).toBeVisible();
    // 내 위치 파란 점이 지도 가운데에 있다
    const dot = map.locator('path.leaflet-interactive[fill="#2272eb"]');
    await expect(dot).toHaveCount(1);
    const box = (await map.boundingBox())!;
    const d = (await dot.boundingBox())!;
    expect(Math.abs(d.x + d.width / 2 - (box.x + box.width / 2))).toBeLessThan(10);
    expect(Math.abs(d.y + d.height / 2 - (box.y + box.height / 2))).toBeLessThan(10);
    if (process.env.SCREENSHOTS === "TASK-023") await map.screenshot({ path: "reports/screenshots/TASK-023-01-home.png" });
    await all.click();
    await page.waitForTimeout(500);
    // 제주 전체로 줄이면 내 위치 점은 가운데에서 벗어난다(제주시 북쪽)
    const d2 = (await dot.boundingBox())!;
    expect(box.y + box.height / 2 - (d2.y + d2.height / 2)).toBeGreaterThan(20);
    if (process.env.SCREENSHOTS === "TASK-023") await map.screenshot({ path: "reports/screenshots/TASK-023-02-jeju.png" });
  });

  test("주차장(TASK-017): 반경 1km 안 주차장만", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/map/parking");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("주차장");
    const status = page.getByRole("status", { name: "내 위치 주변 조회 범위" });
    await expect(status).toContainText("내 위치 반경 1km 안 주차장 2곳(무료 1곳)");
    const map = page.getByRole("region", { name: "교통 현황 지도" });
    await expect(map).toHaveAttribute("data-facilities", "2");
    await shot(page, "TASK-025-04-parking-1440");
  });

  test("주차장 요금 구분(TASK-022): 'P 유료'·'P 무료' 표시, 무료만 보기", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/map/parking");
    const map = page.getByRole("region", { name: "교통 현황 지도" });
    await expect(map.locator(".gas-pin")).toHaveCount(2);
    await expect(map.locator(".gas-pin", { hasText: "P유료" })).toHaveCount(1);
    await expect(map.locator(".gas-pin", { hasText: "P무료" })).toHaveCount(1);
    await map.scrollIntoViewIfNeeded();
    // 평소에는 "P"만 든 작은 동그라미(TASK-024), 확대 17 이상에서 "P 무료" 글자
    const free = map.locator(".gas-pin", { hasText: "P무료" });
    expect((await free.boundingBox())!.width).toBeLessThan(24);
    await expect(free.locator("strong")).toBeHidden();
    // 손가락이 동그라미에서 조금(9px) 빗나가도 주차장 카드가 열린다(TASK-024 점검: 아래 도로 선 카드가 열림)
    const fb = (await free.boundingBox())!;
    await page.mouse.click(fb.x + fb.width / 2 + 9, fb.y + fb.height / 2 + 9);
    await expect(page.locator(".leaflet-popup .popup-card .popup-card-kicker")).toHaveText("주차장");
    await page.locator(".leaflet-popup-close-button").click();
    if (process.env.SCREENSHOTS === "TASK-024") await map.screenshot({ path: "reports/screenshots/TASK-024-01-dots.png" });
    for (let i = 0; i < 4 && !/map-near/.test((await map.getAttribute("class")) ?? ""); i += 1) {
      await map.getByRole("button", { name: "Zoom in" }).click();
      await page.waitForTimeout(400);
    }
    await expect(map).toHaveClass(/map-near/);
    await expect(free.locator("strong")).toBeVisible();
    expect((await free.boundingBox())!.width).toBeGreaterThan(40);
    // 크게 확대해 원 밖 표시가 화면 밖으로 나가 있으니, 반경 원 전체 보기로 되돌린다(대시보드에 갔다가 다시 열기)
    await page.getByRole("button", { name: "← 대시보드" }).click();
    await page.getByRole("button", { name: /^주차장/ }).click();
    await expect(map).not.toHaveClass(/map-near/);
    if (process.env.SCREENSHOTS === "TASK-022") await map.screenshot({ path: "reports/screenshots/TASK-022-01-parking-fee.png" });
    await page.getByRole("button", { name: "P 무료만" }).click();
    await expect(page.getByRole("status", { name: "내 위치 주변 조회 범위" })).toContainText("내 위치 반경 1km 안 무료 주차장 1곳");
    await expect(map.locator(".gas-pin")).toHaveCount(1);
    await map.locator(".gas-pin").click();
    const card = page.locator(".leaflet-popup .popup-card");
    await expect(card.locator(".popup-card-title")).toHaveText("모의 신설오름 주차장");
    await expect(card).toContainText("무료");
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
    await page.goto("/map/parking");
    await expect(page.getByRole("status", { name: "내 위치 주변 조회 범위" })).toContainText("주차장 2곳");
    await page.getByRole("region", { name: "교통 현황 지도" }).scrollIntoViewIfNeeded();
    // 주차장은 요금 구분 표시(TASK-022)로 그린다. "P 유료" 표시를 누른다.
    await page.getByRole("region", { name: "교통 현황 지도" }).locator(".gas-pin", { hasText: "P유료" }).click();
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
    await page.goto("/map/gas");
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

  test("주유소 가격 표시 접기(TASK-021): 멀리 보면 최저가 한 곳만 가격, 나머지는 점, 확대하면 모두 가격", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/map/gas");
    const map = page.getByRole("region", { name: "교통 현황 지도" });
    await expect(map.locator(".gas-pin")).toHaveCount(3);
    await map.scrollIntoViewIfNeeded();
    const leaflet = map; // 지도 상자 자체가 Leaflet 컨테이너
    await expect(leaflet).toHaveClass(/map-far/); // 반경 3km 원이 보이게 맞추면 멀리 보는 수준
    const fold = map.locator(".gas-pin-fold");
    await expect(fold).toHaveCount(2);
    expect((await fold.first().boundingBox())!.width).toBeLessThan(20);
    expect((await map.locator(".gas-pin-low").boundingBox())!.width).toBeGreaterThan(60);
    if (process.env.SCREENSHOTS === "TASK-021") await map.screenshot({ path: "reports/screenshots/TASK-021-01-far.png" }); // 지도만
    for (let i = 0; i < 4 && /map-far/.test((await leaflet.getAttribute("class")) ?? ""); i += 1) {
      await map.getByRole("button", { name: "Zoom in" }).click();
      await page.waitForTimeout(400);
    }
    await expect(leaflet).not.toHaveClass(/map-far/);
    expect((await fold.first().boundingBox())!.width).toBeGreaterThan(40);
    if (process.env.SCREENSHOTS === "TASK-021") await map.screenshot({ path: "reports/screenshots/TASK-021-02-near.png" }); // 지도만
  });

  test("주유소 목록(TASK-018): 최저가가 맨 위에 강조, 줄을 누르면 지도에서 그 주유소 카드", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/map/gas");
    const rows = page.getByRole("list", { name: "주유소 목록" }).getByRole("button");
    await expect(rows).toHaveCount(3);
    await expect(rows.first()).toContainText("최저가");
    await expect(rows.first()).toContainText("모의 알뜰주유소");
    await expect(rows.nth(1)).toContainText("최저가보다 +");
    await page.getByRole("list", { name: "주유소 목록" }).scrollIntoViewIfNeeded();
    await shot(page, "TASK-018-03-list");
    await rows.nth(1).click();
    const card = page.locator(".leaflet-popup .popup-card");
    await expect(card).toBeVisible();
    await expect(card.locator(".popup-card-title")).toHaveText("모의 도남주유소");
  });

  test("LPG 충전소(TASK-018 범위 변경): 주유소와 따로 켜고, LPG 가격 표시·목록·카드", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/map/lpg");
    await expect(page.getByRole("status", { name: "내 위치 주변 조회 범위" })).toContainText("내 위치 반경 5km 안 LPG 충전소 1곳 · LPG 최저 1,178원");
    const map = page.getByRole("region", { name: "교통 현황 지도" });
    await expect(map.locator(".gas-pin")).toHaveCount(1);
    await expect(map.locator(".gas-pin-low")).toContainText("SKLPG 1,178최저");
    const rows = page.getByRole("list", { name: "LPG 충전소 목록" }).getByRole("button");
    await expect(rows).toHaveCount(1);
    await expect(rows.first()).toContainText("최저가");
    await rows.first().click();
    const card = page.locator(".leaflet-popup .popup-card");
    await expect(card.locator(".popup-card-kicker")).toHaveText("LPG 충전소 · SK가스");
    await expect(card).toContainText("반경 안 LPG 최저가");
    await expect(card.locator("dd").first()).toHaveText("1,178원/L");
    await page.locator(".leaflet-popup").scrollIntoViewIfNeeded();
    await shot(page, "TASK-018-04-lpg");
  });

  test("전기차 충전소(TASK-019): 반경 1km 충전 가능 수 표시, 목록(충전 가능 먼저)·급속만, 카드", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/map/ev");
    await expect(page.getByRole("status", { name: "내 위치 주변 조회 범위" })).toContainText("내 위치 반경 1km 안 전기차 충전소 3곳 · 충전 가능 1곳");
    const map = page.getByRole("region", { name: "교통 현황 지도" });
    await expect(map.locator(".gas-pin")).toHaveCount(3);
    await expect(map.locator(".gas-pin").filter({ hasText: "3/6" })).toHaveCount(1);
    const rows = page.getByRole("list", { name: "전기차 충전소 목록" }).getByRole("button");
    await expect(rows.first()).toContainText("모의 시청 공영주차장 충전소");
    await expect(rows.first()).toContainText("충전 가능");
    await page.getByRole("button", { name: "⚡ 급속만" }).click();
    await expect(rows).toHaveCount(2);
    await page.getByRole("list", { name: "전기차 충전소 목록" }).scrollIntoViewIfNeeded();
    await shot(page, "TASK-019-01-list");
    await rows.first().click();
    const card = page.locator(".leaflet-popup .popup-card");
    await expect(card.locator(".popup-card-kicker")).toHaveText("전기차 충전소 · 환경부");
    await expect(card.locator(".popup-card-stat")).toHaveText("3대 충전 가능");
    await expect(card.locator("dd").first()).toHaveText("급속 1/2 · 완속 2/4");
    await page.locator(".leaflet-popup").scrollIntoViewIfNeeded();
    await shot(page, "TASK-019-02-card");
  });

  test("관광지(TASK-026): 대시보드 카드 → 반경 5km 지도·가까운 순 목록, 누르면 이용시간·주차 카드", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/");
    const card = page.getByRole("button", { name: /^관광지/ });
    await expect(card).toHaveText("관광지2곳반경 5km 안지도 보기 ›");
    await card.click();
    await expect(page).toHaveURL(/\/map\/tour$/);
    await expect(page.getByRole("status", { name: "내 위치 주변 조회 범위" })).toContainText("내 위치 반경 5km 안 관광지 2곳");
    const map = page.getByRole("region", { name: "교통 현황 지도" });
    await expect(map.locator(".gas-pin")).toHaveCount(2);
    const rows = page.getByRole("list", { name: "관광지 목록" }).getByRole("button");
    await expect(rows.first()).toContainText("모의 신산공원");
    await rows.nth(1).click();
    const popup = page.locator(".leaflet-popup .popup-card");
    await expect(popup.locator(".popup-card-title")).toHaveText("모의 사라봉");
    await expect(popup.locator(".popup-card-tile").first()).toHaveText("관광지 주차가능한국관광공사");
    await expect(popup).toContainText("상시 개방");
    await expect(popup).toContainText("가능 (승용차 30대)");
    await expect(popup.locator(".popup-card-tile").nth(1)).toHaveText("주변 주차장 1km없음반경 1km 안");
    await expect(popup.getByRole("link", { name: "현재 위치에서 경로 안내" })).toHaveAttribute("href", /^\/route\?to=/);
    await page.locator(".leaflet-popup").scrollIntoViewIfNeeded();
    // 카드가 길어진 뒤 지도를 내려 카드 위쪽이 지도 안에 보인다
    await expect.poll(async () => (await page.locator(".leaflet-popup").boundingBox())!.y - (await map.boundingBox())!.y).toBeGreaterThanOrEqual(0);
    if (process.env.SCREENSHOTS === "TASK-026") await page.screenshot({ path: "reports/screenshots/TASK-026-01-tour-390.png", fullPage: true });
    await rows.first().click();
    // 앞 카드는 닫히며 잠깐(0.2초) 흐려지므로 새 카드만 본다
    await expect(page.locator(".leaflet-popup .popup-card-title", { hasText: "모의 신산공원" })).toBeVisible();
    const last = page.locator(".leaflet-popup .popup-card").last();
    await expect(last.locator(".popup-card-tile.tone-bad")).toHaveText("관광지 주차불가한국관광공사");
    // 관광지(모의 신산공원) 기준 반경 1km 주차장 2곳(가까운 순, 요금 구분)
    await expect(last.locator(".popup-card-tile").nth(1)).toHaveText("주변 주차장 1km2곳무료 1곳지도에 보기 ›");
    await expect(last).toContainText("모의 신설오름 주차장 · 120m · 무료");
    await expect(last).toContainText("모의 시청 공영주차장 · 710m · 유료");
  });

  test("관광지 주변 주차장(TASK-027): 카드의 '주변 주차장' 칸 → 관광지 기준 1km 주차장 지도·목록, 주차장 카드, 뒤로 가기", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/map/tour");
    const rows = page.getByRole("list", { name: "관광지 목록" }).getByRole("button");
    await rows.first().click(); // 모의 신산공원
    const go = page.locator(".leaflet-popup button.popup-card-tile-action", { hasText: "주변 주차장" });
    await expect(go).toHaveText("주변 주차장 1km2곳무료 1곳지도에 보기 ›");
    await go.click();
    await expect(page).toHaveURL(/\/map\/tour\?parking=MOCK-T2$/);
    await expect(page.getByRole("heading", { name: "모의 신산공원 주변 주차장" })).toBeVisible();
    await expect(page.getByRole("status", { name: "관광지 주변 주차장" })).toContainText("반경 1km 주차장 2곳(무료 1곳) 표시 중");
    const map = page.getByRole("region", { name: "교통 현황 지도" });
    await expect(map).toHaveAttribute("data-facilities", "3"); // 관광지 1 + 주차장 2
    await expect(page.locator(".leaflet-popup")).toHaveCount(0);
    const list = page.getByRole("list", { name: "관광지 주변 주차장 목록" }).getByRole("button");
    await expect(list).toHaveText(["P모의 신설오름 주차장120m · 무료 · 20면지도 ›", "P모의 시청 공영주차장710m · 유료 · 91면지도 ›"]);
    await map.scrollIntoViewIfNeeded();
    if (process.env.SCREENSHOTS === "TASK-027") await page.screenshot({ path: "reports/screenshots/TASK-027-01-spot-parking-390.png", fullPage: true });
    await list.nth(1).click();
    const card = page.locator(".leaflet-popup .popup-card").last();
    await expect(card.locator(".popup-card-kicker")).toHaveText("주차장");
    await expect(card.getByRole("link", { name: "현재 위치에서 경로 안내" })).toHaveAttribute("href", /^\/route\?to=/);
    await page.goBack();
    await expect(page).toHaveURL(/\/map\/tour$/);
    await expect(page.getByRole("status", { name: "내 위치 주변 조회 범위" })).toContainText("내 위치 반경 5km 안 관광지 2곳");
  });

  test("관광지 주변 숙소(TASK-028): 카드의 '주변 숙소' 칸 → 관광지 기준 2km 숙소 지도·목록·종류 거르기, 숙소 카드, 관광지 목록으로", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/map/tour");
    await page.getByRole("list", { name: "관광지 목록" }).getByRole("button").first().click(); // 모의 신산공원
    const go = page.locator(".leaflet-popup button.popup-card-tile-action", { hasText: "주변 숙소" });
    await expect(go).toContainText("주변 숙소 2km3곳");
    await go.click();
    await expect(page).toHaveURL(/\/map\/tour\?stay=MOCK-T2$/);
    await expect(page.getByRole("heading", { name: "모의 신산공원 주변 숙소" })).toBeVisible();
    await expect(page.getByRole("status", { name: "관광지 주변 숙소" })).toContainText("반경 2km 숙소 3곳 표시 중");
    const map = page.getByRole("region", { name: "교통 현황 지도" });
    await expect(map).toHaveAttribute("data-facilities", "4");
    const list = page.getByRole("list", { name: "관광지 주변 숙소 목록" }).getByRole("button");
    await expect(list).toHaveCount(3);
    await expect(list.first()).toContainText("모의 신산 호텔");
    await page.getByRole("list", { name: "숙소 종류" }).getByRole("button", { name: /^펜션/ }).click();
    await expect(list).toHaveCount(1);
    await expect(map).toHaveAttribute("data-facilities", "2");
    await page.getByRole("list", { name: "숙소 종류" }).getByRole("button", { name: /^전체/ }).click();
    await map.scrollIntoViewIfNeeded();
    if (process.env.SCREENSHOTS === "TASK-028") await page.screenshot({ path: "reports/screenshots/TASK-028-01-stays-390.png", fullPage: true });
    await list.first().click();
    const card = page.locator(".leaflet-popup .popup-card").last();
    await expect(card.locator(".popup-card-kicker")).toHaveText("숙소 · 호텔·리조트");
    await expect(card.locator(".popup-card-tile").first()).toHaveText("주차주차장 있음비짓제주 태그");
    await expect(card.getByRole("link", { name: "현재 위치에서 경로 안내" })).toHaveAttribute("href", /^\/route\?to=/);
    await expect(card.getByRole("link", { name: "비짓제주에서 자세히 보기 ↗" })).toHaveAttribute("target", "_blank");
    // 숙소 카드 위가 지도 안에 보인다
    await expect.poll(async () => (await page.locator(".leaflet-popup").last().boundingBox())!.y - (await map.boundingBox())!.y).toBeGreaterThanOrEqual(0);
    await page.locator(".leaflet-popup").last().scrollIntoViewIfNeeded();
    if (process.env.SCREENSHOTS === "TASK-028") await page.screenshot({ path: "reports/screenshots/TASK-028-02-stay-card-390.png", fullPage: true });
    await page.getByRole("button", { name: "관광지 목록으로" }).click();
    await expect(page).toHaveURL(/\/map\/tour$/);
  });
});
