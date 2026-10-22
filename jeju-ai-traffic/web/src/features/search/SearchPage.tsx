import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import type { ApiError } from "../../../../shared/contracts/common";
import { SEARCH_CATEGORY_LABEL, SEARCH_NEAR_RADIUS, SEARCH_QUERY_MAX_LENGTH, type SearchIndexResponse, type SearchRow } from "../../../../shared/contracts/search";
import { mergePlaces } from "../../../../shared/rules/placeMerge";
import { searchPlaces, type SearchHit } from "../../../../shared/rules/placeSearch";
import { getCurrentLocation } from "../../services/geolocation";
import { fetchSearchDetail, fetchSearchIndex, fetchSearchLive, fetchTrafficParking } from "../../services/trafficApi";
import type { FacilityPoint } from "../map/leafletMap";
import { IncidentMap } from "../traffic/IncidentMap";
import { AREAS, CATEGORY_STYLE, CHIPS, chipLabel, distText, feedLabel, ktoId, PAGE, placeCard, sourceNames, SUGGESTIONS, type Cat, type Origin, type ParkingLots } from "./searchCards";

function readUrl(): { q: string; cat: Cat; pet: boolean } {
  const p = new URLSearchParams(window.location.search);
  const cat = p.get("cat") ?? "ALL";
  return { q: (p.get("q") ?? "").slice(0, SEARCH_QUERY_MAX_LENGTH), cat: (CHIPS as string[]).includes(cat) ? (cat as Cat) : "ALL", pet: p.get("pet") === "1" };
}

type Live = { rows: SearchRow[]; at: string | null; failed: ApiError | null; loading: boolean };
const NO_LIVE: Live = { rows: [], at: null, failed: null, loading: false };

/**
 * 제주 관광 통합 검색 페이지(TASK-029, /search). 비짓제주·한국관광공사 목록은 페이지를 열 때 한 번 받아 이 기기에서 찾고,
 * 음식점·카페는 검색할 때마다 카카오 로컬에서 실시간으로 더해 같은 장소를 합친다. 한 출처가 실패해도 나머지 결과를 보인다.
 */
export function SearchPage() {
  const [initial] = useState(readUrl);
  const [input, setInput] = useState(initial.q);
  const [query, setQuery] = useState(initial.q);
  const [cat, setCat] = useState<Cat>(initial.cat);
  // 반려동물 동반 표시가 있는 곳만(범위 변경 2026-10-23). 목록에서는 비짓제주 태그로 거른다.
  const [petOnly, setPetOnly] = useState(initial.pet);
  const [origin, setOrigin] = useState<Origin | null>(null);
  const [locating, setLocating] = useState(false);
  const [locationProblem, setLocationProblem] = useState<string | null>(null);
  const [index, setIndex] = useState<SearchIndexResponse | null>(null);
  const [indexError, setIndexError] = useState<ApiError | null>(null);
  const [indexLoading, setIndexLoading] = useState(true);
  const [liveResult, setLiveResult] = useState<(Live & { key: string }) | null>(null);
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
  // 주차 정보가 없는 곳의 반경 1km 주차장용(전국주차장정보표준데이터, CDN 7일). 페이지를 열 때 한 번.
  const [lots, setLots] = useState<ParkingLots>("loading");
  useEffect(() => {
    let alive = true;
    void fetchTrafficParking().then((r) => alive && setLots(r.ok ? r.data.lots : "failed"));
    return () => {
      alive = false;
    };
  }, []);
  const loadIndex = () => {
    setIndexLoading(true);
    setIndexError(null);
    setIndexTry((n) => n + 1);
  };

  // 주소에 검색어·카테고리를 남긴다(공유·새로 고침). 위치는 남기지 않는다.
  useEffect(() => {
    const p = new URLSearchParams();
    if (query) p.set("q", query);
    if (cat !== "ALL") p.set("cat", cat);
    if (petOnly) p.set("pet", "1");
    const next = `/search${p.toString() ? `?${p}` : ""}`;
    if (`${window.location.pathname}${window.location.search}` !== next) window.history.replaceState(null, "", next);
  }, [query, cat, petOnly]);

  // 카카오 실시간(음식점·카페). 관광지·숙박만 고르면 부르지 않는다. 요청마다 key를 붙여, 늦게 온 이전 응답은 쓰지 않는다.
  const originAt = origin?.at;
  const liveKey = (query || originAt) && cat !== "ATTRACTION" && cat !== "ACCOMMODATION" ? JSON.stringify([query, cat, originAt ?? null]) : null;
  useEffect(() => {
    if (!liveKey) return;
    const [q, c, o] = JSON.parse(liveKey) as [string, string, { lat: number; lng: number } | null];
    const ctl = new AbortController();
    void fetchSearchLive({ q, cat: c, origin: o }, ctl.signal).then((r) => {
      if (ctl.signal.aborted) return;
      setLiveResult(r.ok ? { key: liveKey, rows: r.data.places, at: r.data.observedAt, failed: null, loading: false } : { key: liveKey, ...NO_LIVE, failed: r.error });
    });
    return () => ctl.abort();
  }, [liveKey]);
  const live: Live = !liveKey ? NO_LIVE : liveResult?.key === liveKey ? liveResult : { ...NO_LIVE, loading: true };

  const allHits: SearchHit[] = useMemo(() => {
    const q = { q: query, cat, origin: originAt ?? null };
    const base = index ? searchPlaces(index.places, q) : [];
    if (!live.rows.length) return base;
    // 카카오 결과와 목록 결과를 합친 뒤(이름 같고 100m 안) 다시 줄 세운다. 카카오가 찾아 준 곳은 이름이 달라도 남긴다.
    return searchPlaces(mergePlaces([base.map((h) => h.place), live.rows]), { ...q, keepUnmatched: true });
  }, [index, live.rows, query, cat, originAt]);

  const hits = useMemo(() => (petOnly ? allHits.filter((h) => h.place[12] === "YES") : allHits), [allHits, petOnly]);
  const visible = hits.slice(0, shown);
  const visibleKey = visible.map((h) => h.place[0]).join(",");
  const at = { listBuiltAt: index?.builtAt ?? null, liveAt: live.at };
  const points: FacilityPoint[] = useMemo(
    () =>
      visible.map(({ place, meters }) => ({
        id: place[0],
        type: "TOUR",
        name: place[2],
        model: "",
        lat: place[4],
        lng: place[5],
        pin: { mark: CATEGORY_STYLE[place[1]].mark, price: null, color: CATEGORY_STYLE[place[1]].color, low: false, dot: true, top: true },
        // 관광공사 자료가 있으면 카드를 열 때 운영시간·주차·반려동물을 받는다(범위 변경 2026-10-23).
        ...(() => {
          const kto = ktoId(place);
          if (!kto) return { card: placeCard(place, meters, at, origin?.name ?? null, null, lots) };
          return {
            card: placeCard(place, meters, at, origin?.name ?? null, "loading", lots),
            loadCard: () => fetchSearchDetail(kto, place[1]).then((r) => placeCard(place, meters, at, origin?.name ?? null, r.ok ? r.data : "failed", lots)),
          };
        })(),
      })),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- at은 index·live에서 나온다
    [visibleKey, index, live.at, origin, lots],
  );

  const run = (q: string, c: Cat = cat) => {
    setQuery(q.trim().slice(0, SEARCH_QUERY_MAX_LENGTH));
    setCat(c);
    setShown(PAGE);
    setOpen(null);
    setSearchSeq((n) => n + 1);
  };
  const submit = (e: FormEvent) => {
    e.preventDefault();
    run(input);
  };
  const locate = async () => {
    setLocating(true);
    setLocationProblem(null);
    const r = await getCurrentLocation();
    setLocating(false);
    if (r.kind === "ok") {
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
    setLocationProblem(`${reason[r.kind]}. 아래에서 지역을 고르거나 지역 이름(예: 애월 카페)으로 검색하세요.`);
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

  const searched = Boolean(query || origin);
  const nearOnly = !query && origin;
  const missing = index?.missing ?? [];
  const status = indexLoading
    ? "관광 정보 목록 불러오는 중…"
    : index
      ? `비짓제주·한국관광공사 ${index.places.length.toLocaleString("ko-KR")}곳${index.mock ? "(모의 데이터)" : ""} · 음식점·카페는 카카오 실시간 추가`
      : "목록을 불러오지 못했습니다";

  return (
    <div className="mx-auto flex min-h-dvh max-w-md flex-col gap-4 bg-grey-100 p-4 md:max-w-5xl xl:max-w-[96rem]">
      <main className="flex flex-col gap-3">
        <div className="flex items-center justify-between gap-2">
          <a href="/" className="text-sm font-semibold text-brand-700">
            ← 대시보드
          </a>
          <a href="/route" className="text-sm font-semibold text-brand-700">
            경로 추천 →
          </a>
        </div>
        <h1 className="text-[26px] font-bold tracking-tight text-grey-900">제주 관광 검색</h1>
        <form role="search" onSubmit={submit} className="flex gap-2">
          <input
            type="search"
            value={input}
            maxLength={SEARCH_QUERY_MAX_LENGTH}
            onChange={(e) => setInput(e.target.value)}
            placeholder="관광지·숙소·맛집·카페 이름이나 지역"
            aria-label="관광 검색어"
            enterKeyHint="search"
            className="min-h-12 min-w-0 flex-1 rounded-2xl bg-white px-4 text-base text-grey-900 shadow-sm ring-1 ring-grey-300 placeholder:text-grey-500 focus:outline-none focus:ring-2 focus:ring-brand-500"
          />
          <button type="submit" className="min-h-12 shrink-0 rounded-2xl bg-brand-600 px-4 font-semibold text-white active:bg-brand-700">
            검색
          </button>
        </form>
        <div className="flex flex-wrap items-center gap-2">
          <div role="group" aria-label="카테고리" className="flex flex-wrap gap-1.5">
            {CHIPS.map((c) => (
              <button
                key={c}
                type="button"
                aria-pressed={cat === c}
                onClick={() => run(query, c)}
                className={`min-h-10 rounded-full px-3 text-sm font-semibold ring-1 ${cat === c ? "bg-grey-900 text-white ring-grey-900" : "bg-white text-grey-700 ring-grey-300"}`}
              >
                {c !== "ALL" && <span className="mr-1 inline-block h-2.5 w-2.5 rounded-full align-middle" style={{ backgroundColor: CATEGORY_STYLE[c].color }} aria-hidden="true" />}
                {chipLabel(c)}
              </button>
            ))}
          </div>
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
          {origin && (
            <button type="button" onClick={() => setOrigin(null)} className="min-h-10 rounded-full px-2 text-sm text-grey-600 underline">
              {origin.name} 기준 해제
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
        <p role="status" aria-label="검색 자료 상태" className="text-xs text-grey-600">
          {status}
        </p>
        {indexError && (
          <div role="alert" className="flex items-center justify-between gap-3 rounded-2xl bg-amber-50 p-3 text-sm text-amber-900 ring-1 ring-amber-200">
            <p>비짓제주·한국관광공사 목록을 불러오지 못했습니다{live.rows.length ? ". 카카오 결과만 보여 줍니다" : ""}. {indexError.message}</p>
            <button type="button" onClick={loadIndex} className="min-h-12 shrink-0 rounded-2xl bg-amber-700 px-3 font-semibold text-white">
              다시 시도
            </button>
          </div>
        )}
        {(missing.length > 0 || live.failed) && (
          <p role="alert" aria-label="일부 정보 누락" className="rounded-2xl bg-amber-50 p-3 text-sm text-amber-900 ring-1 ring-amber-200">
            일부 정보 누락: {[...missing.map(feedLabel), ...(live.failed ? ["카카오 실시간 음식점·카페"] : [])].join(", ")}을(를) 불러오지 못했습니다. 다른 출처 결과만 보여 줍니다.
          </p>
        )}
        <div className="grid grid-cols-1 gap-3 md:grid-cols-[minmax(0,1fr)_minmax(0,24rem)] md:items-start xl:grid-cols-[minmax(0,1fr)_minmax(0,28rem)]">
          <div ref={mapBox} className="scroll-mt-4 md:sticky md:top-4">
            <IncidentMap
              incidents={[]}
              focus={null}
              viewKey="search"
              label="관광 검색 지도"
              heightClass={searched ? "h-[68vh] md:h-[calc(100dvh-14rem)] md:min-h-[28rem]" : "h-56 md:h-[calc(100dvh-14rem)] md:min-h-[28rem]"}
              facilities={points}
              openFacility={open}
              nearby={origin ? { lat: origin.at.lat, lng: origin.at.lng, radiusMeters: SEARCH_NEAR_RADIUS, spot: origin.kind === "area" } : null}
              fitKey={query && points.length ? `${searchSeq}:${query}:${cat}` : null}
              overlay={indexLoading && !searched ? "관광 정보 불러오는 중…" : null}
            />
          </div>
          <section aria-labelledby="search-results" className="flex flex-col gap-2">
            <h2 id="search-results" className="font-bold text-grey-900">
              {searched ? `검색 결과 ${hits.length.toLocaleString("ko-KR")}곳` : "검색해 보세요"}
              {searched && (
                <span className="ml-1 text-sm font-normal text-grey-600">
                  {nearOnly ? `${origin!.name} 반경 ${SEARCH_NEAR_RADIUS / 1000}km` : origin ? `${origin.name}에서 가까운 순` : ""}
                  {live.loading ? " · 카카오 찾는 중…" : ""}
                </span>
              )}
            </h2>
            {!searched && (
              <div className="flex flex-col gap-2 rounded-[20px] bg-white p-3 text-sm text-grey-700 shadow-sm ring-1 ring-grey-200">
                <p>이름이나 지역을 입력하거나 "내 주변"을 누르세요. 카테고리로 좁힐 수 있습니다.</p>
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
            {searched && !hits.length && !indexLoading && !live.loading && (
              <p className="rounded-[20px] bg-white p-3 text-sm text-grey-700 shadow-sm ring-1 ring-grey-200">{petOnly && allHits.length ? "반려동물 동반 표시가 있는 곳이 없습니다. 표시가 없다고 동반이 안 되는 것은 아니니, 거르기를 끄고 상세에서 확인하세요." : "검색 결과가 없습니다. 다른 검색어나 카테고리를 골라 보세요."}</p>
            )}
            {visible.length > 0 && (
              <ol aria-label="검색 결과" className="flex flex-col gap-2">
                {visible.map(({ place, meters }) => {
                  const st = CATEGORY_STYLE[place[1]];
                  return (
                    <li key={place[0]}>
                      <button type="button" onClick={() => choose(place[0])} className="flex w-full gap-3 rounded-[20px] bg-white p-3 text-left shadow-sm ring-1 ring-grey-200 active:bg-grey-50">
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
                            {place[12] === "YES" && <span className="rounded-md bg-emerald-50 px-1.5 py-0.5 font-semibold text-emerald-800">🐾 동반 가능</span>}
                            <span>출처 {sourceNames(place)}</span>
                          </span>
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ol>
            )}
            {hits.length > shown && (
              <button type="button" onClick={() => setShown((n) => n + PAGE)} className="min-h-12 rounded-2xl bg-white font-semibold text-brand-700 shadow-sm ring-1 ring-grey-200">
                더 보기 ({(hits.length - shown).toLocaleString("ko-KR")}곳 남음)
              </button>
            )}
          </section>
        </div>
      </main>
      <footer className="mt-auto flex flex-col gap-1 border-t border-grey-200 pt-3 text-xs text-grey-500">
        <p>관광지·숙박·음식점 비짓제주(제주관광공사)·한국관광공사 국문 관광정보, 음식점·카페 카카오 로컬(실시간, 저장하지 않음). 이름이 같고 100m 안인 곳만 한 장소로 합칩니다.</p>
        <p>운영시간·주차·반려동물은 한국관광공사 상세(카드를 열 때)와 비짓제주 태그에 있는 곳만 나옵니다. "정보 없음"은 없다는 뜻이 아닙니다.</p>
        <p>위치는 "내 주변"을 누를 때만 확인하고 저장하지 않습니다. 카카오 검색에는 약 100m 단위로 줄인 위치만 보냅니다.</p>
        <p>지도 © 브이월드(국토교통부)·OpenStreetMap 기여자</p>
      </footer>
    </div>
  );
}
