// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { APP_OPEN_TIMEOUT_MS, openAppLink } from "../../web/src/services/appLink";

let visibility: DocumentVisibilityState = "visible";
beforeEach(() => {
  vi.useFakeTimers();
  visibility = "visible";
  vi.spyOn(document, "visibilityState", "get").mockImplementation(() => visibility);
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("openAppLink (앱 미실행 감지)", () => {
  it("주소로 이동하고, 1.5초 뒤에도 페이지가 보이면 실패로 본다", () => {
    const navigate = vi.fn();
    const onFail = vi.fn();
    openAppLink("nmap://route/car?x", onFail, { doc: document, navigate });
    expect(navigate).toHaveBeenCalledWith("nmap://route/car?x");
    vi.advanceTimersByTime(APP_OPEN_TIMEOUT_MS - 1);
    expect(onFail).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(onFail).toHaveBeenCalledTimes(1);
    expect(APP_OPEN_TIMEOUT_MS).toBe(1500);
  });

  it("앱이 열려 페이지가 숨겨지면 실패로 보지 않는다", () => {
    const onFail = vi.fn();
    openAppLink("nmap://x", onFail, { doc: document, navigate: vi.fn() });
    visibility = "hidden";
    document.dispatchEvent(new Event("visibilitychange"));
    visibility = "visible";
    vi.advanceTimersByTime(APP_OPEN_TIMEOUT_MS * 2);
    expect(onFail).not.toHaveBeenCalled();
  });

  it("정리 함수를 부르면 판단을 멈춘다", () => {
    const onFail = vi.fn();
    const cleanup = openAppLink("nmap://x", onFail, { doc: document, navigate: vi.fn() });
    cleanup();
    vi.advanceTimersByTime(APP_OPEN_TIMEOUT_MS * 2);
    expect(onFail).not.toHaveBeenCalled();
  });
});
