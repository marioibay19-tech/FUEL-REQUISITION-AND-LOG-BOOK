import { Router } from "express";
import { z } from "zod";
import { prisma, type Prisma } from "../db.js";
import { FLAG_LABELS, type ConsumptionBasis } from "../lib/calc.js";
import { notFound } from "../lib/errors.js";
import { getSettings } from "../lib/settings.js";
import { manilaDayEnd, manilaDayStart } from "../lib/time.js";
import { paged, parse, zId, zListQuery } from "../lib/validate.js";
import { can, requirePerm, userOf } from "../middleware/auth.js";
import { computeFor, intervalsFrom, loadTimeline, recalcVehicle } from "../services/odometer.js";
import {
  actualInput,
  approveReference,
  correctActual,
  correctActualInput,
  flagInput,
  flagLog,
  manualInput,
  recordActual,
  recordManual,
  referenceInput,
  verifyInput,
  verifyLog,
} from "../services/odometer-actions.js";

export const odometerRouter = Router();

const listQuery = zListQuery.extend({
  vehicleId: z.coerce.number().int().positive().optional(),
  readingType: z.enum(["ACTUAL", "ESTIMATED"]).optional(),
  verificationStatus: z.enum(["PENDING", "VERIFIED", "FLAGGED"]).optional(),
  flagged: z.enum(["true"]).optional(),
  includeVoided: z.enum(["true", "false"]).default("false"),
  record: z.string().max(30).optional(),
});

export function odometerWhere(q: z.infer<typeof listQuery>): Prisma.OdometerLogWhereInput {
  const and: Prisma.OdometerLogWhereInput[] = [];
  if (q.includeVoided !== "true") and.push({ isVoided: false });
  if (q.vehicleId) and.push({ vehicleId: q.vehicleId });
  if (q.readingType) and.push({ readingType: q.readingType });
  if (q.verificationStatus) and.push({ verificationStatus: q.verificationStatus });
  if (q.flagged) and.push({ flags: { hasSome: ["ACTUAL_LOWER_THAN_PREVIOUS", "ESTIMATE_LOWER_THAN_PREVIOUS", "LARGE_VARIANCE"] } });
  if (q.record) and.push({ recordNumber: q.record });
  if (q.from) and.push({ readingDate: { gte: manilaDayStart(q.from) } });
  if (q.to) and.push({ readingDate: { lt: manilaDayEnd(q.to) } });
  if (q.q)
    and.push({
      OR: [
        { vehicle: { plateNumber: { contains: q.q, mode: "insensitive" } } },
        { recordNumber: { contains: q.q, mode: "insensitive" } },
        { transaction: { transactionNumber: { contains: q.q, mode: "insensitive" } } },
      ],
    });
  return { AND: and };
}

const include = {
  vehicle: { select: { id: true, plateNumber: true, description: true } },
  transaction: { select: { id: true, transactionNumber: true, totalCost: true, status: true } },
  encodedBy: { select: { id: true, fullName: true } },
  verifiedBy: { select: { id: true, fullName: true } },
} satisfies Prisma.OdometerLogInclude;

odometerRouter.get("/", requirePerm("odometer.view"), async (req, res) => {
  const q = parse(listQuery, req.query);
  const where = odometerWhere(q);
  const [items, total] = await Promise.all([
    prisma.odometerLog.findMany({ where, include, orderBy: [{ readingDate: "desc" }, { id: "desc" }], skip: (q.page - 1) * q.pageSize, take: q.pageSize }),
    prisma.odometerLog.count({ where }),
  ]);
  res.json({ ...paged(items, total, q.page, q.pageSize), flagLabels: FLAG_LABELS });
});

/** Full calculation detail for one record, including the step-by-step working. */
odometerRouter.get("/:id", requirePerm("odometer.view"), async (req, res) => {
  const user = userOf(req);
  const id = parse(zId, req.params.id);
  const log = await prisma.odometerLog.findUnique({ where: { id }, include });
  if (!log) throw notFound("Odometer record not found");
  const settings = await getSettings(prisma);
  const live = await computeFor(prisma, log, settings);
  const ref = log.referenceId ? await prisma.fuelEfficiencyReference.findUnique({ where: { id: log.referenceId }, include: { approvedBy: { select: { fullName: true } } } }) : null;
  const steps: string[] = [];
  const fmt = (v: unknown) => Number(v).toLocaleString("en-US", { maximumFractionDigits: 4 });
  if (log.estimateStatus === "COMPUTED" && log.referenceLiters && log.referenceDistance) {
    steps.push(`Reference interval: ${fmt(log.referenceDistance)} km travelled on ${fmt(log.referenceLiters)} L`);
    steps.push(`Fuel efficiency = ${fmt(log.referenceDistance)} km ÷ ${fmt(log.referenceLiters)} L = ${fmt(log.efficiencyKmPerLiter)} km/L`);
    steps.push(`${fmt(log.referenceLiters)} L : ${fmt(log.referenceDistance)} km = ${fmt(log.estimateLiters)} L : x km`);
    steps.push(`x = (${fmt(log.estimateLiters)} × ${fmt(log.referenceDistance)}) ÷ ${fmt(log.referenceLiters)} = ${fmt(log.estimatedDistance)} km`);
    steps.push(`Estimated odometer = ${fmt(log.previousVerifiedOdometer)} + ${fmt(log.estimatedDistance)} = ${fmt(log.estimatedOdometer)} km`);
  }
  const stale =
    log.verificationStatus !== "VERIFIED" &&
    (Number(live.estimatedOdometer ?? -1) !== Number(log.estimatedOdometer ?? -1) || live.estimateStatus !== log.estimateStatus);
  res.json({
    ...log,
    steps,
    insufficientReason: log.estimateStatus === "INSUFFICIENT_DATA" ? (live.insufficientReason ?? "Insufficient historical data") : null,
    reference: ref,
    stale,
    flagLabels: FLAG_LABELS,
    settings: { method: settings["odometer.estimateMethod"], basis: settings["odometer.consumptionBasis"], rollingWindow: settings["odometer.rollingWindow"], variancePctThreshold: settings["odometer.variancePctThreshold"] },
    actions: {
      recordActual: !log.isVoided && log.actualOdometer === null && can(user, "odometer.record"),
      correctActual: !log.isVoided && log.actualOdometer !== null && can(user, "odometer.record"),
      verify: !log.isVoided && log.verificationStatus !== "VERIFIED" && can(user, "odometer.verify") && (!settings["workflow.requireSeparateVerifier"] || log.encodedById !== user.id),
      flag: !log.isVoided && log.verificationStatus !== "FLAGGED" && can(user, "odometer.verify"),
      recalculate: !log.isVoided && log.verificationStatus !== "VERIFIED" && can(user, "odometer.verify"),
    },
  });
});

odometerRouter.post("/", requirePerm("odometer.record"), async (req, res) => {
  res.status(201).json(await recordManual(userOf(req), parse(manualInput, req.body), req.ip));
});
odometerRouter.post("/:id/actual", requirePerm("odometer.record"), async (req, res) => {
  res.json(await recordActual(userOf(req), parse(zId, req.params.id), parse(actualInput, req.body), req.ip));
});
odometerRouter.post("/:id/correct", requirePerm("odometer.record"), async (req, res) => {
  res.json(await correctActual(userOf(req), parse(zId, req.params.id), parse(correctActualInput, req.body), req.ip));
});
odometerRouter.post("/:id/verify", requirePerm("odometer.verify"), async (req, res) => {
  res.json(await verifyLog(userOf(req), parse(zId, req.params.id), parse(verifyInput, req.body ?? {}), req.ip));
});
odometerRouter.post("/:id/flag", requirePerm("odometer.verify"), async (req, res) => {
  res.json(await flagLog(userOf(req), parse(zId, req.params.id), parse(flagInput, req.body), req.ip));
});
odometerRouter.post("/vehicle/:vehicleId/recalculate", requirePerm("odometer.verify"), async (req, res) => {
  const vehicleId = parse(zId, req.params.vehicleId);
  const changed = await prisma.$transaction((tx) => recalcVehicle(tx, vehicleId, userOf(req).id), { timeout: 30000 });
  res.json({ changed });
});

/** Verified intervals for a vehicle (used to review and approve a reference). */
odometerRouter.get("/vehicle/:vehicleId/intervals", requirePerm("odometer.view"), async (req, res) => {
  const vehicleId = parse(zId, req.params.vehicleId);
  const settings = await getSettings(prisma);
  const intervals = intervalsFrom(await loadTimeline(prisma, vehicleId), settings["odometer.consumptionBasis"] as ConsumptionBasis);
  const references = await prisma.fuelEfficiencyReference.findMany({ where: { vehicleId }, include: { approvedBy: { select: { fullName: true } } }, orderBy: { approvedAt: "desc" } });
  res.json({ intervals, references, basis: settings["odometer.consumptionBasis"], method: settings["odometer.estimateMethod"] });
});

odometerRouter.post("/references", requirePerm("efficiency.approve"), async (req, res) => {
  res.status(201).json(await approveReference(userOf(req), parse(referenceInput, req.body), req.ip));
});
