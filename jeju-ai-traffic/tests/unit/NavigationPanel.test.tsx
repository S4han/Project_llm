// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Place } from "../../shared/contracts/place";

const openAppLink = vi.fn();
vi.mock("../../web/src/services/appLink", () => ({ openAppLink: (...args: unknown[]) => openAppLink(...args) }));
const { NavigationPanel } = await import("../../web/src/features/routes/NavigationPanel");

const DEST: Place = {
  id: "p",
  name: "서귀포시청 제1청사",
  address: "제주특별자치도 서귀포시 서귀동 314-1",
  roadAddress: "제주특별자치도 서귀포시 중앙로 105",
  location: { lat: 33.2541, lng: 126.5601 },
  provider: "kakaoLocal",
};

beforeEach(() => openAppLink.mockReset().mockReturnValue(() => {}));
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function openPanel() {
  render(<NavigationPanel destination={DEST} />);
  fireEvent.click(screen.getByRole("button", { name: "길 안내 시작" }));
}

describe("길 안내 시작 (FR-008)", () => {
  it("누르면 내비 선택과 경로 불일치 안내가 나온다 (AC-008-01·03)", () => {
    render(<NavigationPanel destination={DEST} />);
    const toggle = screen.getByRole("button", { name: "길 안내 시작" });
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(toggle);
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByText(/외부 내비의 경로는 이 화면에서 고른 경로와 다를 수 있습니다/)).toBeTruthy();
  });

  it("카카오맵 링크는 목적지만 담아 새 창으로 연다 (AC-008-02)", () => {
    openPanel();
    const link = screen.getByRole("link", { name: "카카오맵으로 열기" });
    expect(link.getAttribute("href")).toBe(`https://map.kakao.com/link/to/${encodeURIComponent("서귀포시청 제1청사")},33.254100,126.560100`);
    expect(link.getAttribute("target")).toBe("_blank");
    expect(link.getAttribute("rel")).toContain("noopener");
  });

  it("네이버지도는 앱 주소로 이동을 시도하고, 열리지 않으면 대체 안내 (AC-008-04)", () => {
    openPanel();
    fireEvent.click(screen.getByRole("button", { name: "네이버지도 앱으로 열기" }));
    const [url, onFail] = openAppLink.mock.calls[0]! as [string, () => void];
    expect(url).toMatch(/^nmap:\/\/route\/car\?dlat=33\.254100&dlng=126\.560100&dname=/);
    expect(screen.queryByRole("alert")).toBeNull();
    act(() => onFail());
    expect(screen.getByText("앱이 열리지 않았나요? 카카오맵 웹 링크 또는 목적지 복사를 이용하세요.")).toBeTruthy();
  });

  it("목적지 복사 성공 / 실패 시 직접 복사할 문구 표시 (AC-008-04)", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("navigator", { clipboard: { writeText } });
    openPanel();
    fireEvent.click(screen.getByRole("button", { name: "목적지 복사" }));
    expect(await screen.findByText(/목적지를 복사했습니다/)).toBeTruthy();
    expect(writeText).toHaveBeenCalledWith("서귀포시청 제1청사\n제주특별자치도 서귀포시 중앙로 105");

    cleanup();
    vi.stubGlobal("navigator", { clipboard: { writeText: vi.fn().mockRejectedValue(new Error("denied")) } });
    openPanel();
    fireEvent.click(screen.getByRole("button", { name: "목적지 복사" }));
    expect(await screen.findByText(/복사하지 못했습니다/)).toBeTruthy();
    expect((screen.getByRole("textbox", { name: "목적지" }) as HTMLTextAreaElement).value).toContain("중앙로 105");
  });

  it("제주 밖 목적지면 패널을 보여 주지 않는다", () => {
    render(<NavigationPanel destination={{ ...DEST, location: { lat: 37.5, lng: 127 } }} />);
    expect(screen.queryByRole("button", { name: "길 안내 시작" })).toBeNull();
  });
});
