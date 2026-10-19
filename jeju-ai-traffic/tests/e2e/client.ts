import { randomUUID } from "node:crypto";
import type { Browser, BrowserContextOptions, Page } from "@playwright/test";

/** 테스트마다 다른 빈도 제한 키(개발 서버가 x-forwarded-for를 키로 쓴다). */
export function uniqueClient(): Record<string, string> {
  return { "x-forwarded-for": `e2e-${randomUUID()}` };
}

/** 고유 빈도 제한 키를 가진 새 브라우저 컨텍스트. */
export function newClientContext(browser: Browser, options: BrowserContextOptions = {}) {
  return browser.newContext({ ...options, extraHTTPHeaders: uniqueClient() });
}

/**
 * 화면 캡처. SCREENSHOTS 환경 변수가 파일 이름 앞부분과 맞을 때만 저장한다
 * (예: SCREENSHOTS=TASK-007 npm run test:e2e). 승인된 이전 TASK 캡처를 덮어쓰지 않기 위함.
 */
export async function shot(page: Page, name: string): Promise<void> {
  const only = process.env.SCREENSHOTS;
  if (!only || !name.startsWith(only)) return;
  await page.screenshot({ path: `reports/screenshots/${name}.png`, fullPage: true });
}
