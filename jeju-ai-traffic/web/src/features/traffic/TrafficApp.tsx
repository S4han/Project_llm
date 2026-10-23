import { useCallback, useEffect, useState } from "react";
import { NearbyPicker, StartPage } from "../home/StartPage";
import { TrafficDashboard } from "./TrafficDashboard";
import { aroundFromLocation, pathOf, viewFromPath, type Around, type TrafficView } from "./views";

const fromLocation = () => ({ view: viewFromPath(window.location.pathname), around: aroundFromLocation(window.location.pathname, window.location.search) });

/**
 * 교통 현황 화면 전환(TASK-025). 대시보드와 항목별 지도 페이지는 주소가 따로 있지만(공유·뒤로 가기),
 * 같은 탭 안에서는 페이지를 새로 읽지 않고 바꿔서, 받아 둔 자료와 처음 확인한 위치를 그대로 쓴다(위치는 저장하지 않음).
 * 관광지 페이지의 "관광지 주변 주차장"(TASK-027)·"주변 숙소"(TASK-028)도 주소(?parking=·?stay=)에 남긴다.
 */
export function TrafficApp() {
  const [at, setAt] = useState(fromLocation);
  useEffect(() => {
    const onPop = () => setAt(fromLocation());
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);
  const navigate = useCallback((view: TrafficView, around: Around | null = null) => {
    window.history.pushState(null, "", pathOf(view, around));
    setAt({ view, around: view === "TOUR" ? around : null });
    window.scrollTo(0, 0);
  }, []);
  // 첫 화면(/)과 내 주변 고르기(/nearby)는 가벼운 화면(TASK-032). 교통 현황(/traffic)과 지도 페이지는 대시보드가 맡는다.
  if (at.view === "start") return <StartPage onNavigate={navigate} />;
  if (at.view === "nearby") return <NearbyPicker onNavigate={navigate} />;
  return <TrafficDashboard view={at.view} around={at.around} onNavigate={navigate} />;
}
