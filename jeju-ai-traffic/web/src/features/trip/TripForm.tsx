import { useRef, useState } from "react";
import type { Place } from "../../../../shared/contracts/place";
import { checkTrip, type TripProblem } from "../../../../shared/rules/geo";
import type { LocationResult } from "../../services/geolocation";
import { OriginPicker } from "./OriginPicker";
import { PlaceSearch } from "./PlaceSearch";
import { originLocation, type Origin } from "./types";

const PROBLEM_TEXT: Record<TripProblem, string> = {
  originMissing: "출발지를 정하세요.",
  originInvalid: "출발지가 올바르지 않습니다. 제주 안의 출발지를 다시 정하세요.",
  destinationMissing: "목적지를 검색해서 선택하세요.",
  destinationInvalid: "목적지가 올바르지 않습니다. 다른 목적지를 선택하세요.",
  samePlace: "출발지와 목적지가 같습니다. 다른 목적지를 선택하세요.",
};

interface Props {
  onRequestRoute: (origin: Origin, destination: Place) => void;
  /** 출발지·목적지가 바뀌면 호출한다(이전 경로 결과를 지우는 데 쓴다). */
  onSelectionChange?: () => void;
  busy?: boolean;
  locate?: () => Promise<LocationResult>;
  /** 처음부터 정해 둔 목적지(교통 현황의 주차장, TASK-017). */
  initialDestination?: Place | null;
  /** true면 현재 위치를 바로 확인하고, 출발지가 정해지면 한 번 자동으로 조회한다. */
  autoStart?: boolean;
}

function Selected({ title, detail, onClear }: { title: string; detail: string; onClear: () => void }) {
  return (
    <div className="flex items-center justify-between gap-2 rounded-[20px] bg-white p-4">
      <div className="min-w-0">
        <p className="truncate font-semibold text-grey-900">{title}</p>
        <p className="truncate text-sm text-grey-600">{detail}</p>
      </div>
      <button type="button" onClick={onClear} className="min-h-12 shrink-0 px-3 text-sm font-semibold text-brand-700">
        변경
      </button>
    </div>
  );
}

/** 출발지·목적지 선택과 경로 조회 버튼(AC-001-04, AC-002-04). */
export function TripForm({ onRequestRoute, onSelectionChange, busy = false, locate, initialDestination = null, autoStart = false }: Props) {
  const [origin, setOriginState] = useState<Origin | null>(null);
  const [destination, setDestinationState] = useState<Place | null>(initialDestination);
  const autoPending = useRef(autoStart);
  const setOrigin = (o: Origin | null) => {
    setOriginState(o);
    onSelectionChange?.();
    // 자동 조회는 처음 한 번만(출발지·목적지가 정상일 때).
    if (o && autoPending.current && destination && checkTrip(originLocation(o), destination.location) === null) {
      autoPending.current = false;
      onRequestRoute(o, destination);
    }
  };
  const setDestination = (d: Place | null) => {
    setDestinationState(d);
    onSelectionChange?.();
  };
  const problem = checkTrip(origin && originLocation(origin), destination?.location ?? null);

  return (
    <div className="flex flex-col gap-5">
      <section aria-labelledby="origin-heading" className="flex flex-col gap-2">
        <h2 id="origin-heading" className="text-lg font-bold text-grey-900">
          출발지
        </h2>
        {origin ? (
          <Selected
            title={origin.kind === "current" ? "현재 위치" : origin.place.name}
            detail={
              origin.kind === "current"
                ? `오차 약 ±${origin.accuracyMeters}m`
                : (origin.place.roadAddress ?? origin.place.address)
            }
            onClear={() => setOrigin(null)}
          />
        ) : (
          <OriginPicker onChange={setOrigin} locate={locate} autoLocate={autoStart} />
        )}
      </section>

      <section aria-labelledby="destination-heading" className="flex flex-col gap-2">
        <h2 id="destination-heading" className="text-lg font-bold text-grey-900">
          목적지
        </h2>
        {destination ? (
          <Selected
            title={destination.name}
            detail={`${destination.roadAddress ?? destination.address}${destination.provider === "parking" ? " · 교통 현황에서 고른 주차장" : ""}`}
            onClear={() => setDestination(null)}
          />
        ) : (
          <PlaceSearch label="목적지" placeholder="목적지 장소·주소" onSelect={setDestination} />
        )}
      </section>

      <div className="flex flex-col gap-2">
        {problem && (origin || destination) && (
          <p className="text-sm text-grey-600" aria-live="polite">
            {PROBLEM_TEXT[problem]}
          </p>
        )}
        {/* 휴대폰은 화면 아래 고정 버튼(TASK-012 디자인 4.), 넓은 화면(md)은 제자리 */}
        <div className="pointer-events-none fixed inset-x-0 bottom-0 z-[1000] bg-gradient-to-t from-grey-100 via-grey-100/95 to-transparent px-4 pt-6 pb-[calc(1rem+env(safe-area-inset-bottom))] md:pointer-events-auto md:static md:z-auto md:bg-none md:p-0">
          <button
            type="button"
            disabled={problem !== null || busy}
            onClick={() => origin && destination && onRequestRoute(origin, destination)}
            className="pointer-events-auto mx-auto block min-h-14 w-full max-w-md rounded-2xl bg-brand-700 text-[17px] font-semibold text-white active:bg-brand-800 disabled:bg-grey-300 md:max-w-none"
          >
            경로 조회
          </button>
        </div>
      </div>
    </div>
  );
}
