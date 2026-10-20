import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { TrafficDashboard } from "./features/traffic/TrafficDashboard";
import "./index.css";

const root = document.getElementById("root");
if (!root) throw new Error("#root 요소가 없습니다.");

// 첫 화면(/)은 교통 현황 대시보드(TASK-012, 사용자 "처음 화면을 교통현황으로"), /route는 경로 추천.
// 이미 공유된 /traffic 주소도 교통 현황을 연다. Vercel은 vercel.json rewrites로 같은 index.html을 준다.
const ROUTE_PATH = "/route";
const path = window.location.pathname.replace(/\/+$/, "");
const page = path === ROUTE_PATH ? <App /> : <TrafficDashboard />;

createRoot(root).render(<StrictMode>{page}</StrictMode>);
