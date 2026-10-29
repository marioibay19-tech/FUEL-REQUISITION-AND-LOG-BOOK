import { z } from "zod";
import { prisma, type Db, type FuelTransaction } from "../db.js";
import { audit } from "../lib/audit.js";
import { computeCost } from "../lib/calc.js";
import { badRequest, conflict, forbidden, notFound } from "../lib/errors.js";
import { notifyUsers, usersWithRoles } from "../lib/notify.js";
import { nextNumber } from "../lib/numbering.js";
import { getSettings } from "../lib/settings.js";
import { zOptId, zOptNonNeg, zOptText, zPositive, zNonNeg, zRequiredText } from "../lib/validate.js";
import { can, type AuthUser } from "../middleware/auth.js";
import { applyComputed, recalcVehicle } from "./odometer.js";
import { ISSUABLE, STATUS_LABELS, syncIssued } from "./requests.js";

export const issueInput = z.object({
  clientToken: z.string().trim().min(8).max(64).optional(),
  requestId: zOptId.optional(),
  vehicleId: zOptId.optional(),
  fuelTypeId: zOptId.optional(),
  transactionDate: z.string().datetime({ offset: true, message: "Enter a valid transaction date and time" }),
  litersIssued: zPositive("Actual liters issued"),
  pricePerLiter: zNonNeg("Actual price per liter"),
  odometerReading: zOptNonNeg("Odometer reading"),
  isFullTank: z.boolean().default(false),
  station: zOptText(150),
  receiptNumber: zOptText(60),
  remarks: zOptText(2000),
});
export type IssueInput = z.infer<typeof issueInput>;

export const correctionInput = issueInput.omit({ clientToken: true, requestId: true, vehicleId: true }).extend({
  reason: zRequiredText(1000, "Reason for correction"),
});

function snapshot(t: FuelTransaction) {
  return {
    transactionNumber: t.transactionNumber,
    status: t.status,
    requestId: t.requestId,
    vehicleId: t.vehicleId,
    fuelTypeId: t.fuelTypeId,
    transactionDate: t.transactionDate,
    litersIssued: Number(t.litersIssued),
    pricePerLiter: Number(t.pricePerLiter),
    totalCost: Number(t.totalCost),
    odometerReading: t.odometerReading === null ? null : Number(t.odometerReading),
    isFullTank: t.isFullTank,
    station: t.station,
    receiptNumber: t.receiptNumber,
  };
}

/** Create the odometer log for a fueling event and compute its estimate and checks. */
async function createOdometerLog(db: Db, t: FuelTransaction, userId: number, carry?: { originalActualOdometer: unknown; remarks: string | null }) {
  const actual = t.odometerReading === null ? null : Number(t.odometerReading);
  const log = await db.odometerLog.create({
    data: {
      recordNumber: await nextNumber(db, "OD"),
      vehicleId: t.vehicleId,
      transactionId: t.id,
      source: "FUEL_TRANSACTION",
      readingDate: t.transactionDate,
      isFullTank: t.isFullTank,
      fuelLiters: t.litersIssued,
      actualOdometer: actual,
      originalActualOdometer: (carry?.originalActualOdometer as number | null) ?? null,
      actualRecordedAt: actual === null ? null : new Date(),
      readingType: actual === null ? "ESTIMATED" : "ACTUAL",
      verificationStatus: "PENDING",
      encodedById: userId,
      remarks: carry?.remarks ?? null,
    },
  });
  const computed = await applyComputed(db, log.id);
  await audit(db, {
    userId,
    action: computed.estimateStatus === "COMPUTED" ? "ODOMETER_ESTIMATE_CALCULATED" : "ODOMETER_RECORD_CREATED",
    module: "ODOMETER",
    recordId: computed.recordNumber,
    after: {
      transaction: t.transactionNumber,
      readingType: computed.readingType,
      actualOdometer: computed.actualOdometer,
      estimateStatus: computed.estimateStatus,
      estimatedOdometer: computed.estimatedOdometer,
      efficiencyKmPerLiter: computed.efficiencyKmPerLiter,
      flags: computed.flags,
    },
  });
  return computed;
}

async function alertForLog(db: Db, log: Awaited<ReturnType<typeof createOdometerLog>>, plate: string) {
  const link = `/odometer?record=${log.recordNumber}`;
  const verifiers = await usersWithRoles(db, ["ADMIN", "APPROVER"]);
  await notifyUsers(db, verifiers, {
    type: "ODOMETER_VERIFICATION",
    title: `Odometer record ${log.recordNumber} needs verification`,
    message: `${plate}: ${log.readingType === "ACTUAL" ? `actual reading ${Number(log.actualOdometer).toLocaleString()} km` : "no actual reading (estimate only)"}${log.flags.length ? ` — ${log.flags.join(", ").toLowerCase().replaceAll("_", " ")}` : ""}.`,
    link,
  });
  if (log.flags.includes("LARGE_VARIANCE") && log.varianceKm !== null && Number(log.varianceKm) < 0) {
    await notifyUsers(db, await usersWithRoles(db, ["ADMIN"]), {
      type: "ABNORMAL_CONSUMPTION",
      title: `Possible high fuel consumption: ${plate}`,
      message: `Actual distance is ${Math.abs(Number(log.variancePct ?? 0))}% below the estimate for the fuel issued (${log.recordNumber}). Review usage and operating conditions.`,
      link,
    });
  }
}

export async function issueFuel(user: AuthUser, input: IssueInput, ip?: string) {
  if (!can(user, "transaction.create")) throw forbidden();
  if (input.clientToken) {
    const existing = await prisma.fuelTransaction.findUnique({ where: { clientToken: input.clientToken } });
    if (existing) return { transaction: existing, duplicate: true };
  }
  const settings = await getSettings(prisma);
  const txDate = new Date(input.transactionDate);
  if (txDate.getTime() > Date.now() + 5 * 60_000) throw badRequest("Please correct the highlighted fields", { fields: { transactionDate: "Transaction date cannot be in the future" } });
  if (settings["workflow.requireReceiptForIssuance"] && !input.receiptNumber)
    throw badRequest("Please correct the highlighted fields", { fields: { receiptNumber: "Receipt or supporting document number is required" } });

  const transaction = await prisma.$transaction(async (tx) => {
    let request = null;
    let vehicleId = input.vehicleId ?? null;
    let fuelTypeId = input.fuelTypeId ?? null;
    if (input.requestId) {
      await tx.$queryRaw`SELECT id FROM fuel_requests WHERE id = ${input.requestId} FOR UPDATE`;
      request = await tx.fuelRequest.findUnique({ where: { id: input.requestId } });
      if (!request) throw badRequest("Please correct the highlighted fields", { fields: { requestId: "Fuel request not found" } });
      if (!ISSUABLE.includes(request.status)) throw conflict(`Fuel cannot be issued for a request that is ${STATUS_LABELS[request.status]}`);
      const remaining = Number(request.approvedLiters ?? 0) - Number(request.issuedLiters);
      if (input.litersIssued > remaining + 1e-9)
        throw badRequest("Please correct the highlighted fields", { fields: { litersIssued: `Only ${Math.round(remaining * 100) / 100} L of the approved quantity remain` } });
      vehicleId = request.vehicleId;
      fuelTypeId = request.fuelTypeId;
      if (request.decidedAt && txDate.getTime() < request.decidedAt.getTime() - 60_000)
        throw badRequest("Please correct the highlighted fields", { fields: { transactionDate: "Fuel cannot be issued before the request was approved" } });
    } else {
      if (!input.remarks) throw badRequest("Please correct the highlighted fields", { fields: { remarks: "Explain why fuel is issued without an approved request" } });
      if (!vehicleId) throw badRequest("Please correct the highlighted fields", { fields: { vehicleId: "Select a vehicle" } });
    }
    const vehicle = await tx.vehicle.findUnique({ where: { id: vehicleId! } });
    if (!vehicle) throw badRequest("Please correct the highlighted fields", { fields: { vehicleId: "Vehicle not found" } });
    if (vehicle.status === "RETIRED" || vehicle.status === "INACTIVE") throw conflict(`Vehicle ${vehicle.plateNumber} is ${vehicle.status.toLowerCase()}`);
    fuelTypeId = fuelTypeId ?? vehicle.fuelTypeId;

    const t = await tx.fuelTransaction.create({
      data: {
        transactionNumber: await nextNumber(tx, "FT"),
        clientToken: input.clientToken ?? null,
        requestId: request?.id ?? null,
        transactionDate: txDate,
        vehicleId: vehicle.id,
        fuelTypeId,
        requestedLiters: request?.requestedLiters ?? null,
        approvedLiters: request?.approvedLiters ?? null,
        litersIssued: input.litersIssued,
        pricePerLiter: input.pricePerLiter,
        totalCost: computeCost(input.litersIssued, input.pricePerLiter),
        odometerReading: input.odometerReading ?? null,
        isFullTank: input.isFullTank,
        station: input.station ?? null,
        receiptNumber: input.receiptNumber ?? null,
        remarks: input.remarks ?? null,
        encodedById: user.id,
      },
    });
    await audit(tx, { userId: user.id, action: "FUEL_ISSUED", module: "FUEL_TRANSACTION", recordId: t.transactionNumber, after: snapshot(t), ip });
    if (request) {
      const s = await syncIssued(tx, request.id, user.id);
      await audit(tx, { userId: user.id, action: "REQUEST_ISSUANCE_UPDATED", module: "FUEL_REQUEST", recordId: request.requestNumber, before: { status: s.previousStatus }, after: { status: s.status, issuedLiters: s.issued } });
      await notifyUsers(tx, [request.requesterId], {
        type: "FUEL_ISSUED",
        title: `Fuel issued for ${request.requestNumber}`,
        message: `${input.litersIssued} L issued to ${vehicle.plateNumber} (${t.transactionNumber}). Request is now ${STATUS_LABELS[s.status]}.`,
        link: `/requests/${request.id}`,
      });
    }
    const log = await createOdometerLog(tx, t, user.id);
    // A back-dated entry can change estimates of later unverified records.
    await recalcVehicle(tx, vehicle.id, user.id, new Date(t.transactionDate.getTime() + 1));
    await alertForLog(tx, log, vehicle.plateNumber);
    return t;
  }, { timeout: 20000 });
  return { transaction, duplicate: false };
}

/**
 * Corrections never edit the original: a new record replaces it, the original is
 * marked SUPERSEDED (kept for history) and its odometer log is voided, preserving
 * the original actual reading.
 */
export async function correctTransaction(user: AuthUser, id: number, input: z.infer<typeof correctionInput>, ip?: string) {
  if (!can(user, "transaction.correct")) throw forbidden();
  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM fuel_transactions WHERE id = ${id} FOR UPDATE`;
    const orig = await tx.fuelTransaction.findUnique({ where: { id }, include: { odometerLog: true, vehicle: true } });
    if (!orig) throw notFound("Transaction not found");
    if (orig.status !== "ACTIVE") throw conflict("Only active transactions can be corrected");
    if (!user.roles.includes("ADMIN") && orig.encodedById !== user.id) throw forbidden("Only the encoder or an administrator can correct this transaction");
    const txDate = new Date(input.transactionDate);
    if (txDate.getTime() > Date.now() + 5 * 60_000) throw badRequest("Please correct the highlighted fields", { fields: { transactionDate: "Transaction date cannot be in the future" } });

    await tx.fuelTransaction.update({ where: { id }, data: { status: "SUPERSEDED", statusReason: input.reason } });
    const t = await tx.fuelTransaction.create({
      data: {
        transactionNumber: await nextNumber(tx, "FT"),
        requestId: orig.requestId,
        transactionDate: txDate,
        vehicleId: orig.vehicleId,
        fuelTypeId: input.fuelTypeId ?? orig.fuelTypeId,
        requestedLiters: orig.requestedLiters,
        approvedLiters: orig.approvedLiters,
        litersIssued: input.litersIssued,
        pricePerLiter: input.pricePerLiter,
        totalCost: computeCost(input.litersIssued, input.pricePerLiter),
        odometerReading: input.odometerReading ?? null,
        isFullTank: input.isFullTank,
        station: input.station ?? null,
        receiptNumber: input.receiptNumber ?? null,
        remarks: input.remarks ?? null,
        correctsId: orig.id,
        encodedById: user.id,
      },
    });
    if (orig.requestId) {
      const r = await tx.fuelRequest.findUniqueOrThrow({ where: { id: orig.requestId } });
      const others = await tx.fuelTransaction.aggregate({ where: { requestId: r.id, status: "ACTIVE", id: { not: t.id } }, _sum: { litersIssued: true } });
      if (Number(others._sum.litersIssued ?? 0) + input.litersIssued > Number(r.approvedLiters ?? 0) + 1e-9)
        throw badRequest("Please correct the highlighted fields", { fields: { litersIssued: "Corrected quantity would exceed the approved liters" } });
      await syncIssued(tx, r.id, user.id);
    }
    // Keep the original actual reading: void the old log, start the new one from the corrected value.
    const oldLog = orig.odometerLog;
    if (oldLog) await tx.odometerLog.update({ where: { id: oldLog.id }, data: { isVoided: true, remarks: `Superseded by ${t.transactionNumber}: ${input.reason}` } });
    const origActual = oldLog?.originalActualOdometer ?? oldLog?.actualOdometer ?? null;
    const changedActual = origActual !== null && Number(origActual) !== Number(input.odometerReading ?? -1);
    const log = await createOdometerLog(tx, t, user.id, { originalActualOdometer: changedActual ? origActual : null, remarks: `Correction of ${orig.transactionNumber}` });
    await audit(tx, { userId: user.id, action: "TRANSACTION_CORRECTED", module: "FUEL_TRANSACTION", recordId: orig.transactionNumber, before: snapshot(orig), after: snapshot(t), reason: input.reason, ip });
    await recalcVehicle(tx, orig.vehicleId, user.id, new Date(Math.min(orig.transactionDate.getTime(), txDate.getTime())));
    await alertForLog(tx, log, orig.vehicle.plateNumber);
    return t;
  }, { timeout: 20000 });
}

export async function voidTransaction(user: AuthUser, id: number, reason: string, ip?: string) {
  if (!can(user, "transaction.correct")) throw forbidden();
  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM fuel_transactions WHERE id = ${id} FOR UPDATE`;
    const orig = await tx.fuelTransaction.findUnique({ where: { id }, include: { odometerLog: true } });
    if (!orig) throw notFound("Transaction not found");
    if (orig.status !== "ACTIVE") throw conflict("Only active transactions can be cancelled");
    if (!user.roles.includes("ADMIN") && orig.encodedById !== user.id) throw forbidden("Only the encoder or an administrator can cancel this transaction");
    const t = await tx.fuelTransaction.update({ where: { id }, data: { status: "VOIDED", statusReason: reason } });
    if (orig.odometerLog) await tx.odometerLog.update({ where: { id: orig.odometerLog.id }, data: { isVoided: true, remarks: `Transaction cancelled: ${reason}` } });
    if (orig.requestId) await syncIssued(tx, orig.requestId, user.id);
    await audit(tx, { userId: user.id, action: "TRANSACTION_VOIDED", module: "FUEL_TRANSACTION", recordId: orig.transactionNumber, before: { status: "ACTIVE" }, after: { status: "VOIDED" }, reason, ip });
    await recalcVehicle(tx, orig.vehicleId, user.id, orig.transactionDate);
    return t;
  }, { timeout: 20000 });
}

export async function verifyTransaction(user: AuthUser, id: number, ip?: string) {
  if (!can(user, "transaction.verify")) throw forbidden();
  const settings = await getSettings(prisma);
  return prisma.$transaction(async (tx) => {
    const t = await tx.fuelTransaction.findUnique({ where: { id } });
    if (!t) throw notFound("Transaction not found");
    if (t.status !== "ACTIVE") throw conflict("Only active transactions can be verified");
    if (t.verifiedById) throw conflict("This transaction is already verified");
    if (settings["workflow.requireSeparateVerifier"] && t.encodedById === user.id) throw forbidden("The encoder cannot verify their own transaction");
    const updated = await tx.fuelTransaction.update({ where: { id }, data: { verifiedById: user.id, verifiedAt: new Date() } });
    await audit(tx, { userId: user.id, action: "TRANSACTION_VERIFIED", module: "FUEL_TRANSACTION", recordId: t.transactionNumber, after: { verifiedById: user.id }, ip });
    return updated;
  });
}
