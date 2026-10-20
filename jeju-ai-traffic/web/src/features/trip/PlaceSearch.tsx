import { useId, useRef, useState, type FormEvent } from "react";
import type { ApiError } from "../../../../shared/contracts/common";
import type { Place } from "../../../../shared/contracts/place";
import { PLACE_QUERY_MAX_LENGTH } from "../../../../shared/contracts/place";
import { searchPlaces } from "../../services/placesApi";
import { errorMessage } from "./format";

type SearchState =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "results"; places: Place[] }
  | { kind: "error"; error: ApiError };

interface Props {
  label: string;
  placeholder: string;
  onSelect: (place: Place) => void;
}

/** 장소 검색. 버튼·엔터로만 검색한다(자동완성 없음). */
export function PlaceSearch({ label, placeholder, onSelect }: Props) {
  const inputId = useId();
  const [query, setQuery] = useState("");
  const [state, setState] = useState<SearchState>({ kind: "idle" });
  const abortRef = useRef<AbortController | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    const q = query.trim();
    if (!q) return;
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setState({ kind: "loading" });
    const result = await searchPlaces(q, controller.signal);
    if (controller.signal.aborted) return;
    setState(result.ok ? { kind: "results", places: result.data.places } : { kind: "error", error: result.error });
  }

  return (
    <div className="flex flex-col gap-2">
      <form onSubmit={submit} className="flex gap-2" role="search">
        <label htmlFor={inputId} className="sr-only">
          {label}
        </label>
        <input
          id={inputId}
          type="search"
          value={query}
          maxLength={PLACE_QUERY_MAX_LENGTH}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={placeholder}
          className="min-h-12 min-w-0 flex-1 rounded-2xl border-2 border-transparent bg-white px-3 text-base text-grey-900 placeholder:text-grey-400 focus:border-brand-600 focus:outline-none"
        />
        <button
          type="submit"
          disabled={!query.trim() || state.kind === "loading"}
          className="min-h-12 shrink-0 rounded-2xl bg-grey-800 px-4 font-semibold text-white disabled:bg-grey-300"
        >
          검색
        </button>
      </form>

      <div aria-live="polite">
        {state.kind === "loading" && <p className="text-sm text-grey-500">검색 중…</p>}
        {state.kind === "error" && (
          <p role="alert" className="rounded-2xl bg-red-50 p-3 text-sm text-red-800">
            {errorMessage(state.error)}
          </p>
        )}
        {state.kind === "results" && state.places.length === 0 && (
          <p className="rounded-2xl bg-grey-100 p-3 text-sm text-grey-700">제주에서 검색 결과가 없습니다.</p>
        )}
      </div>

      {state.kind === "results" && state.places.length > 0 && (
        <ul aria-label={`${label} 검색 결과`} className="flex flex-col divide-y divide-grey-200 rounded-2xl border border-grey-200 bg-white">
          {state.places.map((place) => (
            <li key={place.id}>
              <button
                type="button"
                onClick={() => onSelect(place)}
                className="flex min-h-12 w-full flex-col items-start px-3 py-2 text-left active:bg-grey-100"
              >
                <span className="font-medium text-grey-900">
                  {place.name}
                  {place.provider === "mock" && <span className="ml-2 text-xs font-normal text-amber-700">모의 데이터</span>}
                </span>
                <span className="text-sm text-grey-600">{place.roadAddress ?? place.address}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
