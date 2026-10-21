import type { FacilityType } from "../../../../shared/contracts/traffic";

/** 교통시설물 카드의 유형. 제주 ITS 7개 + 제주시 주정차 단속 CCTV(ENF, TASK-016) + 주차장(PARK, 표준데이터, TASK-017). */
export type FacilityKey = FacilityType | "ENF" | "PARK" | "GAS" | "LPG" | "EV";

/** 내 위치 반경 안만 보이는 유형(TASK-016·017·018). */
export const NEARBY_KEYS: FacilityKey[] = ["ENF", "PARK", "GAS", "LPG", "EV"];

/** 유형별 조회 반경(m). 주유소는 드문드문해서 3km(TASK-018 2.(a)), LPG 충전소는 더 드물어 5km, 나머지는 1km. */
export const NEARBY_RADIUS: Partial<Record<FacilityKey, number>> = { ENF: 1000, PARK: 1000, GAS: 3000, LPG: 5000, EV: 1000 };

/** 오피넷 상표 코드 → 이름·짧은 표시·색(TASK-018). 목록에 없는 코드는 "기타". */
export const GAS_BRANDS: Record<string, { name: string; mark: string; color: string; textColor?: string }> = {
  SKE: { name: "SK에너지", mark: "SK", color: "#e2231a" },
  GSC: { name: "GS칼텍스", mark: "GS", color: "#00857c" },
  HDO: { name: "HD현대오일뱅크", mark: "HD", color: "#0b4ea2" },
  SOL: { name: "S-OIL", mark: "S", color: "#ffc20e", textColor: "#111827" },
  RTO: { name: "알뜰주유소", mark: "알뜰", color: "#4b8b3b" },
  RTX: { name: "고속도로 알뜰", mark: "알뜰", color: "#4b8b3b" },
  NHO: { name: "농협 알뜰", mark: "NH", color: "#2f7d32" },
  ETC: { name: "자가상표", mark: "기타", color: "#6b7280" },
  NCO: { name: "자가상표", mark: "기타", color: "#6b7280" },
  SKG: { name: "SK가스", mark: "SK", color: "#e2231a" },
  E1G: { name: "E1", mark: "E1", color: "#d71920" },
};
export const gasBrand = (code: string) => GAS_BRANDS[code] ?? { name: code || "상표 정보 없음", mark: "기타", color: "#6b7280" };

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
  // 지도에서는 상표 색 가격 표시(핀)로 그린다. 여기 색은 카드 버튼의 범례 점용.
  GAS: { label: "주유소", short: "주유소", color: "#f97316", stroke: "#7c2d12", mark: "⛽" },
  LPG: { label: "LPG 충전소", short: "LPG 충전소", color: "#0284c7", stroke: "#0c4a6e", mark: "LPG" },
  // 지도에서는 충전 가능 수 표시(초록 = 가능, 회색 = 모두 사용 중·정보 없음)로 그린다(TASK-019).
  EV: { label: "전기차 충전소", short: "전기차 충전소", color: "#16a34a", stroke: "#14532d", mark: "⚡" },
};

export const FACILITY_ORDER: FacilityKey[] = ["FTY01", "FTY02", "FTY03", "FTY07", "FTY09", "FTY17", "FTY23", "ENF", "PARK", "GAS", "LPG", "EV"];
