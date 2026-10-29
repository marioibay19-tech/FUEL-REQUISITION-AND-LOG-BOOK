// Pure business calculations: costs, fuel efficiency and the ratio-and-proportion
// odometer estimate. No database access here so every rule is unit-testable.
// See docs/ODOMETER_CALCULATION.md for the method.
import { Decimal } from "decimal.js";

export type Num = Decimal.Value;

const D = (v: Num) => new Decimal(v);

export function round(v: Num, dp: number): number {
  return D(v).toDecimalPlaces(dp, Decimal.ROUND_HALF_UP).toNumber();
}

/** Total cost (PHP) = liters × price per liter, rounded to centavos. */
export function computeCost(liters: Num, pricePerLiter: Num): number {
  const l = D(liters);
  const p = D(pricePerLiter);
  if (!l.isFinite() || !p.isFinite()) throw new CalcError("INVALID_NUMBER", "Liters and price must be numbers");
  if (l.lte(0)) throw new CalcError("ZERO_QUANTITY", "Liters must be greater than zero");
  if (p.lt(0)) throw new CalcError("NEGATIVE_PRICE", "Price per liter cannot be negative");
  return round(l.mul(p), 2);
}

export class CalcError extends Error {
  constructor(public code: string, message: string) {
    super(message);
  }
}

// ---------------------------------------------------------------- efficiency

/** Fuel efficiency (km/L) = distance ÷ fuel consumed. Refuses zero or negative inputs. */
export function fuelEfficiency(distanceKm: Num, litersConsumed: Num): number {
  const d = D(distanceKm);
  const l = D(litersConsumed);
  if (l.lte(0)) throw new CalcError("ZERO_REFERENCE_QUANTITY", "Cannot compute efficiency with zero liters");
  if (d.lte(0)) throw new CalcError("NON_POSITIVE_DISTANCE", "Distance must be greater than zero");
  return round(d.div(l), 4);
}

/**
 * Ratio and proportion:  refLiters : refDistance = liters : x
 *   x = (liters × refDistance) ÷ refLiters
 */
export function estimateDistance(liters: Num, refLiters: Num, refDistanceKm: Num): number {
  const l = D(liters);
  const rl = D(refLiters);
  const rd = D(refDistanceKm);
  if (l.lte(0)) throw new CalcError("ZERO_QUANTITY", "Cannot estimate using zero liters");
  if (rl.lte(0)) throw new CalcError("ZERO_REFERENCE_QUANTITY", "Reference fuel quantity must be greater than zero");
  if (rd.lte(0)) throw new CalcError("NON_POSITIVE_DISTANCE", "Reference distance must be greater than zero");
  return round(l.mul(rd).div(rl), 1);
}

export interface Interval {
  startAt: Date;
  endAt: Date;
  startOdometer: number;
  endOdometer: number;
  distanceKm: number;
  liters: number;
  cost: number;
  /** VERIFIED: full-tank to full-tank between verified readings. ESTIMATED: fuel attribution is approximate. */
  quality: "VERIFIED" | "ESTIMATED";
  efficiency: number;
}

export interface Reference {
  method: EstimateMethod;
  periodStart: Date | null;
  periodEnd: Date | null;
  liters: number;
  distanceKm: number;
  efficiency: number;
  quality: "VERIFIED" | "ESTIMATED" | "MANUAL";
  intervals: number;
  referenceId?: number | null;
}

export type EstimateMethod = "LAST_INTERVAL" | "ROLLING_AVERAGE" | "APPROVED_REFERENCE";
export type ConsumptionBasis = "FULL_TANK" | "ISSUANCE";

/** A fueling or reading event on a vehicle's timeline (active records only). */
export interface TimelineEvent {
  id: number; // odometer log id
  at: Date;
  liters: number; // fuel dispensed at this event (0 for a reading without fueling)
  cost: number;
  isFullTank: boolean;
  /** Actual reading that has been VERIFIED; null otherwise (unverified or estimated). */
  verifiedOdometer: number | null;
}

/**
 * Build the intervals between consecutive VERIFIED actual readings and attribute
 * fuel to each interval according to the consumption basis:
 *  - FULL_TANK: fuel dispensed after the start reading up to and including the end
 *    reading refills what was used. Verified only when both endpoints are full-tank fills.
 *  - ISSUANCE: fuel issued at the start reading up to (excluding) the end reading is
 *    assumed used during the interval. Always labelled ESTIMATED.
 * Intervals with zero fuel or non-positive distance are skipped (cannot be used).
 */
export function buildIntervals(events: TimelineEvent[], basis: ConsumptionBasis): Interval[] {
  const sorted = [...events].sort((a, b) => a.at.getTime() - b.at.getTime() || a.id - b.id);
  const intervals: Interval[] = [];
  let startIdx = -1;
  for (let i = 0; i < sorted.length; i++) {
    if (sorted[i].verifiedOdometer === null) continue;
    if (startIdx >= 0) {
      const start = sorted[startIdx];
      const end = sorted[i];
      const slice = basis === "FULL_TANK" ? sorted.slice(startIdx + 1, i + 1) : sorted.slice(startIdx, i);
      let liters = new Decimal(0);
      let cost = new Decimal(0);
      for (const e of slice) {
        liters = liters.plus(e.liters);
        cost = cost.plus(e.cost);
      }
      const distance = D(end.verifiedOdometer!).minus(start.verifiedOdometer!);
      if (liters.gt(0) && distance.gt(0)) {
        const fullToFull = basis === "FULL_TANK" && start.isFullTank && end.isFullTank;
        intervals.push({
          startAt: start.at,
          endAt: end.at,
          startOdometer: start.verifiedOdometer!,
          endOdometer: end.verifiedOdometer!,
          distanceKm: round(distance, 1),
          liters: round(liters, 2),
          cost: round(cost, 2),
          quality: fullToFull ? "VERIFIED" : "ESTIMATED",
          efficiency: fuelEfficiency(distance, liters),
        });
      }
    }
    startIdx = i;
  }
  return intervals;
}

/** Select the reference interval used for estimates. Returns null when data is insufficient. */
export function selectReference(
  intervals: Interval[],
  method: Exclude<EstimateMethod, "APPROVED_REFERENCE">,
  rollingWindow = 3,
): Reference | null {
  if (intervals.length === 0) return null;
  if (method === "LAST_INTERVAL") {
    const last = intervals[intervals.length - 1];
    return {
      method,
      periodStart: last.startAt,
      periodEnd: last.endAt,
      liters: last.liters,
      distanceKm: last.distanceKm,
      efficiency: last.efficiency,
      quality: last.quality,
      intervals: 1,
    };
  }
  const window = intervals.slice(-Math.max(1, rollingWindow));
  let liters = new Decimal(0);
  let distance = new Decimal(0);
  for (const iv of window) {
    liters = liters.plus(iv.liters);
    distance = distance.plus(iv.distanceKm);
  }
  return {
    method,
    periodStart: window[0].startAt,
    periodEnd: window[window.length - 1].endAt,
    liters: round(liters, 2),
    distanceKm: round(distance, 1),
    efficiency: fuelEfficiency(distance, liters),
    quality: window.every((w) => w.quality === "VERIFIED") ? "VERIFIED" : "ESTIMATED",
    intervals: window.length,
  };
}

export type EstimateResult =
  | {
      status: "COMPUTED";
      liters: number;
      reference: Reference;
      efficiency: number;
      estimatedDistanceKm: number;
      estimatedOdometer: number;
      previousVerifiedOdometer: number;
      readingType: "ESTIMATED";
      steps: string[];
    }
  | { status: "INSUFFICIENT_DATA"; message: string; reason: string };

/**
 * Estimated distance = liters × refDistance ÷ refLiters (ratio and proportion)
 * Estimated odometer = previous verified odometer + estimated distance
 * The result is always an estimate, never an instrument reading.
 */
export function estimateOdometer(input: {
  previousVerifiedOdometer: number | null;
  liters: number;
  reference: Reference | null;
}): EstimateResult {
  const insufficient = (reason: string) =>
    ({ status: "INSUFFICIENT_DATA", message: "Insufficient Data for Estimate", reason }) as const;
  if (input.previousVerifiedOdometer === null) return insufficient("No verified previous odometer reading");
  if (!input.reference) return insufficient("No usable historical reference interval");
  if (!(input.liters > 0)) return insufficient("Fuel quantity for the interval is zero");
  if (!(input.reference.liters > 0)) return insufficient("Reference fuel quantity is zero");
  if (!(input.reference.distanceKm > 0)) return insufficient("Reference distance is zero");

  const ref = input.reference;
  const distance = estimateDistance(input.liters, ref.liters, ref.distanceKm);
  const estimatedOdometer = round(D(input.previousVerifiedOdometer).plus(distance), 1);
  const efficiency = round(D(ref.distanceKm).div(ref.liters), 4);
  const fmt = (n: number) => n.toLocaleString("en-US", { maximumFractionDigits: 4 });
  return {
    status: "COMPUTED",
    liters: input.liters,
    reference: ref,
    efficiency,
    estimatedDistanceKm: distance,
    estimatedOdometer,
    previousVerifiedOdometer: input.previousVerifiedOdometer,
    readingType: "ESTIMATED",
    steps: [
      `Fuel efficiency = ${fmt(ref.distanceKm)} km ÷ ${fmt(ref.liters)} L = ${fmt(efficiency)} km/L`,
      `${fmt(ref.liters)} L : ${fmt(ref.distanceKm)} km = ${fmt(input.liters)} L : x km`,
      `x = (${fmt(input.liters)} × ${fmt(ref.distanceKm)}) ÷ ${fmt(ref.liters)} = ${fmt(distance)} km`,
      `Estimated odometer = ${fmt(input.previousVerifiedOdometer)} + ${fmt(distance)} = ${fmt(estimatedOdometer)} km`,
    ],
  };
}

// ---------------------------------------------------------------- checks

export interface ReadingCheck {
  flags: string[];
  varianceKm: number | null;
  variancePct: number | null;
}

/**
 * Compare an actual reading with the previous verified reading and with the estimate.
 * - ACTUAL_LOWER_THAN_PREVIOUS when actual < previous verified
 * - ESTIMATE_LOWER_THAN_PREVIOUS when estimate < previous verified (should not happen; defensive)
 * - LARGE_VARIANCE when |actual − estimate| / estimated distance exceeds the threshold
 * Variance % is relative to the estimated distance travelled, and only reported when that is > 0.
 */
export function checkReading(input: {
  previousVerifiedOdometer: number | null;
  actualOdometer: number | null;
  estimatedOdometer: number | null;
  estimatedDistanceKm: number | null;
  variancePctThreshold: number;
}): ReadingCheck {
  const flags: string[] = [];
  const { previousVerifiedOdometer: prev, actualOdometer: actual, estimatedOdometer: est } = input;
  if (prev !== null && actual !== null && actual < prev) flags.push("ACTUAL_LOWER_THAN_PREVIOUS");
  if (prev !== null && est !== null && est < prev) flags.push("ESTIMATE_LOWER_THAN_PREVIOUS");
  let varianceKm: number | null = null;
  let variancePct: number | null = null;
  if (actual !== null && est !== null) {
    varianceKm = round(D(actual).minus(est), 1);
    if (input.estimatedDistanceKm !== null && input.estimatedDistanceKm > 0) {
      variancePct = round(D(varianceKm).div(input.estimatedDistanceKm).mul(100), 2);
      if (Math.abs(variancePct) > input.variancePctThreshold) flags.push("LARGE_VARIANCE");
    }
  }
  return { flags, varianceKm, variancePct };
}

export const FLAG_LABELS: Record<string, string> = {
  ACTUAL_LOWER_THAN_PREVIOUS: "Actual reading is lower than the previous verified reading",
  ESTIMATE_LOWER_THAN_PREVIOUS: "Estimated reading is lower than the previous verified reading",
  LARGE_VARIANCE: "Large difference between actual and estimated reading",
  INSUFFICIENT_DATA: "Insufficient data for estimate",
  NO_ACTUAL_READING: "No actual odometer reading recorded",
  NO_PREVIOUS_VERIFIED: "No previous verified reading",
};
