import { randomUUID } from "node:crypto";
import type { Browser, BrowserContextOptions } from "@playwright/test";

/** 테스트마다 다른 빈도 제한 키(개발 서버가 x-forwarded-for를 키로 쓴다). */
export function uniqueClient(): Record<string, string> {
  return { "x-forwarded-for": `e2e-${randomUUID()}` };
}

/** 고유 빈도 제한 키를 가진 새 브라우저 컨텍스트. */
export function newClientContext(browser: Browser, options: BrowserContextOptions = {}) {
  return browser.newContext({ ...options, extraHTTPHeaders: uniqueClient() });
}
