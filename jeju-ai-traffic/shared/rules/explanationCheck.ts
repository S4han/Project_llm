import type { ExplanationFacts } from "../contracts/explanation.js";
import { km, minutes, UNKNOWN_SHARE_LIMIT } from "./explanation.js";

/** AI 문장 최대 길이·문장 수. DECISIONS 2026-10-19 TASK-007 "2. 승인". */
export const MAX_CHARS = 180;
export const MAX_SENTENCES = 3;

/** 입력 이름에 없으면 쓰면 안 되는 제주 도로 이름(근거 없는 경로 언급 차단). */
const JEJU_ROAD_NAMES = ["평화로", "번영로", "남조로", "서성로", "비자림로", "애조로", "일주도로", "산록도로", "중산간도로", "1100도로", "516도로", "5·16도로"];

export interface CheckResult {
  ok: boolean;
  reasons: string[];
}

/** 입력에서 계산한, 문장에 나와도 되는 숫자들. */
export function allowedNumbers(facts: ExplanationFacts): Set<string> {
  const allowed = new Set<string>();
  const add = (n: number | string) => allowed.add(String(n));
  const rec = facts.routes.find((r) => r.id === facts.recommendedRouteId);
  for (const r of facts.routes) {
    const m = minutes(r.durationSeconds);
    add(m);
    add(Math.floor(m / 60));
    add(m % 60);
    const k = km(r.distanceMeters);
    add(k);
    add(Math.round(r.distanceMeters / 1000));
    for (const v of Object.values(r.shares)) add(v);
    add(r.incidentKinds.length);
    if (rec && r !== rec) add(Math.abs(minutes(r.durationSeconds - rec.durationSeconds)));
    for (const n of r.label.match(/\d+/g) ?? []) add(n);
  }
  add(facts.routes.length);
  return allowed;
}

/** 단어 → 쓸 수 있는 조건. 조건이 거짓이면 그 단어를 쓰면 안 된다. */
function wordRules(facts: ExplanationFacts): [RegExp, boolean, string][] {
  const any = (pred: (r: ExplanationFacts["routes"][number]) => boolean) => facts.routes.some(pred);
  const unknownHigh = any((r) => r.shares.unknown > UNKNOWN_SHARE_LIMIT);
  return [
    [/정체/, any((r) => r.shares.congested > 0), "정체 구간이 없는데 '정체'를 언급"],
    [/서행/, any((r) => r.shares.slow > 0), "서행 구간이 없는데 '서행'을 언급"],
    [/공사/, any((r) => r.incidentKinds.includes("roadwork")), "공사 정보가 없는데 '공사'를 언급"],
    [/통제/, any((r) => r.incidentKinds.includes("closure")), "통제 정보가 없는데 '통제'를 언급"],
    [/사고/, false, "'사고'는 입력에 없는 사실"],
    [/원활|막힘\s*없|정상\s*소통/, !unknownHigh, "미확보 구간이 많은데 원활하다고 단정"],
  ];
}

/**
 * AI 문장 사실 검증(AC-006-01~03). 하나라도 어기면 ok: false — 호출한 쪽은 규칙 기반 설명을 쓴다.
 */
export function checkAiExplanation(text: string, facts: ExplanationFacts): CheckResult {
  const reasons: string[] = [];
  const t = text.trim();
  if (!t) return { ok: false, reasons: ["빈 문장"] };
  if (t.length > MAX_CHARS) reasons.push(`${MAX_CHARS}자 초과(${t.length}자)`);
  const sentences = t.split(/(?<=[.!?。])\s*/).filter((s) => s.trim());
  if (sentences.length > MAX_SENTENCES) reasons.push(`${MAX_SENTENCES}문장 초과(${sentences.length}문장)`);
  if (!/[가-힣]/.test(t)) reasons.push("한국어가 아님");

  const allowed = allowedNumbers(facts);
  for (const n of t.match(/\d+(?:\.\d+)?/g) ?? []) {
    if (!allowed.has(n)) reasons.push(`입력에 없는 숫자 ${n}`);
  }

  const labels = facts.routes.map((r) => r.label).join(" ");
  for (const road of JEJU_ROAD_NAMES) {
    if (t.includes(road) && !labels.includes(road)) reasons.push(`입력에 없는 도로 이름 ${road}`);
  }

  for (const [pattern, allowedWord, reason] of wordRules(facts)) {
    if (!allowedWord && pattern.test(t)) reasons.push(reason);
  }
  return { ok: reasons.length === 0, reasons };
}
