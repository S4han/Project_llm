import { useCallback, useEffect, useState } from "react";
import { TrafficDashboard } from "./TrafficDashboard";
import { pathOf, viewFromPath, type TrafficView } from "./views";

/**
 * 교통 현황 화면 전환(TASK-025). 대시보드와 항목별 지도 페이지는 주소가 따로 있지만(공유·뒤로 가기),
 * 같은 탭 안에서는 페이지를 새로 읽지 않고 바꿔서, 받아 둔 자료와 처음 확인한 위치를 그대로 쓴다(위치는 저장하지 않음).
 */
export function TrafficApp() {
  const [view, setView] = useState<TrafficView>(() => viewFromPath(window.location.pathname));
  useEffect(() => {
    const onPop = () => setView(viewFromPath(window.location.pathname));
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);
  const navigate = useCallback((next: TrafficView) => {
    window.history.pushState(null, "", pathOf(next));
    setView(next);
    window.scrollTo(0, 0);
  }, []);
  return <TrafficDashboard view={view} onNavigate={navigate} />;
}
