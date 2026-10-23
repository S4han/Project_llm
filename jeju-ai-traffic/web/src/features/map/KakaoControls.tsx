import { useState } from "react";
import type { KakaoMaps, KMap } from "./kakaoSdk";

/** 지도 위 버튼(확대·축소, 일반/위성). 큰 카드가 열려 있으면 CSS가 감춘다. */
export function KakaoControls({ map, kakao: k }: { map: KMap | null; kakao: KakaoMaps }) {
  const [sky, setSky] = useState(false);
  if (!map) return null;
  const zoom = (d: number) => map.setLevel(Math.min(14, Math.max(1, map.getLevel() + d)), { animate: true });
  const pick = (next: boolean) => {
    setSky(next);
    map.setMapTypeId(next ? k.MapTypeId.HYBRID : k.MapTypeId.ROADMAP);
  };
  const seg = (on: boolean) => `min-h-9 px-3 text-sm font-semibold ${on ? "bg-brand-700 text-white" : "bg-white text-grey-800"}`;
  return (
    <div className="kmap-controls pointer-events-none absolute inset-0 z-[500]">
      <div role="group" aria-label="지도 종류" className="pointer-events-auto absolute top-2 right-2 flex overflow-hidden rounded-xl shadow-md ring-1 ring-grey-300">
        <button type="button" aria-pressed={!sky} onClick={() => pick(false)} className={seg(!sky)}>
          일반
        </button>
        <button type="button" aria-pressed={sky} onClick={() => pick(true)} className={seg(sky)}>
          위성
        </button>
      </div>
      <div className="pointer-events-auto absolute top-14 right-2 flex flex-col overflow-hidden rounded-xl bg-white shadow-md ring-1 ring-grey-300">
        <button type="button" aria-label="확대" onClick={() => zoom(-1)} className="h-11 w-11 text-xl font-bold text-grey-800">
          +
        </button>
        <button type="button" aria-label="축소" onClick={() => zoom(1)} className="h-11 w-11 border-t border-grey-200 text-xl font-bold text-grey-800">
          −
        </button>
      </div>
    </div>
  );
}
