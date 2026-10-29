// Odometer monitoring: builds each vehicle's reading timeline, computes the
// ratio-and-proportion estimate for each fueling event and runs the reading
// checks. Actual readings are only ever written by people; this module writes
// estimates into separate columns and never touches actual_odometer.
import type { Db, OdometerLog } from "../db.js";
import { audit } from "../lib/audit.js";
import {
  buildIntervals,
  checkReading,
  estimateOdometer,
  selectReference,
  type ConsumptionBasis,
  type EstimateMethod,
  type Interval,
  type Reference,
  type TimelineEvent,
} from "../lib/calc.js";
import { getSettings, type Settings } from "../lib/settings.js";

const num = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v));

/** Flags that put a pending record into FLAGGED status automatically. */
export const SERIOUS_FLAGS = ["ACTUAL_LOWER_THAN_PREVIOUS", "ESTIMATE_LOWER_THAN_PREVIOUS", "LARGE_VARIANCE"];

type LogWithTx = OdometerLog & { transaction: { totalCost: unknown } | null };

export function toEvent(l: LogWithTx): TimelineEvent {
  const verified = l.readingType === "ACTUAL" && l.verificationStatus === "VERIFIED" && l.actualOdometer !== null;
  return {
    id: l.id,
    at: l.readingDate,
    liters: Number(l.fuelLiters),
    cost: l.transaction ? Number(l.transaction.totalCost) : 0,
    isFullTank: l.isFullTank,
    verifiedOdometer: verified ? Number(l.actualOdometer) : null,
  };
}

export async function loadTimeline(db: Db, vehicleId: number): Promise<LogWithTx[]> {
  return db.odometerLog.findMany({
    where: { vehicleId, isVoided: false },
    include: { transaction: { select: { totalCost: true } } },
    orderBy: [{ readingDate: "asc" }, { id: "asc" }],
  });
}

const before = (a: { readingDate: Date; id: number }, b: { readingDate: Date; id: number }) =>
  a.readingDate.getTime() < b.readingDate.getTime() || (a.readingDate.getTime() === b.readingDate.getTime() && a.id < b.id);

/** Verified intervals for a vehicle (optionally only those built from events before a cut-off log). */
export function intervalsFrom(logs: LogWithTx[], basis: ConsumptionBasis): Interval[] {
  return buildIntervals(logs.map(toEvent), basis);
}

export async function resolveReference(
  db: Db,
  vehicleId: number,
  priorLogs: LogWithTx[],
  settings: Settings,
): Promise<Reference | null> {
  const method = settings["odometer.estimateMethod"] as EstimateMethod;
  if (method === "APPROVED_REFERENCE") {
    const ref = await db.fuelEfficiencyReference.findFirst({
      where: { vehicleId, isActive: true },
      orderBy: { approvedAt: "desc" },
    });
    if (!ref || Number(ref.referenceLiters) <= 0 || Number(ref.referenceDistance) <= 0) return null;
    return {
      method,
      periodStart: ref.periodStart,
      periodEnd: ref.periodEnd,
      liters: Number(ref.referenceLiters),
      distanceKm: Number(ref.referenceDistance),
      efficiency: Number(ref.efficiencyKmPerLiter),
      quality: ref.quality as Reference["quality"],
      intervals: 1,
      referenceId: ref.id,
    };
  }
  const intervals = intervalsFrom(priorLogs, settings["odometer.consumptionBasis"] as ConsumptionBasis);
  return selectReference(intervals, method, settings["odometer.rollingWindow"]);
}

export interface ComputedFields {
  previousVerifiedOdometer: number | null;
  previousVerifiedAt: Date | null;
  previousVerifiedLogId: number | null;
  distanceTraveled: number | null;
  estimateStatus: string;
  estimateMethod: string | null;
  consumptionBasis: string | null;
  estimateLiters: number | null;
  efficiencyKmPerLiter: number | null;
  efficiencyQuality: string | null;
  referenceStart: Date | null;
  referenceEnd: Date | null;
  referenceLiters: number | null;
  referenceDistance: number | null;
  referenceId: number | null;
  referenceIntervals: number | null;
  estimatedDistance: number | null;
  estimatedOdometer: number | null;
  estimateComputedAt: Date;
  varianceKm: number | null;
  variancePct: number | null;
  flags: string[];
  insufficientReason?: string;
  steps?: string[];
}

/**
 * Compute everything derivable for one log using only records dated before it.
 * Estimates are chained from the last VERIFIED actual reading, never from another estimate.
 */
export async function computeFor(
  db: Db,
  log: Pick<OdometerLog, "id" | "vehicleId" | "readingDate" | "source" | "fuelLiters" | "actualOdometer">,
  settings: Settings,
  timeline?: LogWithTx[],
): Promise<ComputedFields> {
  const all = timeline ?? (await loadTimeline(db, log.vehicleId));
  const prior = all.filter((l) => l.id !== log.id && before(l, log));
  const basis = settings["odometer.consumptionBasis"] as ConsumptionBasis;
  const prevVerified = [...prior].reverse().find((l) => toEvent(l).verifiedOdometer !== null) ?? null;
  const prevOdo = prevVerified ? Number(prevVerified.actualOdometer) : null;
  const actual = num(log.actualOdometer);

  const out: ComputedFields = {
    previousVerifiedOdometer: prevOdo,
    previousVerifiedAt: prevVerified?.readingDate ?? null,
    previousVerifiedLogId: prevVerified?.id ?? null,
    distanceTraveled: prevOdo !== null && actual !== null ? Math.round((actual - prevOdo) * 10) / 10 : null,
    estimateStatus: "NOT_APPLICABLE",
    estimateMethod: null,
    consumptionBasis: null,
    estimateLiters: null,
    efficiencyKmPerLiter: null,
    efficiencyQuality: null,
    referenceStart: null,
    referenceEnd: null,
    referenceLiters: null,
    referenceDistance: null,
    referenceId: null,
    referenceIntervals: null,
    estimatedDistance: null,
    estimatedOdometer: null,
    estimateComputedAt: new Date(),
    varianceKm: null,
    variancePct: null,
    flags: [],
  };

  if (log.source === "FUEL_TRANSACTION") {
    // Fuel attributed to the interval from the previous verified reading to this event.
    let liters = 0;
    if (prevVerified) {
      const sincePrev = prior.filter((l) => before(prevVerified, l));
      if (basis === "FULL_TANK") liters = sincePrev.reduce((s, l) => s + Number(l.fuelLiters), 0) + Number(log.fuelLiters);
      else liters = Number(prevVerified.fuelLiters) + sincePrev.reduce((s, l) => s + Number(l.fuelLiters), 0);
    }
    liters = Math.round(liters * 100) / 100;
    const reference = await resolveReference(db, log.vehicleId, prior, settings);
    const r = estimateOdometer({ previousVerifiedOdometer: prevOdo, liters, reference });
    out.estimateMethod = settings["odometer.estimateMethod"];
    out.consumptionBasis = basis;
    out.estimateLiters = liters;
    if (reference) {
      out.efficiencyKmPerLiter = reference.efficiency;
      out.efficiencyQuality = reference.quality;
      out.referenceStart = reference.periodStart;
      out.referenceEnd = reference.periodEnd;
      out.referenceLiters = reference.liters;
      out.referenceDistance = reference.distanceKm;
      out.referenceId = reference.referenceId ?? null;
      out.referenceIntervals = reference.intervals;
    }
    if (r.status === "COMPUTED") {
      out.estimateStatus = "COMPUTED";
      out.estimatedDistance = r.estimatedDistanceKm;
      out.estimatedOdometer = r.estimatedOdometer;
      out.steps = r.steps;
    } else {
      out.estimateStatus = "INSUFFICIENT_DATA";
      out.insufficientReason = r.reason;
      out.flags.push("INSUFFICIENT_DATA");
    }
  }

  const check = checkReading({
    previousVerifiedOdometer: prevOdo,
    actualOdometer: actual,
    estimatedOdometer: out.estimatedOdometer,
    estimatedDistanceKm: out.estimatedDistance,
    variancePctThreshold: settings["odometer.variancePctThreshold"],
  });
  out.flags.push(...check.flags);
  out.varianceKm = check.varianceKm;
  out.variancePct = check.variancePct;
  if (actual === null) out.flags.push("NO_ACTUAL_READING");
  if (!prevVerified && log.source !== "INITIAL_REGISTRATION") out.flags.push("NO_PREVIOUS_VERIFIED");
  return out;
}

function persistable(c: ComputedFields) {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { insufficientReason, steps, ...rest } = c;
  return rest;
}

/** Recompute and store derived fields of one log. Never changes the actual reading. */
export async function applyComputed(db: Db, logId: number, settings?: Settings, timeline?: LogWithTx[]) {
  const s = settings ?? (await getSettings(db));
  const log = await db.odometerLog.findUniqueOrThrow({ where: { id: logId } });
  const c = await computeFor(db, log, s, timeline);
  const serious = c.flags.some((f) => SERIOUS_FLAGS.includes(f));
  return db.odometerLog.update({
    where: { id: logId },
    data: {
      ...persistable(c),
      verificationStatus: log.verificationStatus === "PENDING" && serious ? "FLAGGED" : log.verificationStatus,
    },
  });
}

/**
 * After a verified reading is added, corrected or voided, refresh the estimates of
 * later records that are not yet verified, and the vehicle's current verified odometer.
 */
export async function recalcVehicle(db: Db, vehicleId: number, userId: number | null, from?: Date) {
  const settings = await getSettings(db);
  const timeline = await loadTimeline(db, vehicleId);
  const targets = timeline.filter((l) => l.verificationStatus !== "VERIFIED" && (!from || l.readingDate >= from));
  let changed = 0;
  for (const t of targets) {
    const before = { estimatedOdometer: num(t.estimatedOdometer), estimateStatus: t.estimateStatus, flags: t.flags };
    const updated = await applyComputed(db, t.id, settings, timeline);
    const after = { estimatedOdometer: num(updated.estimatedOdometer), estimateStatus: updated.estimateStatus, flags: updated.flags };
    if (JSON.stringify(before) !== JSON.stringify(after)) {
      changed++;
      await audit(db, { userId, action: "ESTIMATE_RECALCULATED", module: "ODOMETER", recordId: t.recordNumber, before, after });
    }
  }
  await refreshVehicleOdometer(db, vehicleId);
  return changed;
}

/** vehicles.current_odometer always holds the latest VERIFIED actual reading. */
export async function refreshVehicleOdometer(db: Db, vehicleId: number) {
  const latest = await db.odometerLog.findFirst({
    where: { vehicleId, isVoided: false, readingType: "ACTUAL", verificationStatus: "VERIFIED" },
    orderBy: [{ readingDate: "desc" }, { id: "desc" }],
  });
  await db.vehicle.update({
    where: { id: vehicleId },
    data: { currentOdometer: latest?.actualOdometer ?? 0, currentOdometerAt: latest?.readingDate ?? null },
  });
}

/** Latest verified reading plus pending/flagged warnings, used by the request form. */
export async function odometerStatus(db: Db, vehicleId: number) {
  const latestVerified = await db.odometerLog.findFirst({
    where: { vehicleId, isVoided: false, readingType: "ACTUAL", verificationStatus: "VERIFIED" },
    orderBy: [{ readingDate: "desc" }, { id: "desc" }],
    include: { transaction: { select: { transactionNumber: true } } },
  });
  const latestEstimate = await db.odometerLog.findFirst({
    where: { vehicleId, isVoided: false, estimatedOdometer: { not: null } },
    orderBy: [{ readingDate: "desc" }, { id: "desc" }],
  });
  const pending = await db.odometerLog.count({ where: { vehicleId, isVoided: false, verificationStatus: "PENDING" } });
  const flagged = await db.odometerLog.count({ where: { vehicleId, isVoided: false, verificationStatus: "FLAGGED" } });
  return {
    latestVerified: latestVerified
      ? {
          odometer: Number(latestVerified.actualOdometer),
          readingDate: latestVerified.readingDate,
          recordNumber: latestVerified.recordNumber,
          transactionNumber: latestVerified.transaction?.transactionNumber ?? null,
        }
      : null,
    latestEstimate: latestEstimate
      ? { odometer: Number(latestEstimate.estimatedOdometer), readingDate: latestEstimate.readingDate, recordNumber: latestEstimate.recordNumber }
      : null,
    pendingCount: pending,
    flaggedCount: flagged,
  };
}
