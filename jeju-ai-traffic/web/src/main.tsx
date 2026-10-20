import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { TrafficDashboard } from "./features/traffic/TrafficDashboard";
import "./index.css";

const root = document.getElementById("root");
if (!root) throw new Error("#root 요소가 없습니다.");

// /traffic은 교통 현황 대시보드(TASK-012), 그 밖은 경로 추천. Vercel은 vercel.json rewrites로 같은 index.html을 준다.
const page = window.location.pathname.replace(/\/+$/, "") === "/traffic" ? <TrafficDashboard /> : <App />;

createRoot(root).render(<StrictMode>{page}</StrictMode>);
