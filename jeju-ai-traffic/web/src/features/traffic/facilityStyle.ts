import type { FacilityType } from "../../../../shared/contracts/traffic";

/** 교통시설물 카드의 유형. 제주 ITS 7개 + 제주시 주정차 단속 CCTV(ENF, TASK-016) + 주차장(PARK, 표준데이터, TASK-017). */
export type FacilityKey = FacilityType | "ENF" | "PARK";

/** 내 위치 반경 안만 보이는 유형(TASK-016·017). */
export const NEARBY_KEYS: FacilityKey[] = ["ENF", "PARK"];

/** 교통시설물 유형별 이름·색(TASK-013). 소통 상태 색(초록·주황·빨강)과 겹치지 않게 고른다. */
/** stroke는 점 테두리(없으면 흰색). mark는 팝업 머리 표시 글자(markBg·markFg는 표시 배경·글자색, 없으면 color·흰색). */
export const FACILITY_STYLE: Record<FacilityKey, { label: string; short: string; color: string; stroke?: string; mark: string; markBg?: string; markFg?: string }> = {
  FTY01: { label: "VMS(전광판)", short: "VMS", color: "#2272eb", mark: "V" },
  FTY02: { label: "CCTV", short: "CCTV", color: "#7c3aed", mark: "C" },
  FTY03: { label: "웹카메라", short: "웹카메라", color: "#db2777", mark: "W" },
  FTY07: { label: "영상 VDS(차량 검지)", short: "영상VDS", color: "#0d9488", mark: "D" },
  FTY09: { label: "AVI(구간 검지)", short: "AVI", color: "#4b5563", mark: "A" },
  FTY17: { label: "신호제어기", short: "신호제어기", color: "#92400e", mark: "S" },
  FTY23: { label: "RWIS(도로 기상)", short: "RWIS", color: "#0891b2", mark: "R" },
  // AVI(회색)와 헷갈리지 않게 노란 점 + 검정 테두리(TASK-016 점검: 휴대폰 화면에서 구분 안 됨)
  ENF: { label: "주정차 단속 CCTV", short: "주정차 단속", color: "#facc15", stroke: "#111827", mark: "단", markFg: "#111827" },
  // 다른 유형은 모두 색을 채운 점이라, 주차장은 흰 점 + 파란 테두리로 구분한다(TASK-017).
  PARK: { label: "주차장", short: "주차장", color: "#ffffff", stroke: "#1d4ed8", mark: "P", markBg: "#1d4ed8" },
};

export const FACILITY_ORDER: FacilityKey[] = ["FTY01", "FTY02", "FTY03", "FTY07", "FTY09", "FTY17", "FTY23", "ENF", "PARK"];
