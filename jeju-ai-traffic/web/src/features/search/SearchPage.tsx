import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import type { ApiError } from "../../../../shared/contracts/common";
import type { Coordinate } from "../../../../shared/contracts/route";
import { SEARCH_CATEGORY_LABEL, SEARCH_NEAR_RADIUS, SEARCH_QUERY_MAX_LENGTH, type SearchIndexResponse, type SearchRow } from "../../../../shared/contracts/search";
import { searchPlaces } from "../../../../shared/rules/placeSearch";
import { getCurrentLocation } from "../../services/geolocation";
import { compareRoutes } from "../../services/routesApi";
import { fetchSearchDetail, fetchSearchIndex, fetchSearchPet, fetchTrafficParking } from "../../services/trafficApi";
import type { FacilityPoint, PopupCard } from "../map/leafletMap";
import { IncidentMap } from "../traffic/IncidentMap";
import {
  AREAS,
  AROUND_LABEL,
  AROUND_RADIUS,
  CATEGORY_STYLE,
  distText,
  feedLabel,
  ktoId,
  LABEL_ZOOM,
  PAGE,
  petId,
  placeCard,
  placesAround,
  sourceNames,
  SUGGESTIONS,
  type AroundKind,
  type CardContext,
  type Origin,
  type ParkingLots,
  type TravelState,
} from "./searchCards";

type Around = { id: string; kind: AroundKind };

function readUrl(): { q: string; pet: boolean; around: Around | null } {
  const p = new URLSearchParams(window.location.search);
  const id = p.get("around");
  const show = p.get("show");
  return {
    q: (p.get("q") ?? "").slice(0, SEARCH_QUERY_MAX_LENGTH),
    pet: p.get("pet") === "1",
    around: id && (show === "food" || show === "stay") ? { id: id.slice(0, 80), kind: show } : null,
  };
}

function urlOf(q: string, pet: boolean, around: Around | null): string {
  const p = new URLSearchParams();
  if (q) p.set("q", q);
  if (pet) p.set("pet", "1");
  if (around) {
    p.set("around", around.id);
    p.set("show", around.kind);
  }
  return `/search${p.toString() ? `?${p}` : ""}`;
}

/**
 * 현재 위치에서 자동차 소요시간: 카드를 열 때 기존 경로 조회 1건, 같은 관광지·같은 출발 위치는 이 화면에서 한 번(실패는 다시).
 * 출발 위치는 이 기기 메모리에만 둔다.
 */
const travels = new Map<string, Promise<TravelState>>();
function travelFor(from: Coordinate | null, row: SearchRow): Promise<TravelState> {
  if (!from) return Promise.resolve("noLocation");
  const key = `${from.lat.toFixed(4)},${from.lng.toFixed(4)}|${row[0]}`;
  const hit = travels.get(key);
  if (hit) return hit;
  const p = compareRoutes({ origin: from, destination: { lat: row[4], lng: row[5] } }).then((r): TravelState => {
    const best = r.ok ? (r.data.routes.find((x) => x.id === r.data.recommendedRouteId) ?? r.data.routes[0]) : undefined;
    if (!best) {
      travels.delete(key);
      return "failed";
    }
    return { seconds: best.durationSeconds, meters: best.distanceMeters, mock: best.provider === "mock" };
  });
  travels.set(key, p);
  return p;
}

/** 검색 결과가 이보다 많으면 지도에는 작은 점으로(관광지 표시 핀은 수백 개까지만). */
const PIN_LIMIT = 200;

/**
 * 제주 관광지 검색 페이지(TASK-031, /search). 처음 열면 관광지 전체를 지도에 점으로 보이고, 관광지만 검색한다(내 주변·반려동물 거르기).
 * 관광지를 누르면 운영시간·주차(없으면 반경 1km 무료·유료)·현재 위치에서 소요시간·반려동물·주변 맛집·숙소(2km, 지도에 보기).
 * 비짓제주·한국관광공사 목록은 페이지를 열 때 한 번 받아 이 기기에서 찾고 계산한다. 한 출처가 실패해도 나머지로 보인다.
 */
export function SearchPage() {
  const [initial] = useState(readUrl);
  const [input, setInput] = useState(initial.q);
  const [query, setQuery] = useState(initial.q);
  // 반려동물 동반 표시가 있는 곳만(관광공사 반려동물 동반여행·비짓제주 태그).
  const [petOnly, setPetOnly] = useState(initial.pet);
  const [around, setAround] = useState<Around | null>(initial.around);
  const [origin, setOrigin] = useState<Origin | null>(null);
  const [locating, setLocating] = useState(false);
  const [locationProblem, setLocationProblem] = useState<string | null>(null);
  const [index, setIndex] = useState<SearchIndexResponse | null>(null);
  const [indexError, setIndexError] = useState<ApiError | null>(null);
  const [indexLoading, setIndexLoading] = useState(true);
  const [indexTry, setIndexTry] = useState(0);
  const [shown, setShown] = useState(PAGE);
  const [open, setOpen] = useState<{ id: string; seq: number } | null>(null);
  const [searchSeq, setSearchSeq] = useState(0);
  const mapBox = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    let alive = true;
    void fetchSearchIndex().then((r) => {
      if (!alive) return;
      setIndexLoading(false);
      if (r.ok) setIndex(r.data);
      else setIndexError(r.error);
    });
    return () => {
      alive = false;
    };
  }, [indexTry]);
  const loadIndex = () => {
    setIndexLoading(true);
    setIndexError(null);
    setIndexTry((n) => n + 1);
  };
  // 주차 정보가 없는 곳의 반경 1km 주차장용(전국주차장정보표준데이터, CDN 7일). 페이지를 열 때 한 번.
  const [lots, setLots] = useState<ParkingLots>("loading");
  useEffect(() => {
    let alive = true;
    void fetchTrafficParking().then((r) => alive && setLots(r.ok ? r.data.lots : "failed"));
    return () => {
      alive = false;
    };
  }, []);
  // 소요시간용 위치: 페이지를 열 때 한 번 확인한다(TASK-031 4.(a)). 거부·실패면 안내 없이 "위치 허용 시 표시". 이 기기 메모리에만 둔다.
  const [myLocation, setMyLocation] = useState<Coordinate | null>(null);
  useEffect(() => {
    let alive = true;
    void getCurrentLocation().then((r) => alive && r.kind === "ok" && setMyLocation(r.location));
    return () => {
      alive = false;
    };
  }, []);

  // 주소에 검색어·반려동물 거르기·주변 보기를 남긴다(공유·새로 고침·뒤로 가기). 위치는 남기지 않는다.
  // 맛집↔숙소 전환처럼 주소만 바꿀 때도 쌓아 둔 표시(searchAround)는 그대로 둔다.
  useEffect(() => {
    const next = urlOf(query, petOnly, around);
    if (`${window.location.pathname}${window.location.search}` !== next) window.history.replaceState(window.history.state, "", next);
  }, [query, petOnly, around]);
  // 주변 맛집·숙소 화면에서 관광지로 돌아오면 그 관광지 카드를 다시 연다(TASK-032 범위 변경). 받아 둔 정보는 그대로 다시 쓴다.
  const reopen = (id: string) => setOpen((prev) => ({ id, seq: (prev?.seq ?? 0) + 1 }));
  const aroundNow = useRef(around);
  useEffect(() => {
    aroundNow.current = around;
  }, [around]);
  useEffect(() => {
    const onPop = () => {
      const next = readUrl().around;
      const prev = aroundNow.current;
      setAround(next);
      if (prev && !next) setOpen((o) => ({ id: prev.id, seq: (o?.seq ?? 0) + 1 }));
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);
  // "지도에 보기"는 주소를 새로 쌓아 뒤로 가기로 관광지 화면에 돌아온다(돌아오면 위의 popstate가 카드를 연다).
  // 공유 주소로 바로 연 경우에는 쌓은 것이 없어 바로 닫고 카드를 연다.
  const showAround = (a: Around) => {
    window.history.pushState({ searchAround: true }, "", urlOf(query, petOnly, a));
    setAround(a);
    setOpen(null);
  };
  const leaveAround = () => {
    if ((window.history.state as { searchAround?: boolean } | null)?.searchAround) {
      window.history.back();
      return;
    }
    const id = around?.id;
    setAround(null);
    if (id) reopen(id);
  };

  const places = useMemo(() => index?.places ?? [], [index]);
  const attractions = useMemo(() => places.filter((p) => p[1] === "ATTRACTION"), [places]);
  const isPet = (p: SearchRow) => p[12] === "YES" || petId(p) !== null;

  /** 카드를 열 때 관광공사 소개정보·반려동물 상세(있는 곳만)와, 관광지면 소요시간을 함께 받는다. */
  const pointFor = (row: SearchRow, ctx: (extra: Pick<CardContext, "detail" | "pet" | "travel">) => PopupCard, pinned: boolean, withTravel: boolean): FacilityPoint => {
    const kto = ktoId(row);
    const pid = petId(row);
    const st = CATEGORY_STYLE[row[1]];
    return {
      id: row[0],
      type: row[1] === "ATTRACTION" ? "TOUR" : "STAY",
      name: row[2],
      model: "",
      lat: row[4],
      lng: row[5],
      large: true,
      pin: pinned ? { mark: st.mark, price: null, color: st.color, low: false, dot: true, top: row[1] === "ATTRACTION" } : undefined,
      cardFn: () => ctx({ detail: kto ? "loading" : null, pet: pid ? "loading" : null, travel: withTravel ? (myLocation ? "loading" : "noLocation") : undefined }),
      loadCard: () =>
        Promise.all([kto ? fetchSearchDetail(kto, row[1]) : null, pid ? fetchSearchPet(pid) : null, withTravel ? travelFor(myLocation, row) : undefined]).then(([d, p, t]) =>
          ctx({ detail: d ? (d.ok ? d.data : "failed") : null, pet: p ? (p.ok ? p.data : "failed") : null, travel: t }),
        ),
    };
  };
  const listBuiltAt = index?.builtAt ?? null;
  const attractionPoint = (row: SearchRow, pinned: boolean) =>
    pointFor(row, (extra) => placeCard(row, { listBuiltAt, lots, ...extra, around: { food: placesAround(row, places, "food"), stay: placesAround(row, places, "stay"), onShow: (kind) => showAround({ id: row[0], kind }) } }), pinned, true);

  // 화면 상태: 주변 보기 > 검색(검색어·내 주변) > 처음(관광지 전체).
  const aroundSpot = around ? attractions.find((p) => p[0] === around.id) : undefined;
  const aroundList = useMemo(() => (aroundSpot && around ? placesAround(aroundSpot, places, around.kind) : []), [aroundSpot, around, places]);
  const searched = Boolean(query || origin);
  const hits = useMemo(() => {
    if (!searched) return [];
    const all = searchPlaces(attractions, { q: query, cat: "ATTRACTION", origin: origin?.at ?? null });
    return petOnly ? all.filter((h) => isPet(h.place)) : all;
  }, [searched, attractions, query, origin, petOnly]);
  const visible = hits.slice(0, shown);

  const points: FacilityPoint[] = useMemo(() => {
    if (aroundSpot && around) {
      return [
        attractionPoint(aroundSpot, true),
        ...aroundList.map(({ place, meters }) => pointFor(place, (extra) => placeCard(place, { listBuiltAt, lots, ...extra, from: { name: aroundSpot[2], meters } }), true, false)),
      ];
    }
    if (searched) return hits.map((h) => attractionPoint(h.place, hits.length <= PIN_LIMIT));
    const base = petOnly ? attractions.filter(isPet) : attractions;
    return base.map((row) => attractionPoint(row, petOnly));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 카드 함수는 아래 값으로만 바뀐다
  }, [aroundSpot, around, aroundList, searched, hits, petOnly, attractions, places, lots, myLocation, listBuiltAt]);

  const run = (q: string) => {
    setQuery(q.trim().slice(0, SEARCH_QUERY_MAX_LENGTH));
    setShown(PAGE);
    setOpen(null);
    setSearchSeq((n) => n + 1);
  };
  const submit = (e: FormEvent) => {
    e.preventDefault();
    run(input);
  };
  const clearSearch = () => {
    setInput("");
    setQuery("");
    setOrigin(null);
    setShown(PAGE);
    setOpen(null);
  };
  const locate = async () => {
    setLocating(true);
    setLocationProblem(null);
    const r = await getCurrentLocation();
    setLocating(false);
    if (r.kind === "ok") {
      setMyLocation(r.location);
      setOrigin({ kind: "me", name: "내 위치", at: r.location });
      setShown(PAGE);
      setSearchSeq((n) => n + 1);
      return;
    }
    const reason: Record<Exclude<typeof r.kind, "ok">, string> = {
      denied: "위치 권한이 꺼져 있습니다",
      timeout: "위치 확인 시간이 지났습니다",
      unavailable: "현재 위치를 확인할 수 없습니다",
      unsupported: "이 브라우저는 위치 확인을 지원하지 않습니다",
      inaccurate: "위치 오차가 큽니다",
      outsideJeju: "현재 위치가 제주 밖입니다",
    };
    setLocationProblem(`${reason[r.kind]}. 아래에서 지역을 고르거나 관광지 이름으로 검색하세요.`);
  };
  const pickArea = (a: (typeof AREAS)[number]) => {
    setOrigin({ kind: "area", name: a.name, at: a.at });
    setShown(PAGE);
    setSearchSeq((n) => n + 1);
  };
  const choose = (id: string) => {
    setOpen((prev) => ({ id, seq: (prev?.seq ?? 0) + 1 }));
    mapBox.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  const missing = index?.missing ?? [];
  const status = indexLoading
    ? "제주 관광지 불러오는 중…"
    : index
      ? `제주 관광지 ${attractions.length.toLocaleString("ko-KR")}곳${index.mock ? "(모의 데이터)" : ""} · 비짓제주·한국관광공사`
      : "관광지 목록을 불러오지 못했습니다";
  const mapNearby = aroundSpot ? { lat: aroundSpot[4], lng: aroundSpot[5], radiusMeters: AROUND_RADIUS, spot: true } : origin ? { lat: origin.at.lat, lng: origin.at.lng, radiusMeters: SEARCH_NEAR_RADIUS, spot: origin.kind === "area" } : null;

  return (
    <div className="mx-auto flex min-h-dvh max-w-md flex-col gap-4 bg-grey-100 p-4 md:max-w-5xl xl:max-w-[96rem]">
      <main className="flex flex-col gap-3">
        <div className="flex items-center justify-between gap-2">
          <a href="/" className="text-sm font-semibold text-brand-700">
            ← 홈
          </a>
          <a href="/route" className="text-sm font-semibold text-brand-700">
            경로 추천 →
          </a>
        </div>
        <h1 className="text-[26px] font-bold tracking-tight text-grey-900">제주 관광지 검색</h1>
        {!aroundSpot && (
          <>
            <form role="search" onSubmit={submit} className="flex gap-2">
              <input
                type="search"
                value={input}
                maxLength={SEARCH_QUERY_MAX_LENGTH}
                onChange={(e) => setInput(e.target.value)}
                placeholder="관광지 이름이나 지역(예: 성산, 오름)"
                aria-label="관광지 검색어"
                enterKeyHint="search"
                className="min-h-12 min-w-0 flex-1 rounded-2xl bg-white px-4 text-base text-grey-900 shadow-sm ring-1 ring-grey-300 placeholder:text-grey-500 focus:outline-none focus:ring-2 focus:ring-brand-500"
              />
              <button type="submit" className="min-h-12 shrink-0 rounded-2xl bg-brand-600 px-4 font-semibold text-white active:bg-brand-700">
                검색
              </button>
            </form>
            <div className="flex flex-wrap items-center gap-2">
              <button type="button" onClick={() => void locate()} disabled={locating} className="min-h-10 rounded-full bg-white px-3 text-sm font-semibold text-brand-700 ring-1 ring-brand-300 disabled:opacity-60">
                {locating ? "위치 확인 중…" : origin?.kind === "me" ? "내 주변 ✓" : "내 주변"}
              </button>
              <button
                type="button"
                aria-pressed={petOnly}
                onClick={() => {
                  setPetOnly((v) => !v);
                  setShown(PAGE);
                }}
                className={`min-h-10 rounded-full px-3 text-sm font-semibold ring-1 ${petOnly ? "bg-emerald-700 text-white ring-emerald-700" : "bg-white text-emerald-800 ring-emerald-300"}`}
              >
                🐾 반려동물 동반
              </button>
              {searched && (
                <button type="button" onClick={clearSearch} className="min-h-10 rounded-full px-2 text-sm text-grey-600 underline">
                  검색 지우고 전체 보기
                </button>
              )}
            </div>
            {locationProblem && (
              <div role="alert" className="flex flex-col gap-2 rounded-2xl bg-amber-50 p-3 text-sm text-amber-900 ring-1 ring-amber-200">
                <p>{locationProblem}</p>
                <div role="group" aria-label="지역 고르기" className="flex flex-wrap gap-1.5">
                  {AREAS.map((a) => (
                    <button key={a.name} type="button" aria-pressed={origin?.name === a.name} onClick={() => pickArea(a)} className={`min-h-10 rounded-full px-3 font-semibold ring-1 ${origin?.name === a.name ? "bg-amber-800 text-white ring-amber-800" : "bg-white text-amber-900 ring-amber-300"}`}>
                      {a.name}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </>
        )}
        <p role="status" aria-label="검색 자료 상태" className="text-xs text-grey-600">
          {status}
        </p>
        {indexError && (
          <div role="alert" className="flex items-center justify-between gap-3 rounded-2xl bg-amber-50 p-3 text-sm text-amber-900 ring-1 ring-amber-200">
            <p>관광지 목록을 불러오지 못했습니다. {indexError.message}</p>
            <button type="button" onClick={loadIndex} className="min-h-12 shrink-0 rounded-2xl bg-amber-700 px-3 font-semibold text-white">
              다시 시도
            </button>
          </div>
        )}
        {missing.length > 0 && (
          <p role="alert" aria-label="일부 정보 누락" className="rounded-2xl bg-amber-50 p-3 text-sm text-amber-900 ring-1 ring-amber-200">
            일부 정보 누락: {missing.map(feedLabel).join(", ")}을(를) 불러오지 못했습니다. 다른 출처 결과만 보여 줍니다.
          </p>
        )}
        <div className="grid grid-cols-1 gap-3 md:grid-cols-[minmax(0,1fr)_minmax(0,24rem)] md:items-start xl:grid-cols-[minmax(0,1fr)_minmax(0,28rem)]">
          <div ref={mapBox} className="scroll-mt-4 md:sticky md:top-4">
            <IncidentMap
              incidents={[]}
              focus={null}
              viewKey={aroundSpot ? `around:${aroundSpot[0]}:${around?.kind}` : "search"}
              label="관광지 검색 지도"
              heightClass="h-[68vh] md:h-[calc(100dvh-12rem)] md:min-h-[28rem]"
              facilities={points}
              openFacility={open}
              nearby={mapNearby}
              fitKey={!aroundSpot && query && points.length ? `${searchSeq}:${query}:${petOnly}` : null}
              labelZoom={LABEL_ZOOM}
              overlay={indexLoading ? "관광지 불러오는 중…" : null}
            />
          </div>
          <section aria-labelledby="search-results" className="flex flex-col gap-2">
            {aroundSpot && around ? (
              <>
                <div className="flex flex-col gap-2 rounded-[20px] bg-white p-3 shadow-sm ring-1 ring-grey-200">
                  <h2 id="search-results" className="font-bold text-grey-900">
                    {aroundSpot[2]} 주변 {AROUND_LABEL[around.kind]} · 반경 {AROUND_RADIUS / 1000}km {aroundList.length.toLocaleString("ko-KR")}곳
                  </h2>
                  <div className="flex flex-wrap gap-1.5">
                    {(["food", "stay"] as const).map((k) => (
                      <button
                        key={k}
                        type="button"
                        aria-pressed={around.kind === k}
                        onClick={() => setAround({ id: aroundSpot[0], kind: k })}
                        className={`min-h-10 rounded-full px-3 text-sm font-semibold ring-1 ${around.kind === k ? "bg-grey-900 text-white ring-grey-900" : "bg-white text-grey-700 ring-grey-300"}`}
                      >
                        주변 {AROUND_LABEL[k]}
                      </button>
                    ))}
                    <button type="button" onClick={leaveAround} className="min-h-10 rounded-full px-3 text-sm font-semibold text-brand-700 ring-1 ring-brand-300">
                      ← 관광지로
                    </button>
                  </div>
                </div>
                {aroundList.length === 0 && <p className="rounded-[20px] bg-white p-3 text-sm text-grey-700 shadow-sm ring-1 ring-grey-200">반경 {AROUND_RADIUS / 1000}km 안에 {AROUND_LABEL[around.kind]} 정보가 없습니다.</p>}
                <ol aria-label="주변 목록" className="flex flex-col gap-2">
                  {aroundList.slice(0, shown).map(({ place, meters }) => (
                    <ResultItem key={place[0]} place={place} meters={meters} onChoose={choose} />
                  ))}
                </ol>
              </>
            ) : searched ? (
              <>
                <h2 id="search-results" className="font-bold text-grey-900">
                  관광지 {hits.length.toLocaleString("ko-KR")}곳
                  <span className="ml-1 text-sm font-normal text-grey-600">{!query && origin ? `${origin.name} 반경 ${SEARCH_NEAR_RADIUS / 1000}km` : origin ? `${origin.name}에서 가까운 순` : ""}</span>
                </h2>
                {!hits.length && !indexLoading && (
                  <p className="rounded-[20px] bg-white p-3 text-sm text-grey-700 shadow-sm ring-1 ring-grey-200">
                    {petOnly ? "반려동물 동반 표시가 있는 관광지가 없습니다. 표시가 없다고 동반이 안 되는 것은 아니니, 거르기를 끄고 상세에서 확인하세요." : "검색 결과가 없습니다. 다른 이름이나 지역으로 찾아 보세요."}
                  </p>
                )}
                <ol aria-label="검색 결과" className="flex flex-col gap-2">
                  {visible.map(({ place, meters }) => (
                    <ResultItem key={place[0]} place={place} meters={meters} onChoose={choose} />
                  ))}
                </ol>
              </>
            ) : (
              <div className="flex flex-col gap-2 rounded-[20px] bg-white p-3 text-sm text-grey-700 shadow-sm ring-1 ring-grey-200">
                <h2 id="search-results" className="font-bold text-grey-900">
                  지도에 {petOnly ? "반려동물 동반 " : ""}관광지 {points.length.toLocaleString("ko-KR")}곳
                </h2>
                <p>지도의 점을 누르면 운영시간·주차·소요시간·주변 맛집·숙소를 볼 수 있습니다. 많이 확대하면 이름이 보입니다.</p>
                <div className="flex flex-wrap gap-1.5">
                  {SUGGESTIONS.map((s) => (
                    <button
                      key={s}
                      type="button"
                      onClick={() => {
                        setInput(s);
                        run(s);
                      }}
                      className="min-h-10 rounded-full bg-grey-100 px-3 font-semibold text-grey-800"
                    >
                      {s}
                    </button>
                  ))}
                </div>
              </div>
            )}
            {(aroundSpot ? aroundList.length : searched ? hits.length : 0) > shown && (
              <button type="button" onClick={() => setShown((n) => n + PAGE)} className="min-h-12 rounded-2xl bg-white font-semibold text-brand-700 shadow-sm ring-1 ring-grey-200">
                더 보기 ({((aroundSpot ? aroundList.length : hits.length) - shown).toLocaleString("ko-KR")}곳 남음)
              </button>
            )}
          </section>
        </div>
      </main>
      <footer className="mt-auto flex flex-col gap-1 border-t border-grey-200 pt-3 text-xs text-grey-500">
        <p>관광지·맛집·숙소 비짓제주(제주관광공사)·한국관광공사 국문 관광정보·반려동물 동반여행. 이름이 같고 100m 안인 곳만 한 장소로 합칩니다.</p>
        <p>운영시간은 한국관광공사 자료가 있는 곳만, 주차는 관광공사·비짓제주 태그, 없으면 전국주차장정보표준데이터(반경 1km)로 보입니다. "정보 없음"은 없다는 뜻이 아닙니다.</p>
        <p>위치는 소요시간·"내 주변"에만 쓰고 저장하지 않습니다. 소요시간은 카카오모빌리티 자동차 경로 기준입니다.</p>
        <p>지도 © 카카오(쓸 수 없을 때 브이월드(국토교통부)·OpenStreetMap 기여자)</p>
      </footer>
    </div>
  );
}

/** 목록 한 줄: 사진(없으면 카테고리 표시)·이름·거리·카테고리·주소·주차장/반려동물 표시·출처. */
function ResultItem({ place, meters, onChoose }: { place: SearchRow; meters: number | null; onChoose: (id: string) => void }) {
  const st = CATEGORY_STYLE[place[1]];
  return (
    <li>
      <button type="button" onClick={() => onChoose(place[0])} className="flex w-full gap-3 rounded-[20px] bg-white p-3 text-left shadow-sm ring-1 ring-grey-200 active:bg-grey-50">
        {place[7] ? (
          <img src={place[7]} alt="" loading="lazy" referrerPolicy="no-referrer" className="h-16 w-16 shrink-0 rounded-xl bg-grey-100 object-cover" />
        ) : (
          <span className="flex h-16 w-16 shrink-0 items-center justify-center rounded-xl text-lg font-bold text-white" style={{ backgroundColor: st.color }} aria-hidden="true">
            {st.mark}
          </span>
        )}
        <span className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="flex items-baseline gap-2">
            <span className="truncate font-bold text-grey-900">{place[2]}</span>
            {meters !== null && <span className="shrink-0 text-sm tabular-nums text-grey-600">{distText(meters)}</span>}
          </span>
          <span className="text-xs font-semibold" style={{ color: st.color }}>
            {SEARCH_CATEGORY_LABEL[place[1]]}
          </span>
          <span className="truncate text-sm text-grey-600">{place[3] || "주소 정보 없음"}</span>
          <span className="flex flex-wrap items-center gap-1.5 text-xs text-grey-500">
            {place[11] && <span className="rounded-md bg-blue-50 px-1.5 py-0.5 font-semibold text-blue-800">P 주차장</span>}
            {place[12] === "YES" && <span className="rounded-md bg-emerald-50 px-1.5 py-0.5 font-semibold text-emerald-800">🐾 동반 가능{petId(place) ? "(관광공사)" : ""}</span>}
            <span>출처 {sourceNames(place)}</span>
          </span>
        </span>
      </button>
    </li>
  );
}
