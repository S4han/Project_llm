import { describe, expect, it } from "vitest";
import type { RouteCompareResponse } from "../../shared/contracts/route";
import { ARRIVAL_METERS, INTERVAL_MS, MAX_DURATION_MS, Monitor, type MonitorState } from "../../web/src/features/monitor/monitor";
import type { LocationResult } from "../../web/src/services/geolocation";
import type { RouteCompareResult } from "../../web/src/services/routesApi";

const HERE = { lat: 33.5066, lng: 126.4929 };
const DEST = { lat: 33.2541, lng: 126.5601 };
const DATA = { observedAt: "x" } as RouteCompareResponse;

/** 수동 시계·타이머·화면 상태. */
function harness(opts: { locate?: () => Promise<LocationResult>; compare?: () => Promise<RouteCompareResult> } = {}) {
  let now = 0;
  let visible = true;
  let visCb: (() => void) | null = null;
  const timers: { at: number; fn: () => void; id: number }[] = [];
  let nextId = 1;
  const calls = { locate: 0, compare: 0, origins: [] as unknown[] };
  const states: MonitorState[] = [];
  const monitor = new Monitor({
    destination: DEST,
    locate: async () => {
      calls.locate += 1;
      return opts.locate ? opts.locate() : { kind: "ok", location: HERE, accuracyMeters: 10 };
    },
    compare: async (origin) => {
      calls.compare += 1;
      calls.origins.push(origin);
      return opts.compare ? opts.compare() : { ok: true, data: DATA };
    },
    now: () => now,
    setTimer: (fn, ms) => {
      const id = nextId++;
      timers.push({ at: now + ms, fn, id });
      return id;
    },
    clearTimer: (id) => {
      const i = timers.findIndex((t) => t.id === id);
      if (i >= 0) timers.splice(i, 1);
    },
    isVisible: () => visible,
    onVisibilityChange: (cb) => {
      visCb = cb;
      return () => (visCb = null);
    },
    onUpdate: (s) => states.push(s),
  });
  const flush = async () => {
    for (let i = 0; i < 10; i++) await Promise.resolve();
  };
  /** 시간을 앞당기며 도래한 타이머를 실행한다. */
  const advance = async (ms: number) => {
    const end = now + ms;
    for (;;) {
      timers.sort((a, b) => a.at - b.at);
      const t = timers[0];
      if (!t || t.at > end) break;
      timers.shift();
      now = t.at;
      t.fn();
      await flush();
    }
    now = end;
  };
  const setVisible = async (v: boolean) => {
    visible = v;
    visCb?.();
    await flush();
  };
  return { monitor, calls, states, advance, flush, setVisible, timers, get now() { return now; } };
}

describe("재평가 제어기 (FR-009)", () => {
  it("시작하면 즉시 1회, 이후 300초마다 재평가 (AC-009-01·02)", async () => {
    const h = harness();
    h.monitor.start();
    await h.flush();
    expect(h.calls.compare).toBe(1);
    expect(h.monitor.snapshot.nextAt).toBe(INTERVAL_MS);
    await h.advance(INTERVAL_MS - 1);
    expect(h.calls.compare).toBe(1);
    await h.advance(1);
    expect(h.calls.compare).toBe(2);
    await h.advance(INTERVAL_MS * 3);
    expect(h.calls.compare).toBe(5);
    expect(h.monitor.snapshot.lastData).toBe(DATA);
  });

  it("다음 실행은 재평가가 끝난 시점부터 300초 (요청 시간만큼 늦어짐, 일찍 실행 안 함)", async () => {
    let release!: (r: RouteCompareResult) => void;
    const h = harness({ compare: () => new Promise((r) => (release = r)) });
    h.monitor.start();
    await h.flush();
    await h.advance(2000); // 요청이 2초 걸림
    release({ ok: true, data: DATA });
    await h.flush();
    expect(h.monitor.snapshot.nextAt).toBe(2000 + INTERVAL_MS);
  });

  it("매 회차 현재 위치로 조회한다 (AC-009-03)", async () => {
    const spots = [HERE, { lat: 33.45, lng: 126.48 }];
    let i = 0;
    const h = harness({ locate: async () => ({ kind: "ok", location: spots[Math.min(i++, 1)]!, accuracyMeters: 10 }) });
    h.monitor.start();
    await h.flush();
    await h.advance(INTERVAL_MS);
    expect(h.calls.origins).toEqual(spots);
  });

  it("진행 중에는 중복 요청하지 않는다", async () => {
    const h = harness({ compare: () => new Promise(() => {}) });
    h.monitor.start();
    await h.flush();
    await h.setVisible(false);
    await h.setVisible(true);
    h.monitor.start();
    await h.advance(INTERVAL_MS * 3);
    expect(h.calls.compare).toBe(1);
    expect(h.timers).toHaveLength(0);
  });

  it("중지하면 이후 요청이 없다 (AC-009-05)", async () => {
    const h = harness();
    h.monitor.start();
    await h.flush();
    h.monitor.stop();
    await h.advance(INTERVAL_MS * 5);
    expect(h.calls.compare).toBe(1);
    expect(h.monitor.snapshot.stopReason).toEqual({ kind: "user" });
  });

  it("화면이 숨겨지면 멈추고, 300초 지나 돌아오면 즉시 1회 (AC-009-06)", async () => {
    const h = harness();
    h.monitor.start();
    await h.flush();
    await h.setVisible(false);
    expect(h.monitor.snapshot.paused).toBe(true);
    await h.advance(INTERVAL_MS * 4);
    expect(h.calls.compare).toBe(1);
    await h.setVisible(true);
    expect(h.calls.compare).toBe(2);
    expect(h.monitor.snapshot.wasPaused).toBe(true);
  });

  it("300초 전에 돌아오면 남은 시간만 기다린다", async () => {
    const h = harness();
    h.monitor.start();
    await h.flush();
    await h.advance(100_000);
    await h.setVisible(false);
    await h.advance(50_000);
    await h.setVisible(true);
    expect(h.calls.compare).toBe(1);
    expect(h.monitor.snapshot.nextAt).toBe(INTERVAL_MS);
    await h.advance(INTERVAL_MS - 150_000);
    expect(h.calls.compare).toBe(2);
  });

  it("오류·단절은 실패로 표시하고 다음 회차에 재시도, 연속 3회면 중지 (AC-009-07)", async () => {
    const h = harness({ compare: async () => ({ ok: false, error: { code: "PROVIDER_UNAVAILABLE", message: "네트워크 연결을 확인한 뒤 다시 시도하세요." } }) });
    h.monitor.start();
    await h.flush();
    expect(h.monitor.snapshot.lastError).toBe("네트워크 연결을 확인한 뒤 다시 시도하세요.");
    expect(h.monitor.snapshot.status).toBe("running");
    await h.advance(INTERVAL_MS * 2);
    expect(h.calls.compare).toBe(3);
    expect(h.monitor.snapshot.stopReason?.kind).toBe("failures");
    await h.advance(INTERVAL_MS * 3);
    expect(h.calls.compare).toBe(3);
  });

  it("성공하면 실패 횟수가 초기화된다", async () => {
    const results: RouteCompareResult[] = [
      { ok: false, error: { code: "PROVIDER_UNAVAILABLE", message: "x" } },
      { ok: false, error: { code: "PROVIDER_UNAVAILABLE", message: "x" } },
      { ok: true, data: DATA },
      { ok: false, error: { code: "PROVIDER_UNAVAILABLE", message: "x" } },
    ];
    const h = harness({ compare: async () => results.shift() ?? { ok: true, data: DATA } });
    h.monitor.start();
    await h.flush();
    await h.advance(INTERVAL_MS * 3);
    expect(h.monitor.snapshot.status).toBe("running");
    expect(h.monitor.snapshot.failures).toBe(1);
    expect(h.monitor.snapshot.lastSuccessAt).toBe(INTERVAL_MS * 2);
  });

  it("조회 한도면 즉시 중지하고 이후 호출 없음, 사유·재사용 시각·마지막 성공 유지 (AC-009-08·09)", async () => {
    const results: RouteCompareResult[] = [
      { ok: true, data: DATA },
      { ok: false, error: { code: "QUOTA_BLOCKED", message: "무료 호출 여유분이 부족해 자동 재평가를 중단했습니다.", retryAfter: "2026-10-19T15:00:00.000Z" } },
    ];
    const h = harness({ compare: async () => results.shift()! });
    h.monitor.start();
    await h.flush();
    await h.advance(INTERVAL_MS);
    expect(h.monitor.snapshot.stopReason).toEqual({
      kind: "quota",
      message: "무료 호출 여유분이 부족해 자동 재평가를 중단했습니다.",
      retryAfter: "2026-10-19T15:00:00.000Z",
    });
    expect(h.monitor.snapshot.lastSuccessAt).toBe(0);
    await h.advance(INTERVAL_MS * 5);
    expect(h.calls.compare).toBe(2);
  });

  it("위치가 부정확하면 그 회차를 건너뛰고 실패로 센다, 권한 거부면 중지", async () => {
    const inaccurate = harness({ locate: async () => ({ kind: "inaccurate", accuracyMeters: 500 }) });
    inaccurate.monitor.start();
    await inaccurate.flush();
    expect(inaccurate.calls.compare).toBe(0);
    expect(inaccurate.monitor.snapshot.failures).toBe(1);
    expect(inaccurate.monitor.snapshot.status).toBe("running");

    const denied = harness({ locate: async () => ({ kind: "denied" }) });
    denied.monitor.start();
    await denied.flush();
    expect(denied.monitor.snapshot.stopReason?.kind).toBe("noLocation");
    expect(denied.calls.compare).toBe(0);
  });

  it(`목적지 ${ARRIVAL_METERS}m 이내면 도착으로 중지`, async () => {
    const h = harness({ locate: async () => ({ kind: "ok", location: { lat: DEST.lat + 0.001, lng: DEST.lng }, accuracyMeters: 10 }) });
    h.monitor.start();
    await h.flush();
    expect(h.monitor.snapshot.stopReason).toEqual({ kind: "arrived" });
    expect(h.calls.compare).toBe(0);
  });

  it("60분이 지나면 자동 종료", async () => {
    const h = harness();
    h.monitor.start();
    await h.flush();
    await h.advance(MAX_DURATION_MS + INTERVAL_MS);
    expect(h.monitor.snapshot.stopReason).toEqual({ kind: "timeLimit" });
    expect(h.calls.compare).toBe(MAX_DURATION_MS / INTERVAL_MS);
  });

  it("중지 후 다시 시작할 수 있고 마지막 성공 결과는 유지된다", async () => {
    const h = harness();
    h.monitor.start();
    await h.flush();
    h.monitor.stop();
    h.monitor.start();
    expect(h.monitor.snapshot.lastData).toBe(DATA);
    await h.flush();
    expect(h.calls.compare).toBe(2);
    expect(h.monitor.snapshot.status).toBe("running");
  });
});
