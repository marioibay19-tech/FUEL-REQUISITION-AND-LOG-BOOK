import { z } from "zod";
import { prisma } from "../db.js";
import { audit } from "../lib/audit.js";
import { fuelEfficiency } from "../lib/calc.js";
import { badRequest, conflict, forbidden, notFound } from "../lib/errors.js";
import { notifyUsers, usersWithRoles } from "../lib/notify.js";
import { nextNumber } from "../lib/numbering.js";
import { getSettings } from "../lib/settings.js";
import { zNonNeg, zOptText, zPositive, zRequiredText } from "../lib/validate.js";
import { can, type AuthUser } from "../middleware/auth.js";
import { applyComputed, recalcVehicle } from "./odometer.js";

const n = (v: unknown) => (v === null || v === undefined ? null : Number(v));

export const actualInput = z.object({ actualOdometer: zNonNeg("Actual odometer reading"), remarks: zOptText(1000) });
export const correctActualInput = z.object({ actualOdometer: zNonNeg("Actual odometer reading"), reason: zRequiredText(1000, "Reason for correction") });
export const verifyInput = z.object({ remarks: zOptText(1000) });
export const flagInput = z.object({ remarks: zRequiredText(1000, "Remarks") });
export const manualInput = z.object({
  vehicleId: z.coerce.number().int().positive("Select a vehicle"),
  readingDate: z.string().datetime({ offset: true, message: "Enter a valid date and time" }),
  actualOdometer: zNonNeg("Actual odometer reading"),
  remarks: zOptText(1000),
});

async function getLog(id: number) {
  const log = await prisma.odometerLog.findUnique({ where: { id }, include: { vehicle: true } });
  if (!log) throw notFound("Odometer record not found");
  if (log.isVoided) throw conflict("This odometer record was voided and can no longer be changed");
  return log;
}

/** Fill in a missing actual reading. The estimate stays in its own columns for comparison. */
export async function recordActual(user: AuthUser, id: number, input: z.infer<typeof actualInput>, ip?: string) {
  if (!can(user, "odometer.record")) throw forbidden();
  const log = await getLog(id);
  if (log.actualOdometer !== null) throw conflict("An actual reading is already recorded. Use 'Correct actual reading' to change it.");
  return prisma.$transaction(async (tx) => {
    await tx.odometerLog.update({
      where: { id },
      data: { actualOdometer: input.actualOdometer, actualRecordedAt: new Date(), readingType: "ACTUAL", verificationStatus: "PENDING", remarks: input.remarks ?? log.remarks },
    });
    const updated = await applyComputed(tx, id);
    await audit(tx, {
      userId: user.id,
      action: "ODOMETER_ACTUAL_RECORDED",
      module: "ODOMETER",
      recordId: log.recordNumber,
      before: { readingType: log.readingType, actualOdometer: null, estimatedOdometer: n(log.estimatedOdometer) },
      after: { readingType: "ACTUAL", actualOdometer: input.actualOdometer, varianceKm: n(updated.varianceKm), variancePct: n(updated.variancePct), flags: updated.flags },
      ip,
    });
    await notifyUsers(tx, await usersWithRoles(tx, ["ADMIN", "APPROVER"]), {
      type: "ODOMETER_VERIFICATION",
      title: `Odometer record ${log.recordNumber} needs verification`,
      message: `${log.vehicle.plateNumber}: actual reading ${input.actualOdometer.toLocaleString()} km recorded.`,
      link: `/odometer?record=${log.recordNumber}`,
    });
    return updated;
  });
}

/** Correct an actual reading with a reason. The first recorded value is preserved. */
export async function correctActual(user: AuthUser, id: number, input: z.infer<typeof correctActualInput>, ip?: string) {
  if (!can(user, "odometer.record")) throw forbidden();
  const log = await getLog(id);
  if (log.actualOdometer === null) throw conflict("There is no actual reading to correct. Record the actual reading instead.");
  if (Number(log.actualOdometer) === input.actualOdometer) throw badRequest("Please correct the highlighted fields", { fields: { actualOdometer: "Enter a different reading" } });
  return prisma.$transaction(async (tx) => {
    const wasVerified = log.verificationStatus === "VERIFIED";
    await tx.odometerLog.update({
      where: { id },
      data: {
        originalActualOdometer: log.originalActualOdometer ?? log.actualOdometer,
        actualOdometer: input.actualOdometer,
        actualRecordedAt: new Date(),
        // A corrected reading must be verified again before it is used as a reference.
        verificationStatus: "PENDING",
        verifiedById: null,
        verifiedAt: null,
      },
    });
    const updated = await applyComputed(tx, id);
    await audit(tx, {
      userId: user.id,
      action: "ODOMETER_ACTUAL_CORRECTED",
      module: "ODOMETER",
      recordId: log.recordNumber,
      before: { actualOdometer: n(log.actualOdometer), verificationStatus: log.verificationStatus },
      after: { actualOdometer: input.actualOdometer, verificationStatus: updated.verificationStatus, originalActualOdometer: n(updated.originalActualOdometer) },
      reason: input.reason,
      ip,
    });
    if (wasVerified) await recalcVehicle(tx, log.vehicleId, user.id, log.readingDate);
    return updated;
  });
}

export async function verifyLog(user: AuthUser, id: number, input: z.infer<typeof verifyInput>, ip?: string) {
  if (!can(user, "odometer.verify")) throw forbidden();
  const log = await getLog(id);
  if (log.verificationStatus === "VERIFIED") throw conflict("This record is already verified");
  const settings = await getSettings(prisma);
  if (settings["workflow.requireSeparateVerifier"] && log.encodedById === user.id) throw forbidden("The encoder cannot verify their own odometer record");
  const serious = log.flags.filter((f) => ["ACTUAL_LOWER_THAN_PREVIOUS", "LARGE_VARIANCE", "ESTIMATE_LOWER_THAN_PREVIOUS"].includes(f));
  if (serious.length && !input.remarks)
    throw badRequest("Please correct the highlighted fields", { fields: { remarks: "Explain why this flagged record is acceptable (e.g. odometer replaced, verified against trip tickets)" } });
  if (log.readingType === "ESTIMATED" && !input.remarks)
    throw badRequest("Please correct the highlighted fields", { fields: { remarks: "Describe how the estimate was reviewed" } });
  return prisma.$transaction(async (tx) => {
    const updated = await tx.odometerLog.update({
      where: { id },
      data: { verificationStatus: "VERIFIED", verifiedById: user.id, verifiedAt: new Date(), remarks: input.remarks ?? log.remarks },
    });
    await audit(tx, {
      userId: user.id,
      action: log.readingType === "ACTUAL" ? "ODOMETER_READING_VERIFIED" : "ODOMETER_ESTIMATE_VERIFIED",
      module: "ODOMETER",
      recordId: log.recordNumber,
      before: { verificationStatus: log.verificationStatus },
      after: { verificationStatus: "VERIFIED", readingType: log.readingType },
      reason: input.remarks ?? null,
      ip,
    });
    // A newly verified actual reading becomes the base for later estimates.
    if (log.readingType === "ACTUAL") await recalcVehicle(tx, log.vehicleId, user.id, log.readingDate);
    return updated;
  });
}

export async function flagLog(user: AuthUser, id: number, input: z.infer<typeof flagInput>, ip?: string) {
  if (!can(user, "odometer.verify")) throw forbidden();
  const log = await getLog(id);
  return prisma.$transaction(async (tx) => {
    const updated = await tx.odometerLog.update({
      where: { id },
      data: { verificationStatus: "FLAGGED", verifiedById: null, verifiedAt: null, remarks: input.remarks },
    });
    await audit(tx, { userId: user.id, action: "ODOMETER_FLAGGED", module: "ODOMETER", recordId: log.recordNumber, before: { verificationStatus: log.verificationStatus }, after: { verificationStatus: "FLAGGED" }, reason: input.remarks, ip });
    if (log.verificationStatus === "VERIFIED" && log.readingType === "ACTUAL") await recalcVehicle(tx, log.vehicleId, user.id, log.readingDate);
    const encoder = log.encodedById;
    await notifyUsers(tx, [encoder], { type: "ODOMETER_FLAGGED", title: `Odometer record ${log.recordNumber} flagged`, message: input.remarks, link: `/odometer?record=${log.recordNumber}` });
    return updated;
  });
}

/** An actual reading taken outside a fueling event (e.g. inspection, trip ticket). */
export async function recordManual(user: AuthUser, input: z.infer<typeof manualInput>, ip?: string) {
  if (!can(user, "odometer.record")) throw forbidden();
  const vehicle = await prisma.vehicle.findUnique({ where: { id: input.vehicleId } });
  if (!vehicle) throw badRequest("Please correct the highlighted fields", { fields: { vehicleId: "Vehicle not found" } });
  const at = new Date(input.readingDate);
  if (at.getTime() > Date.now() + 5 * 60_000) throw badRequest("Please correct the highlighted fields", { fields: { readingDate: "Reading date cannot be in the future" } });
  return prisma.$transaction(async (tx) => {
    const log = await tx.odometerLog.create({
      data: {
        recordNumber: await nextNumber(tx, "OD"),
        vehicleId: vehicle.id,
        source: "MANUAL_READING",
        readingDate: at,
        actualOdometer: input.actualOdometer,
        actualRecordedAt: new Date(),
        readingType: "ACTUAL",
        encodedById: user.id,
        remarks: input.remarks ?? null,
      },
    });
    const updated = await applyComputed(tx, log.id);
    await audit(tx, { userId: user.id, action: "ODOMETER_RECORD_CREATED", module: "ODOMETER", recordId: log.recordNumber, after: { vehicle: vehicle.plateNumber, actualOdometer: input.actualOdometer, flags: updated.flags }, ip });
    await notifyUsers(tx, await usersWithRoles(tx, ["ADMIN", "APPROVER"]), {
      type: "ODOMETER_VERIFICATION",
      title: `Odometer record ${log.recordNumber} needs verification`,
      message: `${vehicle.plateNumber}: reading ${input.actualOdometer.toLocaleString()} km recorded by ${user.fullName}.`,
      link: `/odometer?record=${log.recordNumber}`,
    });
    return updated;
  });
}

export const referenceInput = z.object({
  vehicleId: z.coerce.number().int().positive(),
  source: z.enum(["COMPUTED_INTERVAL", "MANUAL"]),
  periodStart: z.string().datetime({ offset: true }).nullable().optional(),
  periodEnd: z.string().datetime({ offset: true }).nullable().optional(),
  referenceLiters: zPositive("Reference fuel quantity"),
  referenceDistance: zPositive("Reference distance"),
  quality: z.enum(["VERIFIED", "ESTIMATED", "MANUAL"]).default("MANUAL"),
  notes: zOptText(1000),
});

/** Approve a reference interval for the APPROVED_REFERENCE method; replaces the vehicle's active one. */
export async function approveReference(user: AuthUser, input: z.infer<typeof referenceInput>, ip?: string) {
  if (!can(user, "efficiency.approve")) throw forbidden();
  if (input.source === "MANUAL" && !input.notes) throw badRequest("Please correct the highlighted fields", { fields: { notes: "Describe where the manual reference comes from" } });
  const efficiency = fuelEfficiency(input.referenceDistance, input.referenceLiters);
  return prisma.$transaction(async (tx) => {
    const vehicle = await tx.vehicle.findUniqueOrThrow({ where: { id: input.vehicleId } });
    const previous = await tx.fuelEfficiencyReference.findMany({ where: { vehicleId: vehicle.id, isActive: true } });
    await tx.fuelEfficiencyReference.updateMany({ where: { vehicleId: vehicle.id, isActive: true }, data: { isActive: false } });
    const ref = await tx.fuelEfficiencyReference.create({
      data: {
        vehicleId: vehicle.id,
        source: input.source,
        periodStart: input.periodStart ? new Date(input.periodStart) : null,
        periodEnd: input.periodEnd ? new Date(input.periodEnd) : null,
        referenceLiters: input.referenceLiters,
        referenceDistance: input.referenceDistance,
        efficiencyKmPerLiter: efficiency,
        quality: input.source === "MANUAL" ? "MANUAL" : input.quality,
        notes: input.notes ?? null,
        approvedById: user.id,
      },
    });
    await audit(tx, {
      userId: user.id,
      action: "EFFICIENCY_REFERENCE_APPROVED",
      module: "ODOMETER",
      recordId: `${vehicle.plateNumber}#${ref.id}`,
      before: previous.map((p) => ({ id: p.id, efficiency: Number(p.efficiencyKmPerLiter) })),
      after: { id: ref.id, liters: input.referenceLiters, distance: input.referenceDistance, efficiency },
      reason: input.notes ?? null,
      ip,
    });
    const settings = await getSettings(tx);
    if (settings["odometer.estimateMethod"] === "APPROVED_REFERENCE") await recalcVehicle(tx, vehicle.id, user.id);
    return ref;
  });
}
