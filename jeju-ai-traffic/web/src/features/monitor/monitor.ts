import type { Coordinate, RouteCompareResponse } from "../../../../shared/contracts/route";
import { distanceMeters } from "../../../../shared/rules/geo";
import type { LocationResult } from "../../services/geolocation";
import type { RouteCompareResult } from "../../services/routesApi";

/** 재평가 주기: 이전 재평가가 끝난 뒤 300초. 늦음 허용 +15초(일찍 실행 안 함). DECISIONS 2026-10-19 TASK-009 "1. 승인". */
export const INTERVAL_MS = 300_000;
export const TOLERANCE_MS = 15_000;
/** 연속 실패 시 자동 중지 횟수(TASK-009 "5. 승인"). */
export const MAX_FAILURES = 3;
/** 모니터링 최대 시간(TASK-009 "6. 승인"). */
export const MAX_DURATION_MS = 60 * 60_000;
/** 목적지 도착 판정 거리(TASK-009 "3. 승인"). */
export const ARRIVAL_METERS = 200;

export type StopReason =
  | { kind: "user" }
  | { kind: "arrived" }
  | { kind: "quota"; message: string; retryAfter?: string }
  | { kind: "failures"; message: string }
  | { kind: "timeLimit" }
  | { kind: "noLocation"; message: string };

export interface MonitorState {
  status: "idle" | "running" | "stopped";
  /** 화면이 숨겨져 타이머가 멈춘 상태(running일 때만 의미). */
  paused: boolean;
  /** 재평가 요청 진행 중(중복 방지). */
  inFlight: boolean;
  lastSuccessAt: number | null;
  lastData: RouteCompareResponse | null;
  /** 직전 회차 실패 사유(성공하면 null). */
  lastError: string | null;
  failures: number;
  nextAt: number | null;
  stopReason: StopReason | null;
  /** 화면이 숨겨졌던 적이 있으면 true(비활성 동안 멈췄음을 안내, AC-009-06). */
  wasPaused: boolean;
}

export interface MonitorDeps {
  destination: Coordinate;
  locate: () => Promise<LocationResult>;
  compare: (origin: Coordinate) => Promise<RouteCompareResult>;
  now?: () => number;
  setTimer?: (fn: () => void, ms: number) => unknown;
  clearTimer?: (handle: unknown) => void;
  isVisible?: () => boolean;
  /** 화면 표시 상태 변화 구독. 해제 함수를 돌려준다. */
  onVisibilityChange?: (cb: () => void) => () => void;
  onUpdate: (state: MonitorState) => void;
}

const LOCATION_MESSAGES: Record<Exclude<LocationResult["kind"], "ok">, string> = {
  inaccurate: "현재 위치가 정확하지 않아(200m 초과) 이번 재평가를 건너뛰었습니다.",
  outsideJeju: "현재 위치가 제주 밖이라 재평가하지 못했습니다.",
  denied: "위치 권한이 없어 재평가할 수 없습니다.",
  timeout: "현재 위치 확인이 늦어 이번 재평가를 건너뛰었습니다.",
  unavailable: "현재 위치를 확인할 수 없어 이번 재평가를 건너뛰었습니다.",
  unsupported: "이 브라우저는 위치 기능을 지원하지 않아 재평가할 수 없습니다.",
};

const initial = (): MonitorState => ({
  status: "idle",
  paused: false,
  inFlight: false,
  lastSuccessAt: null,
  lastData: null,
  lastError: null,
  failures: 0,
  nextAt: null,
  stopReason: null,
  wasPaused: false,
});

/**
 * 5분 재평가 제어기(FR-009). 활성 조건: 모니터링 켬 + 화면 보임 + 위치 확인 + 서버 허용.
 * 시계·타이머·화면 상태·위치·조회를 주입받아 테스트에서 시간을 앞당길 수 있다.
 */
export class Monitor {
  private state = initial();
  private timer: unknown = null;
  private startedAt = 0;
  private lastRunEndedAt = 0;
  private unsubscribe: (() => void) | null = null;
  private readonly d: Required<MonitorDeps>;

  constructor(deps: MonitorDeps) {
    this.d = {
      now: () => Date.now(),
      setTimer: (fn, ms) => setTimeout(fn, ms),
      clearTimer: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
      isVisible: () => typeof document === "undefined" || document.visibilityState === "visible",
      onVisibilityChange: (cb) => {
        document.addEventListener("visibilitychange", cb);
        return () => document.removeEventListener("visibilitychange", cb);
      },
      ...deps,
    };
  }

  get snapshot(): MonitorState {
    return this.state;
  }

  private set(patch: Partial<MonitorState>) {
    this.state = { ...this.state, ...patch };
    this.d.onUpdate(this.state);
  }

  /** 시작하면 즉시 1회 재평가한다(AC-009-01). */
  start(): void {
    if (this.state.status === "running") return;
    this.startedAt = this.d.now();
    this.state = { ...initial(), status: "running", lastData: this.state.lastData, lastSuccessAt: this.state.lastSuccessAt };
    this.unsubscribe ??= this.d.onVisibilityChange(() => this.handleVisibility());
    void this.run();
  }

  /** 사용자 중지(AC-009-05). 이후 자동 재평가 요청을 하지 않는다. */
  stop(): void {
    this.halt({ kind: "user" });
  }

  dispose(): void {
    this.clear();
    this.unsubscribe?.();
    this.unsubscribe = null;
  }

  private clear() {
    if (this.timer !== null) this.d.clearTimer(this.timer);
    this.timer = null;
  }

  private halt(reason: StopReason) {
    this.clear();
    this.set({ status: "stopped", stopReason: reason, nextAt: null, paused: false });
  }

  private schedule(ms: number) {
    this.clear();
    this.set({ nextAt: this.d.now() + ms });
    this.timer = this.d.setTimer(() => {
      this.timer = null;
      if (this.d.isVisible()) void this.run();
      else this.set({ paused: true, wasPaused: true });
    }, ms);
  }

  /** 화면이 숨겨지면 타이머를 멈추고, 다시 보이면 300초 경과 시 즉시, 아니면 남은 시간 뒤에 실행한다. */
  private handleVisibility() {
    if (this.state.status !== "running") return;
    if (!this.d.isVisible()) {
      this.clear();
      this.set({ paused: true, wasPaused: true, nextAt: null });
      return;
    }
    this.set({ paused: false });
    if (this.state.inFlight) return;
    const due = this.lastRunEndedAt + INTERVAL_MS;
    const now = this.d.now();
    if (now >= due) void this.run();
    else this.schedule(due - now);
  }

  private fail(message: string) {
    const failures = this.state.failures + 1;
    this.set({ failures, lastError: message });
    if (failures >= MAX_FAILURES) this.halt({ kind: "failures", message });
  }

  /** 재평가 1회. 진행 중이거나 비활성이면 실행하지 않는다(중복 방지). */
  private async run(): Promise<void> {
    if (this.state.status !== "running" || this.state.inFlight) return;
    if (!this.d.isVisible()) {
      this.set({ paused: true, wasPaused: true });
      return;
    }
    if (this.d.now() - this.startedAt >= MAX_DURATION_MS) {
      this.halt({ kind: "timeLimit" });
      return;
    }
    this.set({ inFlight: true, nextAt: null });
    try {
      const loc = await this.d.locate();
      if (this.state.status !== "running") return;
      if (loc.kind !== "ok") {
        if (loc.kind === "denied" || loc.kind === "unsupported") {
          this.halt({ kind: "noLocation", message: LOCATION_MESSAGES[loc.kind] });
          return;
        }
        this.fail(LOCATION_MESSAGES[loc.kind]);
      } else if (distanceMeters(loc.location, this.d.destination) <= ARRIVAL_METERS) {
        this.halt({ kind: "arrived" });
        return;
      } else {
        const result = await this.d.compare(loc.location);
        if (this.state.status !== "running") return;
        if (result.ok) {
          this.set({ lastData: result.data, lastSuccessAt: this.d.now(), lastError: null, failures: 0 });
        } else if (result.error.code === "QUOTA_BLOCKED") {
          this.halt({ kind: "quota", message: result.error.message, retryAfter: result.error.retryAfter });
          return;
        } else {
          this.fail(result.error.message);
        }
      }
    } finally {
      this.lastRunEndedAt = this.d.now();
      if (this.state.inFlight) this.set({ inFlight: false });
    }
    if (this.state.status === "running") {
      if (this.d.now() - this.startedAt >= MAX_DURATION_MS) this.halt({ kind: "timeLimit" });
      else this.schedule(INTERVAL_MS);
    }
  }
}
