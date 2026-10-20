import { useState } from "react";
import { getCurrentLocation, type LocationResult } from "../../services/geolocation";
import { MAX_GPS_ACCURACY_METERS } from "../../../../shared/rules/geo";
import { PlaceSearch } from "./PlaceSearch";
import type { Origin } from "./types";

type Status = { kind: "idle" } | { kind: "locating" } | Exclude<LocationResult, { kind: "ok" }>;

const MESSAGES: Record<Exclude<Status["kind"], "idle" | "locating">, string> = {
  inaccurate: "",
  denied: "위치 권한이 거부되었습니다. 출발지를 직접 검색하세요.",
  outsideJeju: "현재 위치가 제주 밖입니다. 출발지를 직접 검색하세요.",
  timeout: "위치를 확인하는 데 시간이 너무 오래 걸립니다. 다시 시도하거나 직접 검색하세요.",
  unavailable: "현재 위치를 확인할 수 없습니다. 다시 시도하거나 직접 검색하세요.",
  unsupported: "이 브라우저는 위치 기능을 지원하지 않습니다. 출발지를 직접 검색하세요.",
};

interface Props {
  onChange: (origin: Origin) => void;
  locate?: () => Promise<LocationResult>;
}

/** 출발지 선택: 현재 위치(GPS) 또는 직접 검색(AC-001-01·02, AC-011-04·05). */
export function OriginPicker({ onChange, locate = getCurrentLocation }: Props) {
  const [status, setStatus] = useState<Status>({ kind: "idle" });
  const [manual, setManual] = useState(false);

  async function useCurrent() {
    setStatus({ kind: "locating" });
    const result = await locate();
    if (result.kind === "ok") {
      setStatus({ kind: "idle" });
      onChange({ kind: "current", location: result.location, accuracyMeters: result.accuracyMeters });
      return;
    }
    setStatus(result);
    if (result.kind !== "inaccurate" && result.kind !== "timeout" && result.kind !== "unavailable") setManual(true);
  }

  const retryable = status.kind === "inaccurate" || status.kind === "timeout" || status.kind === "unavailable";
  const message =
    status.kind === "inaccurate"
      ? `위치가 정확하지 않습니다(오차 약 ${status.accuracyMeters}m, 기준 ${MAX_GPS_ACCURACY_METERS}m). 다시 확인하거나 직접 검색하세요.`
      : status.kind === "idle" || status.kind === "locating"
        ? null
        : MESSAGES[status.kind];

  return (
    <div className="flex flex-col gap-2">
      <div className="flex gap-2">
        <button
          type="button"
          onClick={useCurrent}
          disabled={status.kind === "locating"}
          className="min-h-12 flex-1 rounded-2xl bg-brand-600 px-3 font-semibold text-white disabled:bg-brand-300"
        >
          {status.kind === "locating" ? "위치 확인 중…" : retryable ? "현재 위치 다시 확인" : "현재 위치 사용"}
        </button>
        {!manual && (
          <button
            type="button"
            onClick={() => setManual(true)}
            className="min-h-12 flex-1 rounded-2xl bg-grey-100 px-3 font-semibold text-grey-700"
          >
            직접 검색
          </button>
        )}
      </div>
      {message && (
        <p role="alert" className="rounded-2xl bg-amber-50 p-3 text-sm text-amber-900">
          {message}
        </p>
      )}
      {manual && (
        <PlaceSearch
          label="출발지"
          placeholder="출발지 장소·주소"
          onSelect={(place) => onChange({ kind: "place", place })}
        />
      )}
    </div>
  );
}
