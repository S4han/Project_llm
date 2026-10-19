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
  });
});
