import { describe, expect, it } from "vitest";
import { formatDiff, formatDistance, formatDuration } from "../../web/src/features/routes/format";

describe("경로 표시 형식", () => {
  it("예상시간", () => {
    expect(formatDuration(4166)).toBe("1시간 9분");
    expect(formatDuration(3600)).toBe("1시간");
    expect(formatDuration(2700)).toBe("45분");
    expect(formatDuration(29)).toBe("1분 미만");
  });

  it("거리", () => {
    expect(formatDistance(52300)).toBe("52.3km");
  });

  it("차이: 0초는 같음, 60초 미만은 '1분 미만', 그 이상은 분 반올림", () => {
    expect(formatDiff(0)).toBe("추천 경로와 예상시간 같음");
    expect(formatDiff(59)).toBe("추천 경로와 1분 미만 차이");
    expect(formatDiff(60)).toBe("추천 경로보다 1분 느림");
    expect(formatDiff(604)).toBe("추천 경로보다 10분 느림");
    expect(formatDiff(-90)).toBe("추천 경로보다 2분 빠름");
  });
});
