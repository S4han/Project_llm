import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { IncidentKind, SpeedStatus, TrafficEnforcementResponse, TrafficFacilitiesResponse, TrafficParkingResponse, TrafficIncident, TrafficLinksResponse, TrafficSpeedsResponse } from "../../../../shared/contracts/traffic";
import { isStale } from "../../../../shared/rules/traffic";
import { distanceMeters } from "../../../../shared/rules/geo";
import type { Coordinate } from "../../../../shared/contracts/route";
import { getCurrentLocation } from "../../services/geolocation";
import { fetchTrafficEnforcement, fetchTrafficFacilities, fetchTrafficParking, fetchTrafficIncidents, fetchTrafficLinks, fetchTrafficSpeeds } from "../../services/trafficApi";
import type { FacilityPoint, SpeedLine } from "../map/leafletMap";
import { FACILITY_ORDER, FACILITY_STYLE, NEARBY_KEYS, type FacilityKey } from "./facilityStyle";
import { IncidentFocusBar, IncidentGroupList } from "../routes/IncidentFocus";
import { groupIncidents, useIncidentFocus } from "../routes/incidents";
import { INCIDENT_LABEL, STATUS_STYLE } from "../routes/trafficStyle";
import { formatKstTime } from "../trip/format";
import { revealMap } from "../map/revealMap";
import { IncidentMap } from "./IncidentMap";
import { buildCongestionRows, groupByRoad, joinSpeedLines, sectionText } from "./speedLines";

/** 자동 갱신 간격. 서버는 제주 ITS 결과를 60초 캐시하므로 더 자주 불러도 새 정보가 없다(TASK-012 3. (a)). */
export const REFRESH_MS = 60_000;

/** 대시보드에 보이는 종류(TASK-012 1. (a): 교통기상 제외). */
const KINDS: Exclude<IncidentKind, "weather">[] = ["event", "closure", "roadwork"];

const SPEED_ORDER: SpeedStatus[] = ["smooth", "slow", "congested"];

/** 도로 목록을 한 번에 보여 줄 개수. */
const ROAD_PAGE = 20;

/** 주정차 단속·주차장은 내 위치 반경 안만 보인다(TASK-016 사용자 "반경을 1키로로 수정", TASK-017 2.(a)). */
export const ENFORCEMENT_RADIUS_METERS = 1000;
const RADIUS_TEXT = `${ENFORCEMENT_RADIUS_METERS / 1000}km`;
/** 반경 1km라 경로 추천과 같은 정확도 기준(200m)으로 받는다. */
const ENFORCEMENT_LOCATION_ACCURACY_METERS = 200;

/** 실시간 정체·서행구간을 한 번에 보여 줄 줄 수(TASK-015). */
const CHAIN_PAGE = 20;

/** 구간 속도 원천이 약 5분 단위라, 15분이 지나면 오래된 속도로 본다. */
const SPEED_STALE_MS = 15 * 60_000;

interface Snapshot {
  incidents: TrafficIncident[];
  observedAt: string;
}

/** 마지막으로 성공한 조회와, 그 뒤의 실패·한도 안내. 실패해도 마지막 성공 결과는 남긴다. */
interface DashboardState {
  snapshot: Snapshot | null;
  problem: string | null;
  loading: boolean;
}

const EMPTY_LINES: SpeedLine[] = [];

/** "회전형 1대 · 검지 4대". 원천이 비어 있으면 그 항목은 뺀다. */
function enforcementCounts(rotate: number | null, audit: number | null): string {
  return [rotate !== null && `회전형 ${rotate}대`, audit !== null && `검지 ${audit}대`].filter(Boolean).join(" · ");
}

/** 넓은 화면에서 정보 패널 칸(위쪽 전체 폭 → PC는 오른쪽 칸). */
const PANEL = "md:col-span-2 xl:col-span-1 xl:col-start-2";
const EMPTY_IDS: string[] = [];

/** 제주 ITS 실시간 교통 현황(TASK-012). 화면이 켜져 있을 때만 1분마다 다시 조회한다. */
export function TrafficDashboard() {
  const [state, setState] = useState<DashboardState>({ snapshot: null, problem: null, loading: true });
  const [speeds, setSpeeds] = useState<TrafficSpeedsResponse | null>(null);
  const [links, setLinks] = useState<TrafficLinksResponse["links"] | null>(null);
  const [linksProblem, setLinksProblem] = useState<string | null>(null);
  // 처리 현황(도로 모양은 서버가 새로 만들 때 최대 1분, 구간 속도는 1~2초)
  const [linksLoading, setLinksLoading] = useState(true);
  const [linksStartedAt, setLinksStartedAt] = useState(() => Date.now());
  const [clock, setClock] = useState(() => Date.now());
  const [speedsBusy, setSpeedsBusy] = useState(true);
  const [speedsError, setSpeedsError] = useState(false);
  // 교통시설물(TASK-013): 화면을 열 때 한 번 받고, 유형은 기본 모두 꺼 둔다(승인 1. (a)).
  const [facilities, setFacilities] = useState<TrafficFacilitiesResponse | null>(null);
  const [facilitiesLoading, setFacilitiesLoading] = useState(true);
  const [facilitiesProblem, setFacilitiesProblem] = useState(false);
  const [facilityTypes, setFacilityTypes] = useState<Set<FacilityKey>>(() => new Set());
  // 제주시 주정차 단속 CCTV(TASK-016): 교통시설물 카드의 한 유형으로, 따로 받는다.
  const [enforcement, setEnforcement] = useState<TrafficEnforcementResponse | null>(null);
  const [enforcementLoading, setEnforcementLoading] = useState(true);
  const [enforcementProblem, setEnforcementProblem] = useState(false);
  // 주차장(TASK-017, 전국주차장정보표준데이터): 위치·요금·면수만, 실시간 남은 칸 없음.
  const [parking, setParking] = useState<TrafficParkingResponse | null>(null);
  const [parkingLoading, setParkingLoading] = useState(true);
  const [parkingProblem, setParkingProblem] = useState(false);
  // 내 위치(주정차 단속 반경 조회용). 이 화면 메모리에만 두고 서버로 보내거나 저장하지 않는다.
  const [myLocation, setMyLocation] = useState<Coordinate | null>(null);
  const [locating, setLocating] = useState(false);
  const [locationProblem, setLocationProblem] = useState<string | null>(null);
  const [showSpeeds, setShowSpeeds] = useState(true);
  // 도로 소통 상태 카드·도로 목록(TASK-012 소통대시보드)
  const [speedFilter, setSpeedFilter] = useState<SpeedStatus | "all">("all");
  const [roadKey, setRoadKey] = useState<string | null>(null);
  const [roadLimit, setRoadLimit] = useState(ROAD_PAGE);
  // 실시간 정체구간(TASK-015): 누른 줄의 첫 구간 ID
  const [chainKey, setChainKey] = useState<string | null>(null);
  const [chainLimit, setChainLimit] = useState(CHAIN_PAGE);
  const [kind, setKind] = useState<IncidentKind | "all">("all");
  const [now, setNow] = useState(() => new Date());
  const lastLoad = useRef(0);
  const seq = useRef(0);
  const mapBox = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    const id = ++seq.current;
    lastLoad.current = Date.now();
    const speedPromise = fetchTrafficSpeeds();
    const result = await fetchTrafficIncidents();
    const speedResult = await speedPromise;
    if (id !== seq.current) return;
    // 속도는 실패해도 마지막으로 받은 값을 두고 상태만 바꾼다.
    setSpeedsBusy(false);
    setSpeedsError(!speedResult.ok);
    if (speedResult.ok) setSpeeds((prev) => (speedResult.data.status === "ok" || !prev ? speedResult.data : { ...prev, status: speedResult.data.status, retryAfter: speedResult.data.retryAfter }));
    setNow(new Date());
    setState((s) => {
      if (!result.ok) return { ...s, loading: false, problem: `갱신 실패: ${result.error.message}` };
      const { data } = result;
      if (data.status === "ok" && data.observedAt) return { snapshot: { incidents: data.incidents, observedAt: data.observedAt }, problem: null, loading: false };
      const reason =
        data.status === "quotaBlocked"
          ? `교통 사건 정보 미확보(오늘 조회 한도 도달${data.retryAfter ? `, ${formatKstTime(data.retryAfter)} 이후 다시 사용 가능` : ""})`
          : "교통 사건 정보 미확보(제주 ITS 조회 실패)";
      return { ...s, loading: false, problem: reason };
    });
  }, []);

  /** 조회 중 표시를 켜고 다시 조회한다(새로고침·자동 갱신). 처음 조회는 초기 상태가 이미 조회 중이다. */
  const refresh = useCallback(() => {
    setState((s) => ({ ...s, loading: true }));
    setSpeedsBusy(true);
    void load();
  }, [load]);

  // 구간 모양은 화면을 열 때 한 번만 받는다(서버·CDN이 30일 보관). 실패하면 "다시 시도"로 다시 받는다.
  const alive = useRef(true);
  const fetchLinks = useCallback(async () => {
    const r = await fetchTrafficLinks();
    if (!alive.current) return;
    setLinksLoading(false);
    if (r.ok) {
      setLinks(r.data.links);
      setLinksProblem(null);
    } else setLinksProblem("도로 모양을 불러오지 못해 구간 속도 색을 표시할 수 없습니다.");
  }, []);
  const retryLinks = () => {
    setLinksLoading(true);
    setLinksProblem(null);
    setLinksStartedAt(Date.now());
    setClock(Date.now());
    void fetchLinks();
  };
  useEffect(() => {
    alive.current = true;
    // 콜백으로 시작한다(효과 본문에서 상태를 바로 바꾸지 않도록, 첫 조회와 같은 방식).
    const first = setTimeout(() => void fetchLinks(), 0);
    return () => {
      alive.current = false;
      clearTimeout(first);
    };
  }, [fetchLinks]);

  const fetchFacilities = useCallback(async () => {
    const r = await fetchTrafficFacilities();
    if (!alive.current) return;
    setFacilitiesLoading(false);
    setFacilitiesProblem(!r.ok);
    if (r.ok) setFacilities(r.data);
  }, []);
  const fetchEnforcement = useCallback(async () => {
    const r = await fetchTrafficEnforcement();
    if (!alive.current) return;
    setEnforcementLoading(false);
    setEnforcementProblem(!r.ok);
    if (r.ok) setEnforcement(r.data);
  }, []);
  const fetchParking = useCallback(async () => {
    const r = await fetchTrafficParking();
    if (!alive.current) return;
    setParkingLoading(false);
    setParkingProblem(!r.ok);
    if (r.ok) setParking(r.data);
  }, []);
  const retryParking = () => {
    setParkingLoading(true);
    setParkingProblem(false);
    void fetchParking();
  };
  const retryFacilities = () => {
    setFacilitiesLoading(true);
    setFacilitiesProblem(false);
    void fetchFacilities();
  };
  const retryEnforcement = () => {
    setEnforcementLoading(true);
    setEnforcementProblem(false);
    void fetchEnforcement();
  };
  useEffect(() => {
    const first = setTimeout(() => {
      void fetchFacilities();
      void fetchEnforcement();
      void fetchParking();
    }, 0);
    return () => clearTimeout(first);
  }, [fetchFacilities, fetchEnforcement, fetchParking]);

  // 도로 모양을 받는 동안 경과 시간(초)을 1초마다 갱신한다.
  useEffect(() => {
    if (!linksLoading) return;
    const id = setInterval(() => setClock(Date.now()), 1000);
    return () => clearInterval(id);
  }, [linksLoading]);

  useEffect(() => {
    // 첫 조회도 콜백으로 시작한다(효과 본문에서 상태를 바로 바꾸지 않도록).
    const first = setTimeout(() => void load(), 0);
    const tick = setInterval(() => {
      if (document.visibilityState === "visible") refresh();
    }, REFRESH_MS);
    // 화면으로 돌아왔을 때 1분이 지났으면 바로 다시 조회한다.
    const onVisible = () => {
      if (document.visibilityState === "visible" && Date.now() - lastLoad.current >= REFRESH_MS) refresh();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      clearTimeout(first);
      clearInterval(tick);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [load, refresh]);

  const all = state.snapshot?.incidents ?? [];
  const shown = kind === "all" ? all : all.filter((i) => i.kind === kind);
  const groups = groupIncidents(shown).sort((a, b) => b.count - a.count);
  const incidentFocus = useIncidentFocus(groups);
  const { clear: clearFocus } = incidentFocus;
  const stale = state.snapshot ? isStale(state.snapshot.observedAt, now) : false;
  const speedLines = useMemo(() => (links && speeds ? joinSpeedLines(links, speeds.speeds) : []), [links, speeds]);
  const speedCounts = SPEED_ORDER.map((s) => [s, speedLines.filter((l) => l.status === s).length] as const);
  const filteredLines = useMemo(() => (speedFilter === "all" ? speedLines : speedLines.filter((l) => l.status === speedFilter)), [speedLines, speedFilter]);
  // 원활은 도로명별 목록, 정체·서행은 실시간 정체구간 목록(TASK-015 조회 방식)
  const roads = useMemo(() => (speedFilter === "smooth" ? groupByRoad(filteredLines) : []), [filteredLines, speedFilter]);
  // 보고 있던 도로가 갱신 뒤 이 상태에서 빠지면 강조를 닫는다(목록에서 찾지 못하면 없는 것으로 본다).
  const road = roadKey === null ? undefined : roads.find((r) => r.key === roadKey);
  const chains = useMemo(() => (speedFilter === "slow" || speedFilter === "congested" ? buildCongestionRows(filteredLines) : []), [filteredLines, speedFilter]);
  // 갱신 뒤 같은 첫 구간으로 시작하는 줄이 없으면(풀렸거나 바뀜) 강조를 닫는다.
  const chain = chainKey === null ? undefined : chains.find((c) => c.key === chainKey);
  const roadIdsKey = chain ? chain.ids.join(",") : (road?.ids.join(",") ?? "");
  // 지도는 ID 문자열로 비교하므로 매번 새 배열이어도 다시 그리지 않는다.
  const highlightIds = roadIdsKey ? roadIdsKey.split(",") : EMPTY_IDS;
  const speedStale = speeds?.observedAt ? now.getTime() - Date.parse(speeds.observedAt) > SPEED_STALE_MS : false;
  const facilityCounts = useMemo(() => {
    const counts = Object.fromEntries(FACILITY_ORDER.map((t) => [t, 0])) as Record<FacilityKey, number>;
    for (const f of facilities?.facilities ?? []) counts[f[1]] += 1;
    counts.ENF = enforcement?.cameras.length ?? 0;
    counts.PARK = parking?.lots.length ?? 0;
    return counts;
  }, [facilities, enforcement, parking]);
  const facilityPoints = useMemo<FacilityPoint[]>(
    () => [
      ...(facilities?.facilities ?? [])
        .filter((f) => facilityTypes.has(f[1]))
        .map(([id, type, name, model, lat, lng]): FacilityPoint => ({ id, type, name, model, lat, lng })),
      ...(facilityTypes.has("PARK") && myLocation ? (parking?.lots ?? []).filter((l) => distanceMeters(myLocation, { lat: l[8], lng: l[9] }) <= ENFORCEMENT_RADIUS_METERS) : []).map(
        ([id, name, se, type, address, spaces, hours, fee, lat, lng]): FacilityPoint => ({
          id: `PARK-${id}`,
          type: "PARK",
          name,
          model: "",
          lat,
          lng,
          detail: [[se, type].filter(Boolean).join("·") + (spaces !== null ? ` · ${spaces.toLocaleString("ko-KR")}면` : ""), hours && `운영 ${hours}`, fee && `요금 ${fee}`, address].filter(Boolean).join("\n"),
        }),
      ),
      ...(facilityTypes.has("ENF") && myLocation ? (enforcement?.cameras ?? []).filter((c) => distanceMeters(myLocation, { lat: c[6], lng: c[7] }) <= ENFORCEMENT_RADIUS_METERS) : []).map(
        ([id, place, address, rotate, audit, oper, lat, lng]): FacilityPoint => ({
          id: `ENF-${id}`,
          type: "ENF",
          name: place,
          model: "",
          lat,
          lng,
          detail: [address, enforcementCounts(rotate, audit), oper && `운영 ${oper}`].filter(Boolean).join("\n"),
        }),
      ),
    ],
    [facilities, facilityTypes, enforcement, parking, myLocation],
  );
  const nearbyOn = NEARBY_KEYS.filter((k) => facilityTypes.has(k));
  const nearbyCount = (k: FacilityKey) => facilityPoints.filter((p) => p.type === k).length;
  const nearbyLabel: Partial<Record<FacilityKey, string>> = { ENF: "주정차 단속 CCTV", PARK: "주차장" };
  const nearbyText = (() => {
    const total = nearbyOn.reduce((s, k) => s + nearbyCount(k), 0);
    if (total > 0) return `내 위치 반경 ${RADIUS_TEXT} 안 ${nearbyOn.map((k) => `${nearbyLabel[k]} ${nearbyCount(k).toLocaleString("ko-KR")}곳`).join(" · ")}`;
    const none = `내 위치 반경 ${RADIUS_TEXT} 안에 ${nearbyOn.map((k) => nearbyLabel[k]).join("·")}`;
    // 조사: "…CCTV가", "…주차장이"(마지막 이름 기준)
    const particle = nearbyOn.at(-1) === "PARK" ? "이" : "가";
    return `${none}${particle} 없습니다.${nearbyOn.includes("ENF") ? "(주정차 단속은 제주시 자료만 있음)" : ""}`;
  })();
  /** 현재 위치를 한 번 확인한다. 실패하면 위치 기반 유형(주정차 단속·주차장)을 끄고 이유를 보인다. */
  const locate = async () => {
    setLocating(true);
    setLocationProblem(null);
    const r = await getCurrentLocation(undefined, ENFORCEMENT_LOCATION_ACCURACY_METERS);
    setLocating(false);
    if (r.kind === "ok") {
      setMyLocation(r.location);
      return;
    }
    const reason: Record<Exclude<typeof r.kind, "ok">, string> = {
      denied: "위치 권한이 꺼져 있습니다. 브라우저 설정에서 이 사이트의 위치 권한을 허용한 뒤 다시 시도하세요.",
      timeout: "위치를 확인하는 데 시간이 너무 걸렸습니다. 다시 시도하세요.",
      unavailable: "현재 위치를 확인할 수 없습니다. 잠시 뒤 다시 시도하세요.",
      unsupported: "이 브라우저는 위치 확인을 지원하지 않습니다.",
      inaccurate: `위치가 부정확합니다(오차 약 ${"accuracyMeters" in r ? r.accuracyMeters : "?"}m). 실외나 와이파이가 켜진 곳에서 다시 시도하세요.`,
      outsideJeju: "현재 위치가 제주 밖이라 내 위치 주변을 표시할 수 없습니다.",
    };
    setLocationProblem(`내 위치 주변(주정차 단속·주차장)을 표시하지 못했습니다: ${reason[r.kind]}`);
    setFacilityTypes((prev) => new Set([...prev].filter((k) => !NEARBY_KEYS.includes(k))));
  };
  const toggleFacility = (t: FacilityKey) => {
    const nearby = NEARBY_KEYS.includes(t);
    if (nearby && !facilityTypes.has(t) && !myLocation && !locating) void locate();
    if (nearby) setLocationProblem(null);
    setFacilityTypes((prev) => {
      const next = new Set(prev);
      if (next.has(t)) next.delete(t);
      else next.add(t);
      return next;
    });
  };
  const linksSeconds = Math.max(0, Math.floor((clock - linksStartedAt) / 1000));
  const firstSpeeds = speeds === null && speedsBusy;
  const showProgress = linksLoading || firstSpeeds;
  const mapOverlay = showSpeeds && speedLines.length === 0 && showProgress ? "도로 소통 불러오는 중…" : null;
  const speedProblem =
    speeds && speeds.status !== "ok"
      ? speeds.status === "quotaBlocked"
        ? `구간 속도 정보 미확보(오늘 조회 한도 도달${speeds.retryAfter ? `, ${formatKstTime(speeds.retryAfter)} 이후 다시 사용 가능` : ""})`
        : "구간 속도 정보 미확보(제주 ITS 조회 실패)"
      : null;

  const chooseSpeed = (s: SpeedStatus | "all") => {
    setSpeedFilter(s);
    setRoadKey(null);
    setChainKey(null);
    setRoadLimit(ROAD_PAGE);
    setChainLimit(CHAIN_PAGE);
    setShowSpeeds(true);
  };
  const focusRoad = (key: string) => {
    setRoadKey((k) => (k === key ? null : key));
    setChainKey(null);
    clearFocus();
    revealMap(mapBox.current);
  };

  const focusChain = (key: string) => {
    setChainKey((k) => (k === key ? null : key));
    setRoadKey(null);
    setShowSpeeds(true);
    clearFocus();
    revealMap(mapBox.current);
  };

  const chooseKind = (k: IncidentKind | "all") => {
    setKind(k);
    clearFocus();
  };
  const focusGroup = (key: string) => {
    incidentFocus.toggle(key);
    setRoadKey(null);
    setChainKey(null);
    revealMap(mapBox.current);
  };

  return (
    <div className="mx-auto flex min-h-dvh max-w-md flex-col gap-4 bg-grey-100 p-4 md:max-w-5xl xl:max-w-[96rem]">
      {/*
        반응형(TASK-012 반응형): 휴대폰은 세로 한 줄. 태블릿(md)은 도로 소통·사건 카드를 넓게, 그 아래 큰 지도와 사건 목록.
        PC·아이패드 가로(xl)는 왼쪽에 화면 높이의 지도를 고정하고 오른쪽에 정보 패널.
      */}
      <main className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-[minmax(0,1fr)_26rem] xl:grid-rows-[auto_auto_auto_auto_auto_auto_1fr]">
        <div className={`flex items-center justify-between gap-2 ${PANEL}`}>
          <h1 className="text-[26px] font-bold tracking-tight text-grey-900">제주 실시간 교통 현황</h1>
          <a href="/route" className="shrink-0 text-sm font-semibold text-brand-700">
            경로 추천 →
          </a>
        </div>
        <div className={`flex items-center justify-between gap-2 ${PANEL}`}>
          <p className="text-sm text-grey-600">
            제주 ITS 도로 소통·돌발·통제·공사
            {state.snapshot && ` · ${formatKstTime(state.snapshot.observedAt)} 조회`}
            {state.snapshot?.incidents.some((i) => i.source === "mock") && " · 모의 데이터"}
          </p>
          <button
            type="button"
            onClick={refresh}
            disabled={state.loading}
            className="min-h-12 shrink-0 rounded-2xl bg-white px-4 font-semibold text-grey-700 disabled:opacity-50"
          >
            {state.loading ? "조회 중…" : "새로고침"}
          </button>
        </div>

        <div aria-live="polite" className={`flex flex-col gap-2 text-sm ${PANEL}`}>
          {state.problem && (
            <p role="alert" className="rounded-2xl bg-red-50 p-3 text-red-800">
              {state.problem}
              {state.snapshot && ` · 마지막 성공 ${formatKstTime(state.snapshot.observedAt)}`}
            </p>
          )}
          {stale && state.snapshot && (
            <p role="alert" className="rounded-2xl bg-amber-100 p-3 text-amber-900">
              오래된 정보입니다({Math.floor((now.getTime() - Date.parse(state.snapshot.observedAt)) / 60_000)}분 전 조회).
            </p>
          )}
        </div>

        <section aria-labelledby="speeds-heading" className={`flex flex-col gap-3 rounded-[20px] bg-white p-4 ${PANEL}`}>
          <div className="flex items-center justify-between gap-2">
            <div>
              <h2 id="speeds-heading" className="font-bold text-grey-900">
                도로 소통
              </h2>
              <p className="text-xs text-grey-600">
                화면이 켜져 있을 때 1분마다 자동 갱신{speeds && ` · 마지막 조회 ${formatKstTime(now.toISOString())}`}
                {speeds && speedsBusy && <span className="ml-1 font-semibold text-brand-700">· 갱신 중…</span>}
              </p>
            </div>
            <button
              type="button"
              onClick={() => setShowSpeeds((v) => !v)}
              aria-pressed={showSpeeds}
              className={`min-h-12 shrink-0 whitespace-nowrap rounded-2xl border px-3 text-sm font-semibold ${showSpeeds ? "border-brand-600 bg-brand-50 text-brand-800" : "border-grey-300 bg-white text-grey-700"}`}
            >
              {showSpeeds ? "지도에 표시 중" : "지도에 표시"}
            </button>
          </div>
          <ul aria-label="구간 소통 건수" className="grid grid-cols-4 gap-2">
            {([["all", speedLines.length], ...speedCounts] as const).map(([s, n]) => (
              <li key={s}>
                <button
                  type="button"
                  onClick={() => chooseSpeed(s)}
                  aria-pressed={speedFilter === s}
                  className={`flex min-h-16 w-full flex-col items-center justify-center rounded-2xl p-2 ${speedFilter === s ? "bg-brand-50 ring-2 ring-brand-600" : "bg-grey-100"}`}
                >
                  <span className="flex items-center gap-1 text-xs text-grey-600">
                    {s !== "all" && <span className={`inline-block h-1.5 w-3 rounded ${STATUS_STYLE[s].bar}`} aria-hidden="true" />}
                    {s === "all" ? "전체" : STATUS_STYLE[s].label}
                  </span>
                  {/* 다섯 자리(11,906)도 휴대폰 폭 카드에서 한 줄에 들어가도록 폭에 맞춰 글자를 줄이고 줄바꿈하지 않는다. */}
                  <span className="whitespace-nowrap text-[clamp(0.85rem,4vw,1.125rem)] font-bold tabular-nums text-grey-900">
                    {speedLines.length ? n.toLocaleString("ko-KR") : "–"}
                  </span>
                </button>
              </li>
            ))}
          </ul>
          <p className="text-xs text-grey-600">
            제주 ITS 구간 평균속도(원활 30km/h 이상 · 서행 15~30 · 정체 15 미만)
            {speeds?.observedAt && ` · ${formatKstTime(speeds.observedAt)} 기준`}
            {speeds?.source === "mock" && " · 모의 데이터"}. 속도 정보가 없는 도로는 표시하지 않습니다.
          </p>
          {showProgress && (
            <ol role="status" aria-label="도로 소통 처리 현황" className="flex flex-col gap-1 rounded bg-brand-50 p-2 text-sm text-brand-900">
              <li>
                {linksLoading ? (
                  <>
                    <span className="mr-1 inline-block h-3 w-3 animate-spin rounded-full border-2 border-brand-700 border-t-transparent align-middle" aria-hidden="true" />
                    ① 도로 모양 불러오는 중… {linksSeconds}초
                    <span className="block text-xs text-brand-800">처음 한 번은 최대 1분 걸릴 수 있어요.</span>
                  </>
                ) : (
                  <>① 도로 모양 {links ? "✓" : "실패"}</>
                )}
              </li>
              <li>
                {firstSpeeds ? (
                  <>
                    <span className="mr-1 inline-block h-3 w-3 animate-spin rounded-full border-2 border-brand-700 border-t-transparent align-middle" aria-hidden="true" />
                    ② 구간 속도 불러오는 중…
                  </>
                ) : (
                  <>② 구간 속도 {speeds ? "✓" : "실패"}</>
                )}
              </li>
            </ol>
          )}
          {linksProblem && (
            <div role="alert" className="flex items-center justify-between gap-2 rounded bg-amber-50 p-2 text-sm text-amber-900">
              <span>{linksProblem}</span>
              <button type="button" onClick={retryLinks} className="min-h-12 shrink-0 rounded-2xl bg-amber-700 px-3 font-semibold text-white">
                다시 시도
              </button>
            </div>
          )}
          {!linksProblem && speedsError && !speeds && !speedsBusy && (
            <div role="alert" className="flex items-center justify-between gap-2 rounded bg-amber-50 p-2 text-sm text-amber-900">
              <span>구간 속도를 불러오지 못했습니다. 네트워크 연결을 확인하세요.</span>
              <button type="button" onClick={refresh} className="min-h-12 shrink-0 rounded-2xl bg-amber-700 px-3 font-semibold text-white">
                다시 시도
              </button>
            </div>
          )}
          {!linksProblem && (speedProblem || speedStale) && (
            <p role="alert" className="rounded bg-amber-50 p-2 text-sm text-amber-900">
              {speedProblem ?? "오래된 구간 속도입니다(15분 넘게 갱신되지 않음)."}
            </p>
          )}
          {(speedFilter === "slow" || speedFilter === "congested") && speedLines.length > 0 && (
            <div className="flex flex-col gap-1">
              <h3 className="text-sm font-semibold text-grey-700">
                실시간 {STATUS_STYLE[speedFilter].label}구간 {chains.length.toLocaleString("ko-KR")}곳 · 느린 순
              </h3>
              <p className="text-xs text-grey-600">같은 도로에서 이어진 구간은 한 줄로 묶었습니다. 누르면 지도에서 보여 줍니다.</p>
              {chains.length === 0 ? (
                <p className="text-sm text-grey-600">현재 {STATUS_STYLE[speedFilter].label} 구간이 없습니다.</p>
              ) : (
                <ul aria-label={`실시간 ${STATUS_STYLE[speedFilter].label}구간 목록`} className="flex flex-col gap-1">
                  {chains.slice(0, chainLimit).map((c) => (
                    <li key={c.key}>
                      <button
                        type="button"
                        onClick={() => focusChain(c.key)}
                        aria-pressed={c.key === chainKey}
                        className={`flex min-h-12 w-full items-center justify-between gap-2 rounded-xl px-3 py-2 text-left text-sm ${c.key === chainKey ? "bg-brand-50 ring-2 ring-brand-600" : "bg-grey-100"}`}
                      >
                        <span className="min-w-0">
                          <span className="flex items-center gap-1.5">
                            <span className="truncate font-semibold text-grey-900">{c.label}</span>
                            <span className={`shrink-0 rounded-md px-1.5 py-0.5 text-xs font-bold ${c.status === "congested" ? "bg-red-600 text-white" : "bg-slow text-grey-900"}`}>{STATUS_STYLE[c.status].label}</span>
                          </span>
                          <span className="block text-grey-700">{sectionText(c)}</span>
                        </span>
                        <span className="shrink-0 text-right">
                          <span className="block font-bold tabular-nums text-grey-900">{c.avgKmh}km/h</span>
                          <span className="block text-xs font-semibold text-brand-700">{c.key === chainKey ? "지도에 표시 중" : "지도 ›"}</span>
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
              {chains.length > chainLimit && (
                <button type="button" onClick={() => setChainLimit((n) => n + CHAIN_PAGE)} className="min-h-12 rounded-2xl bg-grey-100 font-semibold text-grey-700">
                  더 보기 ({(chains.length - chainLimit).toLocaleString("ko-KR")}곳 남음)
                </button>
              )}
            </div>
          )}
          {speedFilter === "smooth" && speedLines.length > 0 && (
            <div className="flex flex-col gap-1">
              <h3 className="text-sm font-semibold text-grey-700">
                {STATUS_STYLE[speedFilter].label} 도로 {roads.length.toLocaleString("ko-KR")}곳 · 구간이 많은 순
              </h3>
              {roads.length === 0 ? (
                <p className="text-sm text-grey-600">현재 {STATUS_STYLE[speedFilter].label} 구간이 없습니다.</p>
              ) : (
                <ul aria-label={`${STATUS_STYLE[speedFilter].label} 도로 목록`} className="flex flex-col gap-1">
                  {roads.slice(0, roadLimit).map((r) => (
                    <li key={r.key}>
                      <button
                        type="button"
                        onClick={() => focusRoad(r.key)}
                        aria-pressed={r.key === roadKey}
                        className={`flex min-h-12 w-full items-center justify-between gap-2 rounded-xl px-3 py-2 text-left text-sm ${r.key === roadKey ? "bg-brand-50 ring-2 ring-brand-600" : "bg-grey-100"}`}
                      >
                        <span>
                          <span className="font-semibold text-grey-900">{r.label}</span>
                          <span className="text-grey-700">
                            {" "}
                            · {STATUS_STYLE[speedFilter].label} {r.count}구간 · 평균 {r.avgKmh}km/h
                          </span>
                        </span>
                        <span className="shrink-0 text-xs font-semibold text-brand-700">{r.key === roadKey ? "지도에 표시 중" : "지도에서 보기 ›"}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
              {roads.length > roadLimit && (
                <button
                  type="button"
                  onClick={() => setRoadLimit((n) => n + ROAD_PAGE)}
                  className="min-h-12 rounded-2xl bg-grey-100 font-semibold text-grey-700"
                >
                  더 보기 ({(roads.length - roadLimit).toLocaleString("ko-KR")}곳 남음)
                </button>
              )}
            </div>
          )}
        </section>

        <section aria-labelledby="facilities-heading" className={`flex flex-col gap-3 rounded-[20px] bg-white p-4 ${PANEL}`}>
          <div>
            <h2 id="facilities-heading" className="font-bold text-grey-900">
              교통시설물
            </h2>
            <p className="text-xs text-grey-600">
              제주 ITS 시설물 위치{facilities?.source === "mock" && " · 모의 데이터"}. 유형을 눌러 지도에 켜고 끕니다. CCTV·웹카메라 점을 누르면 제주 ITS 교통정보센터(새 창)로 연결되며, 사이트의 CCTV 메뉴에서 같은 위치를 고르면 영상을 볼 수 있습니다. 주정차 단속은
              제주시 자료(공공데이터포털)로 서귀포시는 없고, 위치·운영 시간만 있습니다{enforcement?.source === "mock" && "(모의 데이터)"}. 주차장은 전국주차장정보표준데이터(제주시·서귀포시)로 위치·면수·요금·운영 시간만 있고 실시간 남은 칸은 없습니다
              {parking?.source === "mock" && "(모의 데이터)"}. 주정차 단속·주차장은 켜면 현재 위치를 한 번 확인해 반경 {RADIUS_TEXT} 안만 보여 줍니다(위치는 이 기기에서 거리 계산에만 쓰고 보내거나 저장하지 않습니다).
            </p>
          </div>
          {(facilitiesLoading || enforcementLoading || parkingLoading) && (
            <p role="status" aria-label="교통시설물 처리 현황" className="rounded-2xl bg-brand-50 p-2 text-sm text-brand-900">
              <span className="mr-1 inline-block h-3 w-3 animate-spin rounded-full border-2 border-brand-700 border-t-transparent align-middle" aria-hidden="true" />
              교통시설물 불러오는 중…
            </p>
          )}
          {facilitiesProblem && (
            <div role="alert" className="flex items-center justify-between gap-2 rounded-2xl bg-amber-50 p-2 text-sm text-amber-900">
              <span>교통시설물을 불러오지 못했습니다.</span>
              <button type="button" onClick={retryFacilities} className="min-h-12 shrink-0 rounded-2xl bg-amber-700 px-3 font-semibold text-white">
                다시 시도
              </button>
            </div>
          )}
          {(facilities || enforcement || parking) && (
            <ul aria-label="교통시설물 유형" className="grid grid-cols-2 gap-2 sm:grid-cols-4 xl:grid-cols-2">
              {FACILITY_ORDER.map((t) => {
                const on = facilityTypes.has(t);
                const n = facilityCounts[t];
                return (
                  <li key={t}>
                    <button
                      type="button"
                      onClick={() => toggleFacility(t)}
                      aria-pressed={on}
                      disabled={n === 0}
                      className={`flex min-h-12 w-full items-center justify-between gap-2 rounded-2xl px-3 text-left text-sm disabled:opacity-40 ${on ? "bg-brand-50 ring-2 ring-brand-600" : "bg-grey-100"}`}
                    >
                      <span className="flex min-w-0 items-center gap-2">
                        <span
                          className="inline-block h-3 w-3 shrink-0 rounded-full"
                          style={{ backgroundColor: FACILITY_STYLE[t].color, boxShadow: FACILITY_STYLE[t].stroke ? `inset 0 0 0 2px ${FACILITY_STYLE[t].stroke}` : undefined }}
                          aria-hidden="true"
                        />
                        <span className="truncate font-semibold text-grey-800">{FACILITY_STYLE[t].short}</span>
                      </span>
                      <span className="shrink-0 tabular-nums text-grey-700">{n.toLocaleString("ko-KR")}</span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
          {facilities && facilities.failedTypes.length > 0 && (
            <p className="text-xs text-amber-800">일부 유형({facilities.failedTypes.map((t) => FACILITY_STYLE[t].short).join(", ")})은 받지 못했습니다. 잠시 뒤 다시 확인됩니다.</p>
          )}
          {nearbyOn.length > 0 && (
            <div role="status" aria-label="내 위치 주변 조회 범위" className="flex items-center justify-between gap-2 rounded-2xl bg-grey-100 p-2 text-sm text-grey-800">
              <span>
                {locating || !myLocation ? "현재 위치 확인 중…" : nearbyText}
              </span>
              {myLocation && !locating && (
                <button type="button" onClick={() => void locate()} className="min-h-12 shrink-0 rounded-2xl bg-white px-3 font-semibold text-grey-700">
                  위치 다시 확인
                </button>
              )}
            </div>
          )}
          {locationProblem && (
            <p role="alert" className="rounded-2xl bg-amber-50 p-2 text-sm text-amber-900">
              {locationProblem}
            </p>
          )}
          {parkingProblem && (
            <div role="alert" className="flex items-center justify-between gap-2 rounded-2xl bg-amber-50 p-2 text-sm text-amber-900">
              <span>주차장 정보를 불러오지 못했습니다.</span>
              <button type="button" onClick={retryParking} className="min-h-12 shrink-0 rounded-2xl bg-amber-700 px-3 font-semibold text-white">
                다시 시도
              </button>
            </div>
          )}
          {enforcementProblem && (
            <div role="alert" className="flex items-center justify-between gap-2 rounded-2xl bg-amber-50 p-2 text-sm text-amber-900">
              <span>주정차 단속 CCTV를 불러오지 못했습니다.</span>
              <button type="button" onClick={retryEnforcement} className="min-h-12 shrink-0 rounded-2xl bg-amber-700 px-3 font-semibold text-white">
                다시 시도
              </button>
            </div>
          )}
        </section>

        <ul aria-label="종류별 건수" className={`grid grid-cols-4 gap-2 ${PANEL}`}>
          {(["all", ...KINDS] as const).map((k) => {
            const count = k === "all" ? all.length : all.filter((i) => i.kind === k).length;
            return (
              <li key={k}>
                <button
                  type="button"
                  onClick={() => chooseKind(k)}
                  aria-pressed={kind === k}
                  className={`flex min-h-16 w-full flex-col items-center justify-center rounded-2xl p-2 ${kind === k ? "bg-brand-50 ring-2 ring-brand-600" : "bg-white"}`}
                >
                  <span className="text-xs text-grey-600">{k === "all" ? "전체" : INCIDENT_LABEL[k]}</span>
                  <span className="text-xl font-bold text-grey-900">{state.snapshot ? count : "–"}</span>
                </button>
              </li>
            );
          })}
        </ul>


        <div ref={mapBox} className="flex flex-col gap-2 md:col-span-2 xl:sticky xl:top-4 xl:col-span-1 xl:col-start-1 xl:row-span-7 xl:row-start-1 xl:self-start">
          <IncidentMap
            incidents={shown}
            focus={incidentFocus.focus}
            viewKey={kind}
            speedLines={showSpeeds ? filteredLines : EMPTY_LINES}
            speedObservedAt={speeds?.observedAt ?? null}
            heightClass="h-80 md:h-[60vh] xl:h-[calc(100dvh-7rem)]"
            overlay={mapOverlay}
            facilities={facilityPoints}
            nearby={nearbyOn.length > 0 && myLocation ? { ...myLocation, radiusMeters: ENFORCEMENT_RADIUS_METERS } : null}
            highlightIds={showSpeeds ? highlightIds : EMPTY_IDS}
          />
          <IncidentFocusBar state={incidentFocus} />
          {chain && (
            <div role="status" className="flex flex-wrap items-center gap-2 rounded-2xl bg-brand-50 p-2 text-sm text-brand-900">
              <span className="mr-auto font-semibold">
                {chain.label} {STATUS_STYLE[chain.status].label} · {sectionText(chain)} 표시 중
              </span>
              <button type="button" onClick={() => setChainKey(null)} className="min-h-12 rounded-2xl border border-brand-300 bg-white px-3 font-semibold text-brand-900">
                전체 보기
              </button>
            </div>
          )}
          {!chain && road && speedFilter !== "all" && (
            <div role="status" className="flex flex-wrap items-center gap-2 rounded-2xl bg-brand-50 p-2 text-sm text-brand-900">
              <span className="mr-auto font-semibold">
                {road.label} {STATUS_STYLE[speedFilter].label} {road.count}구간 표시 중
              </span>
              <button type="button" onClick={() => setRoadKey(null)} className="min-h-12 rounded-2xl border border-brand-300 bg-white px-3 font-semibold text-brand-900">
                전체 보기
              </button>
            </div>
          )}
        </div>

        {state.snapshot && groups.length > 0 && (
          <section aria-labelledby="groups-heading" className={`flex flex-col gap-2 self-start rounded-[20px] bg-white pt-4 ${PANEL}`}>
            <h2 id="groups-heading" className="px-4 font-bold text-grey-900">
              감지된 사건 {shown.length}건
            </h2>
            <IncidentGroupList groups={groups} focusedKey={incidentFocus.focusedKey} onFocus={focusGroup} />
          </section>
        )}
        {state.snapshot && shown.length === 0 && (
          <p className={`self-start rounded-2xl bg-grey-100 p-3 text-sm text-grey-700 ${PANEL}`}>
            {kind === "all" ? "현재 제주 ITS에 감지된 돌발·통제·공사가 없습니다." : `현재 제주 ITS에 감지된 ${INCIDENT_LABEL[kind]} 정보가 없습니다.`} 모든 도로의 사건이
            제공되지는 않으므로, 도로에 이상이 없다는 뜻은 아닙니다.
          </p>
        )}
      </main>
      <footer className="mt-auto flex flex-col gap-1 border-t border-grey-200 pt-3 text-xs text-grey-500">
        <p className="text-sm font-semibold text-amber-800">운전 중에는 화면을 조작하지 마세요.</p>
        <p>제주 ITS가 감지한 지점 정보이며, 발생 시각·상세와 모든 도로의 상황을 포함하지 않습니다. 위치정보는 주정차 단속·주차장을 켤 때만 한 번 확인하며, 이 기기에서 반경 계산에만 쓰고 서버로 보내거나 저장하지 않습니다.</p>
        <p>지도 © OpenStreetMap 기여자 · 교통 제주 ITS · 도로 모양 브이월드(국토교통부 교통링크) · 주정차 단속 CCTV 제주시·주차장 전국주차장정보표준데이터(공공데이터포털)</p>
      </footer>
    </div>
  );
}
