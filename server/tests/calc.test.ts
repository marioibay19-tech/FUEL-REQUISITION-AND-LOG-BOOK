import { describe, expect, it } from "vitest";
import {
  buildIntervals,
  CalcError,
  checkReading,
  computeCost,
  estimateDistance,
  estimateOdometer,
  fuelEfficiency,
  selectReference,
  type TimelineEvent,
} from "../src/lib/calc.js";

describe("fuel cost", () => {
  it("computes total cost = liters × price per liter, rounded to centavos", () => {
    expect(computeCost(40, 61.5)).toBe(2460);
    expect(computeCost("25.37", "63.25")).toBe(1604.65); // 1604.6525 → 1604.65
  });
  it("rejects zero or negative quantities", () => {
    expect(() => computeCost(0, 60)).toThrow(CalcError);
    expect(() => computeCost(-5, 60)).toThrow(/greater than zero/);
  });
});

describe("ratio and proportion estimate (specification test case)", () => {
  const reference = {
    method: "LAST_INTERVAL" as const,
    periodStart: new Date("2026-09-01"),
    periodEnd: new Date("2026-09-10"),
    liters: 40,
    distanceKm: 320,
    efficiency: 8,
    quality: "VERIFIED" as const,
    intervals: 1,
  };

  it("fuel efficiency = 320 km ÷ 40 L = 8 km/L", () => {
    expect(fuelEfficiency(320, 40)).toBe(8);
  });

  it("40 L : 320 km = 25 L : x → x = 200 km", () => {
    expect(estimateDistance(25, 40, 320)).toBe(200);
  });

  it("estimated odometer = 25,320 + 200 = 25,520 km, labelled as an estimate", () => {
    const r = estimateOdometer({ previousVerifiedOdometer: 25320, liters: 25, reference });
    expect(r.status).toBe("COMPUTED");
    if (r.status !== "COMPUTED") return;
    expect(r.efficiency).toBe(8);
    expect(r.estimatedDistanceKm).toBe(200);
    expect(r.estimatedOdometer).toBe(25520);
    expect(r.readingType).toBe("ESTIMATED");
    expect(r.steps.join("\n")).toContain("x = (25 × 320) ÷ 40 = 200 km");
  });

  it("reports insufficient data instead of estimating", () => {
    expect(estimateOdometer({ previousVerifiedOdometer: 25320, liters: 25, reference: null })).toMatchObject({
      status: "INSUFFICIENT_DATA",
      message: "Insufficient Data for Estimate",
    });
    expect(estimateOdometer({ previousVerifiedOdometer: null, liters: 25, reference }).status).toBe("INSUFFICIENT_DATA");
  });

  it("never estimates using zero liters or a zero reference quantity", () => {
    expect(estimateOdometer({ previousVerifiedOdometer: 25320, liters: 0, reference }).status).toBe("INSUFFICIENT_DATA");
    expect(estimateOdometer({ previousVerifiedOdometer: 25320, liters: 25, reference: { ...reference, liters: 0 } }).status).toBe(
      "INSUFFICIENT_DATA",
    );
    expect(() => estimateDistance(0, 40, 320)).toThrow(CalcError);
    expect(() => estimateDistance(25, 0, 320)).toThrow(/Reference fuel quantity/);
    expect(() => fuelEfficiency(320, 0)).toThrow(CalcError);
  });
});

describe("historical efficiency from verified intervals", () => {
  const ev = (id: number, day: number, liters: number, odo: number | null, full = true): TimelineEvent => ({
    id,
    at: new Date(Date.UTC(2026, 8, day)),
    liters,
    cost: liters * 60,
    isFullTank: full,
    verifiedOdometer: odo,
  });

  it("full-tank basis attributes the refill at the end reading to the interval", () => {
    const intervals = buildIntervals([ev(1, 1, 50, 25000), ev(2, 10, 40, 25320)], "FULL_TANK");
    expect(intervals).toHaveLength(1);
    expect(intervals[0]).toMatchObject({ distanceKm: 320, liters: 40, efficiency: 8, quality: "VERIFIED" });
  });

  it("includes fuel from unverified fillings inside the interval and skips them as endpoints", () => {
    const intervals = buildIntervals([ev(1, 1, 50, 25000), ev(2, 5, 20, null), ev(3, 10, 20, 25320)], "FULL_TANK");
    expect(intervals).toHaveLength(1);
    expect(intervals[0]).toMatchObject({ liters: 40, distanceKm: 320, efficiency: 8 });
  });

  it("labels partial fills and issuance-based attribution as ESTIMATED efficiency", () => {
    expect(buildIntervals([ev(1, 1, 50, 25000, false), ev(2, 10, 40, 25320)], "FULL_TANK")[0].quality).toBe("ESTIMATED");
    const issuance = buildIntervals([ev(1, 1, 40, 25000), ev(2, 10, 30, 25320)], "ISSUANCE");
    expect(issuance[0]).toMatchObject({ liters: 40, efficiency: 8, quality: "ESTIMATED" });
  });

  it("skips intervals with zero fuel or non-positive distance", () => {
    expect(buildIntervals([ev(1, 1, 50, 25000), ev(2, 10, 0, 25320)], "FULL_TANK")).toHaveLength(0);
    expect(buildIntervals([ev(1, 1, 50, 25000), ev(2, 10, 40, 24900)], "FULL_TANK")).toHaveLength(0);
  });

  it("rolling average weights by distance and fuel (Σkm ÷ ΣL)", () => {
    const intervals = buildIntervals(
      [ev(1, 1, 50, 10000), ev(2, 5, 40, 10320), ev(3, 9, 60, 10740), ev(4, 14, 30, 11010)],
      "FULL_TANK",
    );
    expect(intervals.map((i) => i.efficiency)).toEqual([8, 7, 9]);
    const ref = selectReference(intervals, "ROLLING_AVERAGE", 3)!;
    expect(ref).toMatchObject({ liters: 130, distanceKm: 1010, intervals: 3 });
    expect(ref.efficiency).toBeCloseTo(7.7692, 4);
    expect(selectReference(intervals, "LAST_INTERVAL")!.efficiency).toBe(9);
    expect(selectReference([], "LAST_INTERVAL")).toBeNull();
  });
});

describe("reading checks", () => {
  it("flags an actual reading lower than the previous verified reading", () => {
    const r = checkReading({ previousVerifiedOdometer: 25320, actualOdometer: 25100, estimatedOdometer: 25520, estimatedDistanceKm: 200, variancePctThreshold: 20 });
    expect(r.flags).toContain("ACTUAL_LOWER_THAN_PREVIOUS");
  });
  it("flags an estimate lower than the previous reading", () => {
    const r = checkReading({ previousVerifiedOdometer: 25320, actualOdometer: null, estimatedOdometer: 25300, estimatedDistanceKm: -20, variancePctThreshold: 20 });
    expect(r.flags).toEqual(["ESTIMATE_LOWER_THAN_PREVIOUS"]);
  });
  it("compares actual with estimated in km and percent of estimated distance", () => {
    const ok = checkReading({ previousVerifiedOdometer: 25320, actualOdometer: 25540, estimatedOdometer: 25520, estimatedDistanceKm: 200, variancePctThreshold: 20 });
    expect(ok).toEqual({ flags: [], varianceKm: 20, variancePct: 10 });
    const big = checkReading({ previousVerifiedOdometer: 25320, actualOdometer: 25700, estimatedOdometer: 25520, estimatedDistanceKm: 200, variancePctThreshold: 20 });
    expect(big.flags).toEqual(["LARGE_VARIANCE"]);
    expect(big.variancePct).toBe(90);
  });
  it("does not report a percentage when the estimated distance is zero", () => {
    const r = checkReading({ previousVerifiedOdometer: 100, actualOdometer: 150, estimatedOdometer: 100, estimatedDistanceKm: 0, variancePctThreshold: 20 });
    expect(r.variancePct).toBeNull();
    expect(r.varianceKm).toBe(50);
  });
});
