import type { FacilityType } from "../../../../shared/contracts/traffic";

/** 교통시설물 유형별 이름·색(TASK-013). 소통 상태 색(초록·주황·빨강)과 겹치지 않게 고른다. */
export const FACILITY_STYLE: Record<FacilityType, { label: string; short: string; color: string }> = {
  FTY01: { label: "VMS(전광판)", short: "VMS", color: "#2272eb" },
  FTY02: { label: "CCTV", short: "CCTV", color: "#7c3aed" },
  FTY03: { label: "웹카메라", short: "웹카메라", color: "#db2777" },
  FTY07: { label: "영상 VDS(차량 검지)", short: "영상VDS", color: "#0d9488" },
  FTY09: { label: "AVI(구간 검지)", short: "AVI", color: "#4b5563" },
  FTY17: { label: "신호제어기", short: "신호제어기", color: "#92400e" },
  FTY23: { label: "RWIS(도로 기상)", short: "RWIS", color: "#0891b2" },
};

export const FACILITY_ORDER: FacilityType[] = ["FTY01", "FTY02", "FTY03", "FTY07", "FTY09", "FTY17", "FTY23"];
