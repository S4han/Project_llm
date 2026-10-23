import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import type { SpeedStatus, TrafficIncidentsResponse, TrafficSpeedsResponse } from "../../../../shared/contracts/traffic";
import { speedShares, todayLabel } from "./startSummary";
import { SEARCH_QUERY_MAX_LENGTH } from "../../../../shared/contracts/search";
import { fetchTrafficIncidents, fetchTrafficSpeeds } from "../../services/trafficApi";
import { STATUS_STYLE } from "../routes/trafficStyle";
import { FACILITY_STYLE, NEARBY_RADIUS } from "../traffic/facilityStyle";
import type { NearbyView, TrafficView } from "../traffic/views";
import { formatKstTime } from "../trip/format";

const SPEED_ORDER: SpeedStatus[] = ["smooth", "slow", "congested"];

/** 큰 버튼(첫 화면 2×2). */
function BigButton({ icon, title, sub, onClick }: { icon: ReactNode; title: string; sub: string; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className="flex min-h-28 w-full flex-col justify-between gap-2 rounded-[20px] bg-white p-4 text-left shadow-sm ring-1 ring-grey-200 active:bg-grey-50">
      <span className="text-2xl" aria-hidden="true">
        {icon}
      </span>
      <span className="flex flex-col">
        <span className="text-lg font-bold text-grey-900">{title}</span>
        <span className="text-sm text-grey-600">{sub}</span>
      </span>
    </button>
  );
}

/**
 * 첫 화면(TASK-032 1.(a)): 관광지 검색창, 도로 한 줄 요약(원활·서행·정체 비율)·돌발 건수, 큰 버튼 4개, 교통 현황 전체 보기.
 * 위치는 묻지 않는다(3.(a)). 도로 소통·돌발만 받아 가볍게 연다. 출처는 접어 둔다(4.(a)).
 */
export function StartPage({ onNavigate }: { onNavigate: (view: TrafficView) => void }) {
  const [now] = useState(() => new Date());
  const [query, setQuery] = useState("");
  const [speeds, setSpeeds] = useState<TrafficSpeedsResponse | null | "failed">(null);
  const [incidents, setIncidents] = useState<TrafficIncidentsResponse | null | "failed">(null);
  useEffect(() => {
    let alive = true;
    void fetchTrafficSpeeds().then((r) => alive && setSpeeds(r.ok ? r.data : "failed"));
    void fetchTrafficIncidents().then((r) => alive && setIncidents(r.ok ? r.data : "failed"));
    return () => {
      alive = false;
    };
  }, []);
  const shares = speeds && speeds !== "failed" ? speedShares(speeds.speeds) : null;
  const incidentCount = incidents && incidents !== "failed" ? incidents.incidents.length : null;
  const mock = speeds && speeds !== "failed" && speeds.source === "mock";
  const search = (e: FormEvent) => {
    e.preventDefault();
    const q = query.trim().slice(0, SEARCH_QUERY_MAX_LENGTH);
    window.location.assign(q ? `/search?q=${encodeURIComponent(q)}` : "/search");
  };

  return (
    <div className="mx-auto flex min-h-dvh max-w-md flex-col gap-5 bg-grey-100 p-4 md:max-w-2xl">
      <main className="flex flex-col gap-5">
        <header className="flex items-baseline justify-between gap-2 pt-2">
          <h1 className="text-[28px] font-bold tracking-tight text-grey-900">제주 교통·관광</h1>
          <p className="shrink-0 text-sm font-semibold text-grey-600">{todayLabel(now)}</p>
        </header>

        <form role="search" onSubmit={search} className="flex gap-2">
          <input
            type="search"
            value={query}
            maxLength={SEARCH_QUERY_MAX_LENGTH}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="🔍 관광지 검색 (예: 성산, 오름)"
            aria-label="관광지 검색어"
            enterKeyHint="search"
            className="min-h-14 min-w-0 flex-1 rounded-2xl bg-white px-4 text-base text-grey-900 shadow-sm ring-1 ring-grey-300 placeholder:text-grey-500 focus:outline-none focus:ring-2 focus:ring-brand-500"
          />
          <button type="submit" className="min-h-14 shrink-0 rounded-2xl bg-brand-600 px-4 font-semibold text-white active:bg-brand-700">
            검색
          </button>
        </form>

        <section aria-labelledby="road-now" className="flex flex-col gap-2 rounded-[20px] bg-white p-4 shadow-sm ring-1 ring-grey-200">
          <div className="flex items-baseline justify-between gap-2">
            <h2 id="road-now" className="font-bold text-grey-900">
              지금 도로
            </h2>
            <p className="text-xs text-grey-500">{speeds && speeds !== "failed" && speeds.observedAt ? `${formatKstTime(speeds.observedAt)} 기준${mock ? " · 모의 데이터" : ""}` : ""}</p>
          </div>
          {shares ? (
            <>
              {/* 막대의 각 칸을 누르면 그 상태의 도로 지도(지금 지도 페이지). */}
              <div role="img" aria-label={`원활 ${shares.smooth}% 서행 ${shares.slow}% 정체 ${shares.congested}%`} className="flex h-3 w-full overflow-hidden rounded-full bg-grey-100">
                {SPEED_ORDER.map((st) => (shares[st] > 0 ? <span key={st} className={STATUS_STYLE[st].bar} style={{ width: `${shares[st]}%` }} /> : null))}
              </div>
              <p className="flex flex-wrap gap-x-3 gap-y-1 text-sm">
                {SPEED_ORDER.map((st) => (
                  <button key={st} type="button" onClick={() => onNavigate(st)} className="flex items-center gap-1 font-semibold text-grey-800">
                    <span className={`inline-block h-2 w-3 rounded ${STATUS_STYLE[st].bar}`} aria-hidden="true" />
                    {STATUS_STYLE[st].label} {shares[st]}%
                  </button>
                ))}
              </p>
            </>
          ) : (
            <p className="text-sm text-grey-600">{speeds === "failed" ? "도로 소통을 불러오지 못했습니다." : speeds ? "지금은 구간 속도 정보가 없습니다." : "도로 소통 불러오는 중…"}</p>
          )}
          <button type="button" onClick={() => onNavigate("incidents")} className="self-start text-sm font-semibold text-brand-700">
            {incidentCount !== null ? `돌발·통제·공사 ${incidentCount.toLocaleString("ko-KR")}건 ›` : incidents === "failed" ? "돌발·통제·공사 보기 ›" : "돌발·통제·공사 확인 중…"}
          </button>
        </section>

        <nav aria-label="바로 가기" className="grid grid-cols-2 gap-3">
          <BigButton icon="🚗" title="도로 소통" sub="막히는 구간 지도" onClick={() => onNavigate("congested")} />
          <BigButton icon="🧭" title="경로 추천" sub="빠른 길·예상시간" onClick={() => window.location.assign("/route")} />
          <BigButton icon="📍" title="내 주변" sub="주차·주유·충전" onClick={() => onNavigate("nearby")} />
          <BigButton icon="🏝️" title="관광지" sub="검색·주변 정보" onClick={() => window.location.assign("/search")} />
        </nav>

        <button type="button" onClick={() => onNavigate("home")} className="min-h-12 rounded-2xl bg-white font-semibold text-brand-700 shadow-sm ring-1 ring-grey-200">
          교통 현황 전체 보기 ›
        </button>
      </main>
      <footer className="mt-auto flex flex-col gap-2 border-t border-grey-200 pt-3 text-xs text-grey-500">
        <p className="text-sm font-semibold text-amber-800">운전 중에는 화면을 조작하지 마세요.</p>
        <details>
          <summary className="cursor-pointer font-semibold text-grey-600">출처 보기</summary>
          <div className="mt-2 flex flex-col gap-1">
            <p>도로 소통·돌발은 제주 ITS가 감지한 정보이며 모든 도로의 상황을 포함하지 않습니다. 첫 화면에서는 위치를 확인하지 않습니다. 내 주변·지도 페이지에서 확인한 위치는 이 기기에서 지도 표시와 반경 계산에만 쓰고 저장하지 않습니다.</p>
            <p>지도 © 브이월드(국토교통부)·OpenStreetMap 기여자 · 교통 제주 ITS · 도로 모양 브이월드(국토교통부 교통링크) · 주정차 단속 CCTV 제주시·주차장 전국주차장정보표준데이터(공공데이터포털) · 주유소 제주 ITS(가격 오피넷·한국석유공사) · 전기차 충전소 제주 ITS · 관광지 한국관광공사·비짓제주(제주관광공사) · 경로 카카오모빌리티</p>
          </div>
        </details>
      </footer>
    </div>
  );
}

const NEARBY_CHOICES: { key: Exclude<NearbyView, "TOUR">; sub: string }[] = [
  { key: "PARK", sub: "무료·유료, 면수·운영 시간" },
  { key: "GAS", sub: "휘발유·경유 최저가" },
  { key: "EV", sub: "지금 충전 가능한 곳" },
  { key: "LPG", sub: "LPG 최저가" },
  { key: "ENF", sub: "단속 카메라 위치(제주시)" },
];

/** 내 주변 고르기(TASK-032 2.(a)): 고르면 지금의 지도 페이지. 위치는 지도 페이지에서 확인한다. */
export function NearbyPicker({ onNavigate }: { onNavigate: (view: TrafficView) => void }) {
  return (
    <div className="mx-auto flex min-h-dvh max-w-md flex-col gap-4 bg-grey-100 p-4 md:max-w-2xl">
      <main className="flex flex-col gap-4">
        <button type="button" onClick={() => onNavigate("start")} className="self-start pt-2 text-sm font-semibold text-brand-700">
          ← 홈
        </button>
        <h1 className="text-[26px] font-bold tracking-tight text-grey-900">내 주변</h1>
        <p className="text-sm text-grey-600">무엇을 찾을까요? 고르면 현재 위치를 확인해 지도에 보여 줍니다.</p>
        <ul aria-label="내 주변 종류" className="flex flex-col gap-2">
          {NEARBY_CHOICES.map(({ key, sub }) => {
            const st = FACILITY_STYLE[key];
            return (
              <li key={key}>
                <button type="button" onClick={() => onNavigate(key)} className="flex min-h-16 w-full items-center gap-3 rounded-[20px] bg-white p-4 text-left shadow-sm ring-1 ring-grey-200 active:bg-grey-50">
                  <span className="inline-block h-4 w-4 shrink-0 rounded-full" style={{ backgroundColor: st.color, boxShadow: st.stroke ? `inset 0 0 0 2px ${st.stroke}` : undefined }} aria-hidden="true" />
                  <span className="flex min-w-0 flex-1 flex-col">
                    <span className="font-bold text-grey-900">{st.short}</span>
                    <span className="text-sm text-grey-600">
                      반경 {(NEARBY_RADIUS[key] ?? 1000) / 1000}km · {sub}
                    </span>
                  </span>
                  <span className="text-grey-400" aria-hidden="true">
                    ›
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      </main>
    </div>
  );
}
