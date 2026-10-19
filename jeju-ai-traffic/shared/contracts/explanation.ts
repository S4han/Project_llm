import type { IsoDateTime } from "./common.js";

/** 설명 출처. 화면에서 반드시 구분해 표시한다(AC-006-07). */
export type ExplanationSource = "ai" | "rules";

export interface Explanation {
  text: string;
  source: ExplanationSource;
  /** 설명에 사용한 확인된 근거(공급자·값·기준 시각). */
  evidence: string[];
  generatedAt: IsoDateTime;
}
