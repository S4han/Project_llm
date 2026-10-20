import { useEffect, useRef, useState } from "react";
import type { Place } from "../../../../shared/contracts/place";
import { destinationText, kakaoMapRouteUrl, naverMapRouteUrl, toNavDestination } from "../../../../shared/rules/navLinks";
import { openAppLink } from "../../services/appLink";

type CopyState = "idle" | "copied" | "failed";

/** 외부 내비 연결(FR-008). 목적지만 전달하고, 경로가 다를 수 있음을 알린다. */
export function NavigationPanel({ destination }: { destination: Place }) {
  const dest = toNavDestination(destination);
  const [open, setOpen] = useState(false);
  const [appFailed, setAppFailed] = useState(false);
  const [copy, setCopy] = useState<CopyState>("idle");
  const cleanupRef = useRef<(() => void) | null>(null);
  useEffect(() => () => cleanupRef.current?.(), []);

  if (!dest) return null;
  const text = destinationText(dest);

  function openNaver() {
    if (!dest) return;
    setAppFailed(false);
    cleanupRef.current?.();
    cleanupRef.current = openAppLink(naverMapRouteUrl(dest, window.location.host), () => setAppFailed(true));
  }

  async function copyDestination() {
    try {
      await navigator.clipboard.writeText(text);
      setCopy("copied");
    } catch {
      setCopy("failed");
    }
  }

  return (
    <section aria-labelledby="nav-heading" className="flex flex-col gap-2">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="min-h-14 rounded-2xl bg-brand-700 text-[17px] font-semibold text-white active:bg-brand-800"
      >
        <span id="nav-heading">길 안내 시작</span>
      </button>
      {open && (
        <div className="flex flex-col gap-2 rounded-[20px] bg-white p-4">
          <p className="text-sm text-grey-700">
            <strong>{dest.name}</strong>까지 외부 내비로 안내합니다. 목적지만 전달하므로 <strong>외부 내비의 경로는 이 화면에서 고른 경로와 다를 수 있습니다.</strong>
          </p>
          <a
            href={kakaoMapRouteUrl(dest)}
            target="_blank"
            rel="noopener noreferrer"
            className="flex min-h-12 items-center justify-center rounded-2xl bg-yellow-300 font-semibold text-grey-900"
          >
            카카오맵으로 열기
          </a>
          <button type="button" onClick={openNaver} className="min-h-12 rounded-2xl bg-green-600 font-semibold text-white">
            네이버지도 앱으로 열기
          </button>
          {appFailed && (
            <p role="alert" className="rounded-2xl bg-amber-50 p-3 text-sm text-amber-900">
              앱이 열리지 않았나요? 카카오맵 웹 링크 또는 목적지 복사를 이용하세요.
            </p>
          )}
          <button type="button" onClick={copyDestination} className="min-h-12 rounded-2xl bg-grey-100 font-semibold text-grey-700">
            목적지 복사
          </button>
          {copy === "copied" && (
            <p role="status" className="text-sm text-brand-800">
              목적지를 복사했습니다. 사용하시는 내비에 붙여 넣어 검색하세요.
            </p>
          )}
          {copy === "failed" && (
            <div role="alert" className="flex flex-col gap-1 text-sm text-grey-700">
              <p>복사하지 못했습니다. 아래 내용을 길게 눌러 복사하거나, 내비에서 직접 검색하세요.</p>
              <textarea readOnly value={text} rows={2} aria-label="목적지" className="rounded border border-grey-300 p-2" />
            </div>
          )}
        </div>
      )}
    </section>
  );
}
