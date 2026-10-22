import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { SearchPage } from "./features/search/SearchPage";
import { TrafficApp } from "./features/traffic/TrafficApp";
import "pretendard/dist/web/variable/pretendardvariable-dynamic-subset.css";
import "./index.css";

const root = document.getElementById("root");
if (!root) throw new Error("#root 요소가 없습니다.");

// 첫 화면(/)은 교통 현황 대시보드 카드, /map/…은 항목별 지도 페이지(TASK-025), /route는 경로 추천, /search는 관광 검색(TASK-029).
// 이미 공유된 /traffic 주소도 대시보드를 연다. Vercel은 vercel.json rewrites로 같은 index.html을 준다.
const ROUTE_PATH = "/route";
const SEARCH_PATH = "/search";
const path = window.location.pathname.replace(/\/+$/, "");
const page = path === ROUTE_PATH ? <App /> : path === SEARCH_PATH ? <SearchPage /> : <TrafficApp />;

createRoot(root).render(<StrictMode>{page}</StrictMode>);
