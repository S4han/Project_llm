// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { App } from "../../web/src/App";

afterEach(cleanup);

describe("App", () => {
  it("서비스 제목을 표시한다", () => {
    render(<App />);
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("제주 AI 교통 경로 추천");
    expect(screen.getByRole("button", { name: "경로 조회" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "← 교통 현황" }).getAttribute("href")).toBe("/");
  });

  it("위치 비저장·참고용 예상시간·데이터 출처를 고지한다 (TASK-011)", () => {
    render(<App />);
    const footer = screen.getByRole("contentinfo");
    expect(footer.textContent).toContain("위치는 경로 조회에만 쓰고 저장하지 않습니다");
    expect(footer.textContent).toContain("예상시간은 참고용입니다");
    for (const src of ["OpenStreetMap", "카카오모빌리티", "제주 ITS", "Cloudflare Workers AI"]) expect(footer.textContent).toContain(src);
  });
});
