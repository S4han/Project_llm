import { expect, test, type Page } from "@playwright/test";
import { newClientContext, shot, uniqueClient } from "./client";

const AIRPORT = { latitude: 33.5066, longitude: 126.4929 };

async function setup(page: Page, destinationQuery: string, destinationName: string) {
  await page.goto("/route");
  await page.getByRole("button", { name: "현재 위치 사용" }).click();
  await expect(page.getByText("현재 위치", { exact: true })).toBeVisible();
  await page.getByRole("searchbox", { name: "목적지" }).fill(destinationQuery);
  await page.getByRole("searchbox", { name: "목적지" }).press("Enter");
  await page.getByRole("list", { name: "목적지 검색 결과" }).getByText(destinationName).click();
}

test.use({ permissions: ["geolocation"], geolocation: { ...AIRPORT, accuracy: 15 } });
test.beforeEach(async ({ page }) => page.setExtraHTTPHeaders(uniqueClient()));

test("한라산 횡단도 카카오 추천 1개만, 경유 경로 없음 (개발 서버 모의 경로, TASK-011 경로방식 (a))", async ({ page }) => {
  await setup(page, "서귀포", "서귀포시청 제1청사");
  await page.getByRole("button", { name: "경로 조회" }).click();
  const section = page.getByRole("region", { name: "경로 비교" });
  await expect(section).toBeVisible();
  // 카드 안에 사건 목록(li)이 있으므로 경로 카드(직계 li)만 센다.
  const items = section.getByRole("list", { name: "경로 목록" }).locator(":scope > li");
  await expect(items).toHaveCount(1);
  await expect(items.first()).toHaveAccessibleName("카카오 추천");
  await expect(section.getByText(/조회 기준 · 모의 데이터/)).toBeVisible();
  await expect(section.getByText("카카오 추천 경로(실시간 교통 반영)를 보여 줍니다. 다른 경로와는 비교하지 않습니다.")).toBeVisible();
  await expect(page.getByText(/1100도로|516도로|최단거리/)).toHaveCount(0);
  await shot(page, "TASK-011-03-single-route");
});

test("같은 쪽 이동도 카카오 추천 1개", async ({ page }) => {
  await setup(page, "성산", "성산일출봉");
  await page.getByRole("button", { name: "경로 조회" }).click();
  await expect(page.getByRole("list", { name: "경로 목록" }).getByRole("listitem")).toHaveCount(1);
});

test("단일 경로·동률 표시 (응답 대체)", async ({ page }) => {
  const at = "2026-10-19T07:05:00.000Z";
  const r = (id: string, label: string, d: number, m: number) => ({
    id, provider: "kakao", label, durationSeconds: d, distanceMeters: m, geometry: [], observedAt: at, trafficStatus: "unknown", segments: [], incidentIds: [],
  });
  await page.route("**/api/routes/compare", (route) =>
    route.fulfill({
      json: {
        routes: [r("recommend", "카카오 추천", 4000, 50000), r("distance", "최단거리", 4000, 45000)],
        recommendedRouteId: "distance",
        tiedRouteIds: ["recommend", "distance"],
        observedAt: at,
        stale: false,
        incidents: [],
        incidentsStatus: "ok",
        incidentsObservedAt: at,
      },
    }),
  );
  await setup(page, "서귀포", "서귀포시청 제1청사");
  await page.getByRole("button", { name: "경로 조회" }).click();
  await expect(page.getByText("예상시간이 같은 경로가 있어 거리가 짧은 경로를 추천합니다.")).toBeVisible();
  await shot(page, "TASK-005-02-tie");

  await page.unroute("**/api/routes/compare");
  await page.route("**/api/routes/compare", (route) =>
    route.fulfill({
      json: { routes: [r("recommend", "카카오 추천", 4166, 52300)], recommendedRouteId: "recommend", tiedRouteIds: [], observedAt: at, stale: false, incidents: [], incidentsStatus: "ok", incidentsObservedAt: at },
    }),
  );
  await page.getByRole("button", { name: "경로 조회" }).click();
  await expect(page.getByText("카카오 추천 경로(실시간 교통 반영)를 보여 줍니다. 다른 경로와는 비교하지 않습니다.")).toBeVisible();
  await shot(page, "TASK-005-03-single");
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
  await shot(page, "TASK-005-04-error");
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
  await shot(page, "TASK-005-05-unreachable");
});

test.describe("지도 (OSM 타일 차단 상태)", () => {
  test.beforeEach(async ({ page }) => page.route("https://tile.openstreetmap.org/**", (route) => route.abort()));

  test("경로 선·혼잡 구간·사건 표시, 카드 선택 시 강조 변경, 배경 실패 안내 (AC-007-01~04)", async ({ page }) => {
    await setup(page, "서귀포", "서귀포시청 제1청사");
    await page.getByRole("button", { name: "경로 조회" }).click();
    const map = page.getByRole("region", { name: "경로 지도" });
    await expect(map).toBeVisible();
    // 선택(카카오 추천) 경로의 혼잡 구간이 그려진다. 모의 혼잡: 원활·서행 반복
    await expect(map.locator("path.route-seg")).not.toHaveCount(0);
    await expect(map.locator("path.route-seg-smooth")).not.toHaveCount(0);
    await expect(page.getByText("지도 배경을 불러오지 못했습니다", { exact: false })).toBeVisible();
    await shot(page, "TASK-006-01-map");
  });

  test("카카오 추천 경로의 모의 사건을 종류별로 묶어 표시", async ({ page }) => {
    await setup(page, "서귀포", "서귀포시청 제1청사");
    await page.getByRole("button", { name: "경로 조회" }).click();
    const card = page.getByRole("listitem", { name: "카카오 추천" });
    await expect(card).toContainText("확인된 교통 사건 2건");
    await expect(card).toContainText("정지차량 감지 1건");
    await expect(card).toContainText("공사 도로 공사 1건");
    await expect(card).toContainText("제주 ITS가 감지한 정보로, 발생 시각과 상세는 제공되지 않습니다");
    await expect(page.getByRole("region", { name: "경로 지도" }).locator("path.incident-marker")).toHaveCount(2);
    await card.scrollIntoViewIfNeeded();
    await shot(page, "TASK-011-02-incident-group");
  });

  test("사건 묶음을 누르면 지도에서 지점을 강조·확대, '다음 지점'·'전체 보기' (TASK-011 계획 (b))", async ({ page }) => {
    // 모의 정지차량 1곳에 같은 경로 위 1곳을 더해 '다음 지점'을 확인한다(응답 대체).
    await page.route("**/api/routes/compare", async (route) => {
      const body = await (await route.fetch()).json();
      const first = body.incidents.find((i: { kind: string }) => i.kind === "event");
      const extra = { ...first, id: "mock-event-2", location: { lat: 33.4687, lng: 126.503 } };
      body.incidents.push(extra);
      body.routes[0].incidentIds.push(extra.id);
      await route.fulfill({ json: body });
    });
    await setup(page, "서귀포", "서귀포시청 제1청사");
    await page.getByRole("button", { name: "경로 조회" }).click();
    const map = page.getByRole("region", { name: "경로 지도" });
    await expect(map.locator("path.incident-marker")).toHaveCount(3);
    await expect(map.locator("path.incident-current")).toHaveCount(0);

    await page.getByRole("button", { name: /정지차량 감지 2건/ }).click();
    const bar = page.getByRole("status").filter({ hasText: "번째 지점 표시 중" });
    await expect(bar).toContainText("정지차량 감지 1/2번째 지점 표시 중");
    await expect(map.locator("path.incident-current")).toHaveCount(1);
    await expect(map.locator("path.incident-focus")).toHaveCount(2);
    await expect(map.locator(".leaflet-popup-content")).toContainText("정지차량(모의 데이터) · 조회");
    await shot(page, "TASK-011-04-incident-focus");

    await bar.getByRole("button", { name: "다음 지점 ›" }).click();
    await expect(bar).toContainText("정지차량 감지 2/2번째 지점 표시 중");
    await expect(map.locator("path.incident-current")).toHaveCount(1);

    await bar.getByRole("button", { name: "전체 보기" }).click();
    await expect(page.getByText(/번째 지점 표시 중/)).toHaveCount(0);
    await expect(map.locator("path.incident-current")).toHaveCount(0);
    await expect(map.locator("path.incident-focus")).toHaveCount(0);
  });

  test("ITS 미확보와 오래된 정보 표시", async ({ page }) => {
    const old = new Date(Date.now() - 11 * 60_000).toISOString();
    await page.route("**/api/routes/compare", async (route) => {
      const res = await route.fetch();
      const body = await res.json();
      await route.fulfill({ json: { ...body, observedAt: old, incidents: [], incidentsStatus: "unavailable", incidentsObservedAt: null } });
    });
    await setup(page, "서귀포", "서귀포시청 제1청사");
    await page.getByRole("button", { name: "경로 조회" }).click();
    await expect(page.getByText(/교통 사건 정보 미확보\(조회 실패\)/)).toBeVisible();
    await expect(page.getByRole("alert")).toContainText("오래된 정보입니다(11분 전 조회)");
    await shot(page, "TASK-006-04-stale");
  });
});

test.describe("추천 이유", () => {
  test.beforeEach(async ({ page }) => page.route("https://tile.openstreetmap.org/**", (route) => route.abort()));

  test("AI 미설정: 규칙 기반 설명과 근거", async ({ page }) => {
    await setup(page, "서귀포", "서귀포시청 제1청사");
    await page.getByRole("button", { name: "경로 조회" }).click();
    const card = page.getByRole("region", { name: "추천 이유" });
    await expect(card.getByText("규칙 기반")).toBeVisible();
    await expect(card).toContainText("실시간 교통을 반영한 카카오 추천 경로의 예상 소요시간은");
    await expect(card.getByText("AI 설명 확인 중…")).toHaveCount(0);
    await card.getByText("근거 보기").click();
    await expect(card).toContainText("경로 조회 시각");
    await card.scrollIntoViewIfNeeded();
    await shot(page, "TASK-007-01-rules");
  });

  test("AI 설명(응답 대체): 'AI 생성' 표시", async ({ page }) => {
    await page.route("**/api/explanations", (route) =>
      route.fulfill({
        json: {
          explanation: {
            text: "카카오 추천 경로가 가장 빠르며, 서행 구간이 일부 있습니다.",
            source: "ai",
            evidence: ["(대체 응답) 근거"],
            generatedAt: new Date().toISOString(),
          },
          aiStatus: "used",
        },
      }),
    );
    await setup(page, "서귀포", "서귀포시청 제1청사");
    await page.getByRole("button", { name: "경로 조회" }).click();
    const card = page.getByRole("region", { name: "추천 이유" });
    await expect(card.getByText("AI 생성")).toBeVisible();
    await card.scrollIntoViewIfNeeded();
    await shot(page, "TASK-007-02-ai");
  });
});

test.describe("길 안내 시작 (FR-008)", () => {
  test("카카오맵 링크·네이버지도 앱 미실행 감지·목적지 복사", async ({ browser }) => {
    const context = await newClientContext(browser, {
      permissions: ["geolocation", "clipboard-read", "clipboard-write"],
      geolocation: { ...AIRPORT, accuracy: 15 },
    });
    const page = await context.newPage();
    await page.route("https://tile.openstreetmap.org/**", (route) => route.abort());
    await setup(page, "서귀포", "서귀포시청 제1청사");
    await page.getByRole("button", { name: "경로 조회" }).click();
    await page.getByRole("button", { name: "길 안내 시작" }).click();
    await expect(page.getByText(/외부 내비의 경로는 이 화면에서 고른 경로와 다를 수 있습니다/)).toBeVisible();

    const kakao = page.getByRole("link", { name: "카카오맵으로 열기" });
    await expect(kakao).toHaveAttribute("href", /^https:\/\/map\.kakao\.com\/link\/to\/.+,33\.254100,126\.560100$/);

    // Chromium에는 nmap:// 처리기가 없으므로 1.5초 뒤 대체 안내가 나와야 한다
    await page.getByRole("button", { name: "네이버지도 앱으로 열기" }).click();
    await expect(page.getByText("앱이 열리지 않았나요? 카카오맵 웹 링크 또는 목적지 복사를 이용하세요.")).toBeVisible({ timeout: 4000 });

    await page.getByRole("button", { name: "목적지 복사" }).click();
    await expect(page.getByText(/목적지를 복사했습니다/)).toBeVisible();
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe("서귀포시청 제1청사\n제주특별자치도 서귀포시 중앙로 105");
    await page.getByRole("button", { name: "길 안내 시작" }).scrollIntoViewIfNeeded();
    await shot(page, "TASK-008-01-nav");
    await context.close();
  });
});


test.describe("교통상황 재평가 (FR-009)", () => {
  test("시작 시 즉시 1회, 브라우저 시계 5분 경과 후 다시 1회 (purpose: reevaluation)", async ({ page }) => {
    await page.clock.install();
    await page.route("https://tile.openstreetmap.org/**", (route) => route.abort());
    const purposes: string[] = [];
    page.on("request", (req) => {
      if (req.url().endsWith("/api/routes/compare") && req.method() === "POST") {
        purposes.push((JSON.parse(req.postData() ?? "{}") as { purpose?: string }).purpose ?? "user");
      }
    });
    await setup(page, "서귀포", "서귀포시청 제1청사");
    await page.getByRole("button", { name: "경로 조회" }).click();
    const panel = page.getByRole("region", { name: "교통상황 재평가" });
    await panel.getByRole("button", { name: "모니터링 시작" }).click();
    await expect(panel.getByText(/선택 경로\(같은 방식으로 다시 조회\)/)).toBeVisible();
    await expect(panel.getByText(/다음 갱신 약 5분 후/)).toBeVisible();
    expect(purposes).toEqual(["user", "reevaluation"]);

    await page.clock.fastForward("05:01");
    await expect.poll(() => purposes.length).toBe(3);
    expect(purposes[2]).toBe("reevaluation");
    await panel.scrollIntoViewIfNeeded();
    await shot(page, "TASK-009-01-monitor");

    await panel.getByRole("button", { name: "중지" }).click();
    await expect(panel.getByText(/모니터링을 중지했습니다/)).toBeVisible();
    await page.clock.fastForward("10:00");
    expect(purposes).toHaveLength(3);
  });
});

test.describe("경로 변경 안내 (FR-010)", () => {
  // 조회는 카카오 추천 1개뿐이라(TASK-011 경로방식 (a)) 느린 경로 하나를 응답에 덧붙여 비교 규칙을 확인한다.
  test("느린 경로를 따라가면 안내, '변경'하면 지도 강조가 바뀐다 (응답 대체)", async ({ page }) => {
    await page.route("https://tile.openstreetmap.org/**", (route) => route.abort());
    await page.route("**/api/routes/compare", async (route) => {
      const body = await (await route.fetch()).json();
      const base = body.routes[0];
      const slow = { ...base, id: "via1100", label: "1100도로 경유", durationSeconds: base.durationSeconds + 900, geometry: [...base.geometry].reverse(), incidentIds: [] };
      await route.fulfill({ json: { ...body, routes: [base, slow] } });
    });
    await setup(page, "서귀포", "서귀포시청 제1청사");
    await page.getByRole("button", { name: "경로 조회" }).click();
    await page.getByRole("button", { name: /1100도로 경유/ }).click();
    const panel = page.getByRole("region", { name: "교통상황 재평가" });
    await panel.getByRole("button", { name: "모니터링 시작" }).click();
    const advice = panel.getByRole("alert", { name: "더 빠른 경로가 있습니다" });
    await expect(advice).toContainText(/카카오 추천 경로가 지금 경로보다 남은 시간 기준 약 \d+분 빠릅니다/);
    await panel.scrollIntoViewIfNeeded();
    await shot(page, "TASK-010-01-advice");

    await advice.getByRole("button", { name: "변경" }).click();
    await expect(panel.getByText(/카카오 추천 경로로 바꿨습니다/)).toBeVisible();
    await expect(page.getByRole("button", { name: /카카오 추천/ }).first()).toHaveAttribute("aria-pressed", "true");
    await expect(panel.getByText("현재 선택 경로가 가장 빠릅니다.")).toBeVisible();
  });
});

test("네트워크 단절: 갱신 실패를 알리고 조회한 경로는 유지 (EX-006, AC-011-08)", async ({ page, context }) => {
  await setup(page, "서귀포", "서귀포시청 제1청사");
  await page.getByRole("button", { name: "경로 조회" }).click();
  const cards = page.getByRole("list", { name: "경로 목록" }).locator(":scope > li");
  await expect(cards).toHaveCount(1);
  await context.setOffline(true);
  await page.getByRole("button", { name: "모니터링 시작" }).click();
  await expect(page.getByRole("alert").filter({ hasText: "갱신 실패" })).toContainText("네트워크 연결을 확인한 뒤 다시 시도하세요.");
  await expect(cards).toHaveCount(1);
  await shot(page, "TASK-011-01-offline");
  await page.getByRole("button", { name: "중지" }).click();
  await context.setOffline(false);
  await page.getByRole("button", { name: "다시 시작" }).click();
  await expect(page.getByText(/모니터링 중 · 다음 갱신 약/)).toBeVisible();
});
