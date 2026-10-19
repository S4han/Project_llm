import type { RouteCompareResponse } from "../contracts/route.js";

/** 안내 기준: 예상 단축시간 ≥ 300초(PRD FR-010, DEC-013). 판단은 초 단위. */
export const CHANGE_THRESHOLD_SECONDS = 300;
/** '유지'한 같은 조합을 다시 안내하려면 거부 당시보다 이만큼 더 단축돼야 한다. DECISIONS 2026-10-19 TASK-010 "1. (a)". */
export const RESHOW_EXTRA_SECONDS = 300;

export interface ChangeCandidate {
  from: string;
  to: string;
  toLabel: string;
  /** 따라가는 경로 남은 시간 − 대체 경로 남은 시간(초). */
  savingsSeconds: number;
}

/**
 * 변경 후보. 따라가는 방식의 경로가 없으면(비교 불가) null.
 * 대체 경로 중 가장 빠른 것과 비교해 단축시간이 300초 이상일 때만 후보다(AC-010-01~05).
 */
export function findChange(data: RouteCompareResponse, followed: string): ChangeCandidate | null {
  const current = data.routes.find((r) => r.id === followed);
  if (!current) return null;
  const alternatives = data.routes.filter((r) => r.id !== followed);
  if (alternatives.length === 0) return null;
  const best = alternatives.reduce((a, b) => (b.durationSeconds < a.durationSeconds ? b : a));
  const savingsSeconds = current.durationSeconds - best.durationSeconds;
  if (savingsSeconds < CHANGE_THRESHOLD_SECONDS) return null;
  return { from: followed, to: best.id, toLabel: best.label, savingsSeconds };
}

const pairKey = (c: { from: string; to: string }) => `${c.from}->${c.to}`;

export interface AdviceState {
  /** 지금 따라가는 경로의 호출 방식. */
  followed: string;
  /** 답을 기다리는 안내. */
  pending: ChangeCandidate | null;
  /** '유지'한 조합 → 거부 당시 단축시간(초). */
  declined: Record<string, number>;
  /** 화면에 한 번 보여 줄 알림 문구. */
  notice: { kind: "withdrawn" | "accepted" | "declined"; label?: string } | null;
}

export type AdviceEvent =
  | { type: "reset"; followed: string }
  | { type: "data"; data: RouteCompareResponse }
  | { type: "accept" }
  | { type: "decline" }
  | { type: "stop" };

export function initialAdvice(followed: string): AdviceState {
  return { followed, pending: null, declined: {}, notice: null };
}

/** 같은 조합을 거부한 적이 있으면, 단축시간이 거부 당시보다 300초 이상 커졌을 때만 다시 안내한다. */
export function allowed(candidate: ChangeCandidate, declined: AdviceState["declined"]): boolean {
  const prev = declined[pairKey(candidate)];
  return prev === undefined || candidate.savingsSeconds >= prev + RESHOW_EXTRA_SECONDS;
}

/** 변경 안내 상태 전이(FR-010). 승인된 중복 억제(1. (a))와 대기 중 처리(2.)를 따른다. */
export function adviceReducer(state: AdviceState, event: AdviceEvent): AdviceState {
  switch (event.type) {
    case "reset":
      return initialAdvice(event.followed);
    case "stop":
      return { ...state, pending: null, notice: null };
    case "accept": {
      if (!state.pending) return state;
      return { ...state, followed: state.pending.to, pending: null, notice: { kind: "accepted", label: state.pending.toLabel } };
    }
    case "decline": {
      if (!state.pending) return state;
      return {
        ...state,
        pending: null,
        declined: { ...state.declined, [pairKey(state.pending)]: state.pending.savingsSeconds },
        notice: { kind: "declined" },
      };
    }
    case "data": {
      const candidate = findChange(event.data, state.followed);
      if (state.pending) {
        // 대기 중: 같은 조합이면 숫자만 갱신, 조건이 사라지면 닫음, 대체 경로가 바뀌면 새 상황으로 판단
        if (!candidate) return { ...state, pending: null, notice: { kind: "withdrawn" } };
        if (pairKey(candidate) === pairKey(state.pending)) return { ...state, pending: candidate, notice: null };
        return { ...state, pending: allowed(candidate, state.declined) ? candidate : null, notice: null };
      }
      if (candidate && allowed(candidate, state.declined)) return { ...state, pending: candidate, notice: null };
      return { ...state, notice: null };
    }
  }
}
