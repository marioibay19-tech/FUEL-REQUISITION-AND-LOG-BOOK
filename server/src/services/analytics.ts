// Per-vehicle consumption statistics and configurable alerts.
import { Decimal } from "decimal.js";
import { prisma, type Prisma } from "../db.js";
import { round, type ConsumptionBasis, type Interval } from "../lib/calc.js";
import { getSettings, type Settings } from "../lib/settings.js";
import { manilaDayEnd, manilaDayStart } from "../lib/time.js";
import { intervalsFrom, resolveReference } from "./odometer.js";
import { APPROVED_FAMILY } from "./requests.js";

export interface Period {
  from: string; // YYYY-MM-DD (Manila)
  to: string;
}

export const periodRange = (p: Period) => ({ gte: manilaDayStart(p.from), lt: manilaDayEnd(p.to) });
const dateRange = (p: Period) => ({ gte: new Date(`${p.from}T00:00:00Z`), lte: new Date(`${p.to}T00:00:00Z`) });

const sum = (xs: number[]) => xs.reduce((a, b) => new Decimal(a).plus(b).toNumber(), 0);

export async function vehicleStats(period: Period, filter: { vehicleId?: number; fuelTypeId?: number; officeId?: number } = {}) {
  const settings = await getSettings(prisma);
  const basis = settings["odometer.consumptionBasis"] as ConsumptionBasis;
  const vWhere: Prisma.VehicleWhereInput = {
    ...(filter.vehicleId ? { id: filter.vehicleId } : {}),
    ...(filter.fuelTypeId ? { fuelTypeId: filter.fuelTypeId } : {}),
    ...(filter.officeId ? { officeId: filter.officeId } : {}),
  };
  const vehicles = await prisma.vehicle.findMany({ where: vWhere, include: { fuelType: true, office: true }, orderBy: { plateNumber: "asc" } });
  const ids = vehicles.map((v) => v.id);
  const range = periodRange(period);

  const [reqs, txs, logs] = await Promise.all([
    prisma.fuelRequest.findMany({
      where: { vehicleId: { in: ids }, requestDate: dateRange(period), status: { notIn: ["DRAFT", "CANCELLED"] } },
      select: { vehicleId: true, requestedLiters: true, approvedLiters: true, status: true },
    }),
    prisma.fuelTransaction.findMany({
      where: { vehicleId: { in: ids }, status: "ACTIVE", transactionDate: range },
      select: { vehicleId: true, litersIssued: true, totalCost: true },
    }),
    prisma.odometerLog.findMany({
      where: { vehicleId: { in: ids }, isVoided: false },
      include: { transaction: { select: { totalCost: true } } },
      orderBy: [{ readingDate: "asc" }, { id: "asc" }],
    }),
  ]);

  const rows = [];
  for (const v of vehicles) {
    const vr = reqs.filter((r) => r.vehicleId === v.id);
    const vt = txs.filter((t) => t.vehicleId === v.id);
    const vl = logs.filter((l) => l.vehicleId === v.id);
    const intervals = intervalsFrom(vl, basis);
    const inPeriod = intervals.filter((i) => i.endAt >= range.gte && i.endAt < range.lt);
    const reference = await resolveReference(prisma, v.id, vl, settings);
    const latestActual = [...vl].reverse().find((l) => l.actualOdometer !== null);
    const latestEstimate = [...vl].reverse().find((l) => l.estimatedOdometer !== null);
    const estimatedOnly = vl.filter((l) => l.readingType === "ESTIMATED" && l.estimatedDistance !== null && l.readingDate >= range.gte && l.readingDate < range.lt);
    const periodLiters = sum(inPeriod.map((i) => i.liters));
    const periodDistance = sum(inPeriod.map((i) => i.distanceKm));
    const periodCost = sum(inPeriod.map((i) => i.cost));
    rows.push({
      vehicleId: v.id,
      plateNumber: v.plateNumber,
      description: v.description,
      classification: v.classification,
      fuelType: v.fuelType.name,
      office: v.office?.name ?? null,
      status: v.status,
      totalRequested: sum(vr.map((r) => Number(r.requestedLiters))),
      totalApproved: sum(vr.filter((r) => APPROVED_FAMILY.includes(r.status)).map((r) => Number(r.approvedLiters ?? 0))),
      totalIssued: sum(vt.map((t) => Number(t.litersIssued))),
      totalExpenditure: sum(vt.map((t) => Number(t.totalCost))),
      transactions: vt.length,
      latestActual: latestActual
        ? { odometer: Number(latestActual.actualOdometer), at: latestActual.readingDate, verificationStatus: latestActual.verificationStatus }
        : null,
      latestEstimated: latestEstimate ? { odometer: Number(latestEstimate.estimatedOdometer), at: latestEstimate.readingDate } : null,
      verifiedDistance: periodDistance,
      estimatedDistance: sum(estimatedOnly.map((l) => Number(l.estimatedDistance))),
      periodEfficiency: periodLiters > 0 && periodDistance > 0 ? round(periodDistance / periodLiters, 4) : null,
      periodEfficiencyQuality: inPeriod.length ? (inPeriod.every((i) => i.quality === "VERIFIED") ? "VERIFIED" : "ESTIMATED") : null,
      historicalEfficiency: reference?.efficiency ?? null,
      historicalEfficiencyQuality: reference?.quality ?? null,
      reference: reference
        ? { method: reference.method, periodStart: reference.periodStart, periodEnd: reference.periodEnd, liters: reference.liters, distanceKm: reference.distanceKm, intervals: reference.intervals }
        : null,
      costPerKm: periodDistance > 0 && periodCost > 0 ? round(periodCost / periodDistance, 2) : null,
      intervals: intervals.length,
    });
  }
  return rows;
}

export interface Alert {
  type: string;
  severity: "info" | "warning" | "critical";
  vehicleId: number | null;
  plateNumber: string | null;
  message: string;
  reference?: string;
  link?: string;
  dataQuality?: string;
  at?: Date;
}

export const ALERT_LABELS: Record<string, string> = {
  HIGH_CONSUMPTION: "Unusually high fuel consumption",
  EFFICIENCY_CHANGE: "Abnormal change in fuel efficiency",
  DUPLICATE_TRANSACTION: "Possible duplicate fuel transaction",
  MISSING_ODOMETER: "Missing odometer reading",
  INCONSISTENT_ODOMETER: "Inconsistent odometer reading",
  FREQUENT_REQUESTS: "Unusually frequent fuel requests",
  MISSING_DOCUMENTS: "Missing supporting document",
};

const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

function weighted(ivs: Interval[]) {
  const l = sum(ivs.map((i) => i.liters));
  const d = sum(ivs.map((i) => i.distanceKm));
  return l > 0 ? d / l : null;
}

export async function computeAlerts(period: Period, filter: { vehicleId?: number } = {}, settingsIn?: Settings): Promise<Alert[]> {
  const settings = settingsIn ?? (await getSettings(prisma));
  const basis = settings["odometer.consumptionBasis"] as ConsumptionBasis;
  const range = periodRange(period);
  const alerts: Alert[] = [];
  const vehicles = await prisma.vehicle.findMany({ where: filter.vehicleId ? { id: filter.vehicleId } : { status: { not: "RETIRED" } } });
  const byId = new Map(vehicles.map((v) => [v.id, v]));
  const ids = vehicles.map((v) => v.id);
  const logs = await prisma.odometerLog.findMany({
    where: { vehicleId: { in: ids }, isVoided: false },
    include: { transaction: { select: { totalCost: true, transactionNumber: true } } },
    orderBy: [{ readingDate: "asc" }, { id: "asc" }],
  });

  // Consumption alerts: compare with the vehicle's own baseline and with its classification.
  const overall = new Map<number, { eff: number; quality: string }>();
  const latestByVehicle = new Map<number, Interval[]>();
  for (const v of vehicles) {
    const ivs = intervalsFrom(logs.filter((l) => l.vehicleId === v.id), basis).filter((i) => i.endAt < range.lt);
    latestByVehicle.set(v.id, ivs);
    const eff = weighted(ivs);
    if (eff && ivs.length >= settings["alerts.minIntervals"]) overall.set(v.id, { eff, quality: ivs.every((i) => i.quality === "VERIFIED") ? "verified" : "estimated" });
  }
  const classMedians = new Map<string, number>();
  const byClass = new Map<string, number[]>();
  for (const [vid, o] of overall) {
    const c = byId.get(vid)!.classification;
    byClass.set(c, [...(byClass.get(c) ?? []), o.eff]);
  }
  for (const [c, effs] of byClass) if (effs.length >= 3) classMedians.set(c, median(effs));

  for (const v of vehicles) {
    const ivs = latestByVehicle.get(v.id) ?? [];
    if (ivs.length < settings["alerts.minIntervals"]) continue;
    const last = ivs[ivs.length - 1];
    if (last.endAt < range.gte) continue;
    const baseline = weighted(ivs.slice(0, -1));
    const quality = last.quality === "VERIFIED" ? "verified (full-tank) data" : "estimated fuel attribution";
    if (baseline) {
      const drop = ((baseline - last.efficiency) / baseline) * 100;
      if (drop > settings["alerts.highConsumptionPct"]) {
        alerts.push({
          type: "HIGH_CONSUMPTION",
          severity: last.quality === "VERIFIED" ? "warning" : "info",
          vehicleId: v.id,
          plateNumber: v.plateNumber,
          message: `Latest interval ${last.efficiency.toFixed(2)} km/L is ${drop.toFixed(0)}% below this vehicle's baseline of ${baseline.toFixed(2)} km/L. Based on ${quality}; consider route, load and operating conditions before concluding.`,
          dataQuality: last.quality,
          at: last.endAt,
          link: `/vehicles/${v.id}`,
        });
      }
      const prev = ivs[ivs.length - 2];
      const change = ((last.efficiency - prev.efficiency) / prev.efficiency) * 100;
      if (Math.abs(change) > settings["alerts.efficiencyChangePct"]) {
        alerts.push({
          type: "EFFICIENCY_CHANGE",
          severity: "info",
          vehicleId: v.id,
          plateNumber: v.plateNumber,
          message: `Efficiency changed ${change > 0 ? "+" : ""}${change.toFixed(0)}% between consecutive intervals (${prev.efficiency.toFixed(2)} → ${last.efficiency.toFixed(2)} km/L).`,
          dataQuality: last.quality,
          at: last.endAt,
          link: `/vehicles/${v.id}`,
        });
      }
    }
    const med = classMedians.get(v.classification);
    const o = overall.get(v.id);
    if (med && o) {
      const dev = ((med - o.eff) / med) * 100;
      if (dev > settings["alerts.classDeviationPct"]) {
        alerts.push({
          type: "HIGH_CONSUMPTION",
          severity: "info",
          vehicleId: v.id,
          plateNumber: v.plateNumber,
          message: `Average ${o.eff.toFixed(2)} km/L is ${dev.toFixed(0)}% below the median of ${v.classification} units (${med.toFixed(2)} km/L, ${o.quality} data). Usage patterns may differ; review before concluding.`,
          dataQuality: o.quality.toUpperCase(),
          link: `/vehicles/${v.id}`,
        });
      }
    }
  }

  // Odometer consistency and missing readings within the period.
  for (const l of logs) {
    if (l.readingDate < range.gte || l.readingDate >= range.lt) continue;
    const v = byId.get(l.vehicleId)!;
    const bad = l.flags.filter((f) => ["ACTUAL_LOWER_THAN_PREVIOUS", "ESTIMATE_LOWER_THAN_PREVIOUS", "LARGE_VARIANCE"].includes(f));
    if (bad.length && l.verificationStatus !== "VERIFIED") {
      alerts.push({
        type: "INCONSISTENT_ODOMETER",
        severity: bad.includes("ACTUAL_LOWER_THAN_PREVIOUS") ? "critical" : "warning",
        vehicleId: v.id,
        plateNumber: v.plateNumber,
        message:
          bad.includes("ACTUAL_LOWER_THAN_PREVIOUS")
            ? `Actual reading ${Number(l.actualOdometer).toLocaleString()} km is lower than the previous verified ${Number(l.previousVerifiedOdometer).toLocaleString()} km.`
            : bad.includes("LARGE_VARIANCE")
              ? `Actual reading differs from the estimate by ${Number(l.varianceKm).toLocaleString()} km (${Number(l.variancePct)}%).`
              : "Estimated reading is lower than the previous verified reading.",
        reference: l.recordNumber,
        at: l.readingDate,
        link: `/odometer?record=${l.recordNumber}`,
      });
    }
    if (l.source === "FUEL_TRANSACTION" && l.actualOdometer === null) {
      alerts.push({
        type: "MISSING_ODOMETER",
        severity: "warning",
        vehicleId: v.id,
        plateNumber: v.plateNumber,
        message: `No actual odometer reading for ${l.transaction?.transactionNumber ?? l.recordNumber}${l.estimatedOdometer !== null ? ` (estimate ${Number(l.estimatedOdometer).toLocaleString()} km)` : ""}.`,
        reference: l.recordNumber,
        at: l.readingDate,
        link: `/odometer?record=${l.recordNumber}`,
      });
    }
  }

  // Transactions: duplicates and missing documents.
  const txs = await prisma.fuelTransaction.findMany({
    where: { vehicleId: { in: ids }, status: "ACTIVE", transactionDate: range },
    include: { vehicle: true },
    orderBy: { transactionDate: "asc" },
  });
  const attached = new Set(
    (await prisma.attachment.findMany({ where: { entityType: "FUEL_TRANSACTION", entityId: { in: txs.map((t) => t.id) } }, select: { entityId: true } })).map((a) => a.entityId),
  );
  const windowMs = settings["alerts.duplicateTxHours"] * 3600_000;
  for (let i = 0; i < txs.length; i++) {
    const t = txs[i];
    for (let j = i + 1; j < txs.length; j++) {
      const u = txs[j];
      if (u.transactionDate.getTime() - t.transactionDate.getTime() > windowMs) break;
      if (u.vehicleId === t.vehicleId && Number(u.litersIssued) === Number(t.litersIssued)) {
        alerts.push({
          type: "DUPLICATE_TRANSACTION",
          severity: "warning",
          vehicleId: t.vehicleId,
          plateNumber: t.vehicle.plateNumber,
          message: `${t.transactionNumber} and ${u.transactionNumber} have the same quantity (${Number(t.litersIssued)} L) within ${settings["alerts.duplicateTxHours"]} hours.`,
          reference: u.transactionNumber,
          at: u.transactionDate,
          link: `/transactions/${u.id}`,
        });
      }
    }
    if (!t.receiptNumber && !attached.has(t.id)) {
      alerts.push({
        type: "MISSING_DOCUMENTS",
        severity: "info",
        vehicleId: t.vehicleId,
        plateNumber: t.vehicle.plateNumber,
        message: `${t.transactionNumber} has no receipt number or attached document.`,
        reference: t.transactionNumber,
        at: t.transactionDate,
        link: `/transactions/${t.id}`,
      });
    }
  }

  // Frequent requests: more than N submitted within D days (sliding window).
  const reqs = await prisma.fuelRequest.findMany({
    where: { vehicleId: { in: ids }, submittedAt: { gte: new Date(range.gte.getTime() - settings["alerts.frequentRequestDays"] * 86400_000), lt: range.lt }, status: { not: "CANCELLED" } },
    select: { vehicleId: true, submittedAt: true },
    orderBy: { submittedAt: "asc" },
  });
  const dMs = settings["alerts.frequentRequestDays"] * 86400_000;
  for (const v of vehicles) {
    const times = reqs.filter((r) => r.vehicleId === v.id).map((r) => r.submittedAt!.getTime());
    let maxCount = 0;
    let lo = 0;
    for (let hi = 0; hi < times.length; hi++) {
      while (times[hi] - times[lo] > dMs) lo++;
      if (times[hi] >= range.gte.getTime()) maxCount = Math.max(maxCount, hi - lo + 1);
    }
    if (maxCount > settings["alerts.frequentRequestCount"]) {
      alerts.push({
        type: "FREQUENT_REQUESTS",
        severity: "info",
        vehicleId: v.id,
        plateNumber: v.plateNumber,
        message: `${maxCount} fuel requests within ${settings["alerts.frequentRequestDays"]} days (threshold ${settings["alerts.frequentRequestCount"]}).`,
        link: `/vehicles/${v.id}`,
      });
    }
  }

  const order = { critical: 0, warning: 1, info: 2 };
  return alerts.sort((a, b) => order[a.severity] - order[b.severity] || (b.at?.getTime() ?? 0) - (a.at?.getTime() ?? 0));
}

/** Active vehicles with pending/flagged odometer records or no verified reading within the configured days. */
export async function vehiclesNeedingVerification(settingsIn?: Settings, filter: { vehicleId?: number } = {}) {
  const settings = settingsIn ?? (await getSettings(prisma));
  const cutoff = new Date(Date.now() - settings["odometer.verificationDays"] * 86400_000);
  const vehicles = await prisma.vehicle.findMany({
    where: { status: "ACTIVE", ...(filter.vehicleId ? { id: filter.vehicleId } : {}) },
    select: {
      id: true,
      plateNumber: true,
      currentOdometerAt: true,
      odometerLogs: { where: { isVoided: false, verificationStatus: { in: ["PENDING", "FLAGGED"] } }, select: { id: true, verificationStatus: true } },
    },
  });
  return vehicles
    .map((v) => ({
      vehicleId: v.id,
      plateNumber: v.plateNumber,
      pending: v.odometerLogs.filter((l) => l.verificationStatus === "PENDING").length,
      flagged: v.odometerLogs.filter((l) => l.verificationStatus === "FLAGGED").length,
      lastVerifiedAt: v.currentOdometerAt,
      stale: !v.currentOdometerAt || v.currentOdometerAt < cutoff,
    }))
    .filter((v) => v.pending > 0 || v.flagged > 0 || v.stale);
}
