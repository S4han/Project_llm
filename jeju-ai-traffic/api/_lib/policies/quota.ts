import type { ProviderId } from "../../../shared/contracts/common.js";
import { AppError } from "../errors.js";
import { kstDayKey, nextKstMidnight } from "./kstDay.js";

/** user: 사용자가 직접 요청한 조회, reevaluation: 5분 자동 재평가. */
export type CallPurpose = "user" | "reevaluation";

export interface ProviderBudget {
  dailyLimit: number;
  /** 사용량이 이 값 이상이면 자동 재평가를 막는다. 남은 예산은 직접 조회용. */
  reevaluationCutoff?: number;
}

/** 내부 일일 한도 (DECISIONS 2026-10-19 TASK-003 "2. 승인", kakaoLocal은 TASK-004, ai 200은 TASK-007 "3. 승인", jejuIts 6,000은 TASK-012 "4. 승인"). */
export const DEFAULT_BUDGETS: Record<ProviderId, ProviderBudget> = {
  kakao: { dailyLimit: 8000, reevaluationCutoff: 6000 },
  kakaoLocal: { dailyLimit: 3000 },
  jejuIts: { dailyLimit: 6000 },
  ai: { dailyLimit: 200 },
  // 브이월드 교통링크(제주 범위 약 38쪽). 결과를 하루 보관하고 CDN이 30일 보관하므로 평소에는 거의 부르지 않는다(TASK-012).
  vworld: { dailyLimit: 400 },
  // 공공데이터포털(제주시 주정차 단속 CCTV, 1회 1건). 개발계정 공급자 한도 10,000. 하루 보관·CDN 7일이라 평소에는 거의 부르지 않는다(TASK-016).
  dataGoKr: { dailyLimit: 500 },
};

/**
 * 사용량 저장소. 비동기 인터페이스라 공유 저장소(예: Redis INCRBY)로 바꿀 수 있다.
 * reserve는 한도 확인과 증가를 원자적으로 처리해야 한다.
 */
export interface QuotaStore {
  reserve(provider: ProviderId, day: string, cost: number, limit: number): Promise<boolean>;
  used(provider: ProviderId, day: string): Promise<number>;
  setBlockedUntil(provider: ProviderId, until: Date): Promise<void>;
  blockedUntil(provider: ProviderId): Promise<Date | undefined>;
}

/**
 * 서버 메모리 저장소 (DECISIONS "1. (a)"). 인스턴스마다 따로 세므로 전체 합계는 근사치다.
 * reserve 안에 await가 없어 한 인스턴스 안에서는 동시 요청에도 원자적이다.
 */
export class MemoryQuotaStore implements QuotaStore {
  private readonly usage = new Map<ProviderId, { day: string; used: number }>();
  private readonly blocks = new Map<ProviderId, Date>();

  async reserve(provider: ProviderId, day: string, cost: number, limit: number): Promise<boolean> {
    const current = this.usage.get(provider);
    const used = current?.day === day ? current.used : 0;
    if (used + cost > limit) return false;
    this.usage.set(provider, { day, used: used + cost });
    return true;
  }

  async used(provider: ProviderId, day: string): Promise<number> {
    const current = this.usage.get(provider);
    return current?.day === day ? current.used : 0;
  }

  async setBlockedUntil(provider: ProviderId, until: Date): Promise<void> {
    this.blocks.set(provider, until);
  }

  async blockedUntil(provider: ProviderId): Promise<Date | undefined> {
    return this.blocks.get(provider);
  }
}

export interface ReserveOptions {
  cost?: number;
  purpose?: CallPurpose;
}

export interface QuotaStatus {
  used: number;
  dailyLimit: number;
  blockedUntil?: Date;
}

export class QuotaGuard {
  private readonly store: QuotaStore;
  private readonly budgets: Record<ProviderId, ProviderBudget>;
  private readonly clock: () => Date;

  constructor(
    store: QuotaStore,
    budgets: Record<ProviderId, ProviderBudget> = DEFAULT_BUDGETS,
    clock: () => Date = () => new Date(),
  ) {
    this.store = store;
    this.budgets = budgets;
    this.clock = clock;
  }

  /** 외부 호출 전에 사용량을 예약한다. 허용되지 않으면 QUOTA_BLOCKED를 던지고 사용량은 그대로 둔다. */
  async reserve(provider: ProviderId, { cost = 1, purpose = "user" }: ReserveOptions = {}): Promise<void> {
    const now = this.clock();
    const blockedUntil = await this.store.blockedUntil(provider);
    if (blockedUntil && blockedUntil > now) {
      throw new AppError("QUOTA_BLOCKED", "공급자 호출 한도에 도달해 조회를 중단했습니다.", blockedUntil.toISOString());
    }

    const budget = this.budgets[provider];
    const limit =
      purpose === "reevaluation" && budget.reevaluationCutoff !== undefined
        ? Math.min(budget.reevaluationCutoff, budget.dailyLimit)
        : budget.dailyLimit;
    const ok = await this.store.reserve(provider, kstDayKey(now), cost, limit);
    if (!ok) {
      const message =
        purpose === "reevaluation"
          ? "무료 호출 여유분이 부족해 자동 재평가를 중단했습니다."
          : "오늘 사용할 수 있는 조회 한도에 도달했습니다.";
      throw new AppError("QUOTA_BLOCKED", message, nextKstMidnight(now).toISOString());
    }
  }

  /** 공급자가 한도 초과(429)를 알리면 다음 KST 0시까지 해당 공급자 호출을 막는다. */
  async blockForToday(provider: ProviderId): Promise<Date> {
    const until = nextKstMidnight(this.clock());
    await this.store.setBlockedUntil(provider, until);
    return until;
  }

  async status(provider: ProviderId): Promise<QuotaStatus> {
    const now = this.clock();
    const blockedUntil = await this.store.blockedUntil(provider);
    return {
      used: await this.store.used(provider, kstDayKey(now)),
      dailyLimit: this.budgets[provider].dailyLimit,
      blockedUntil: blockedUntil && blockedUntil > now ? blockedUntil : undefined,
    };
  }
}

/** 함수 인스턴스 공용 관문. 인스턴스가 살아 있는 동안 사용량이 유지된다. */
export const quotaGuard = new QuotaGuard(new MemoryQuotaStore());
