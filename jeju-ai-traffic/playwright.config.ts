import { defineConfig } from "@playwright/test";

// 브라우저 흐름 테스트. 개발 서버의 /api는 모의 공급자로 동작한다(외부 호출 없음).
export default defineConfig({
  testDir: "tests/e2e",
  outputDir: "test-results",
  reporter: "list",
  use: {
    baseURL: "http://localhost:4310",
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
    locale: "ko-KR",
    timezoneId: "Asia/Seoul",
  },
  webServer: {
    command: "npx vite --port 4310 --strictPort",
    url: "http://localhost:4310",
    reuseExistingServer: false,
  },
});
