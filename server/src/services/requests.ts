import { z } from "zod";
import { prisma, type Db, type FuelRequest, type Prisma, type RequestStatus } from "../db.js";
import { audit, diff } from "../lib/audit.js";
import { computeCost } from "../lib/calc.js";
import { badRequest, conflict, forbidden, notFound } from "../lib/errors.js";
import { notifyUsers, usersWithRoles } from "../lib/notify.js";
import { nextNumber } from "../lib/numbering.js";
import { getSettings } from "../lib/settings.js";
import { addDays, dateOnly, manilaToday } from "../lib/time.js";
import { zOptDate, zOptId, zOptText, zPositive, zNonNeg, zRequiredText } from "../lib/validate.js";
import { can, type AuthUser } from "../middleware/auth.js";
import { vehicleScope } from "../lib/scope.js";
import { odometerStatus } from "./odometer.js";

export const STATUS_LABELS: Record<RequestStatus, string> = {
  DRAFT: "Draft",
  PENDING_APPROVAL: "Pending Approval",
  APPROVED: "Approved",
  REJECTED: "Rejected",
  RETURNED: "Returned for Revision",
  READY_FOR_ISSUANCE: "Ready for Issuance",
  PARTIALLY_ISSUED: "Partially Issued",
  FULLY_ISSUED: "Fully Issued",
  CANCELLED: "Cancelled",
};

export const ISSUABLE: RequestStatus[] = ["APPROVED", "READY_FOR_ISSUANCE", "PARTIALLY_ISSUED"];
export const APPROVED_FAMILY: RequestStatus[] = ["APPROVED", "READY_FOR_ISSUANCE", "PARTIALLY_ISSUED", "FULLY_ISSUED"];
const OPEN: RequestStatus[] = ["PENDING_APPROVAL", "APPROVED", "READY_FOR_ISSUANCE", "PARTIALLY_ISSUED"];

export const requestInput = z.object({
  clientToken: z.string().trim().min(8).max(64).optional(),
  officeId: zOptId.optional(),
  purpose: zRequiredText(500, "Purpose of request"),
  destination: zOptText(300),
  travelDate: zOptDate,
  remarks: zOptText(2000),
  vehicleId: z.coerce.number({ message: "Select a vehicle" }).int().positive("Select a vehicle"),
  fuelTypeId: z.coerce.number({ message: "Select a fuel type" }).int().positive("Select a fuel type"),
  fuelTypeOverride: z.boolean().optional().default(false),
  overrideReason: zOptText(300),
  requestedLiters: zPositive("Requested liters"),
  estimatedPricePerLiter: zNonNeg("Estimated price per liter"),
  intendedFuelingDate: zOptDate,
  reason: zOptText(500),
});
export type RequestInput = z.infer<typeof requestInput>;

/** Prisma filter for the requests a user may see. Drafts are only visible to their owner. */
export function visibilityWhere(user: AuthUser): Prisma.FuelRequestWhereInput {
  const own: Prisma.FuelRequestWhereInput = { requesterId: user.id };
  const notDraft: Prisma.FuelRequestWhereInput = { status: { not: "DRAFT" } };
  if (can(user, "request.view_all")) return { OR: [own, notDraft] };
  const or: Prisma.FuelRequestWhereInput[] = [own];
  if (can(user, "request.view_assigned")) or.push({ assignedApproverId: user.id, ...notDraft });
  if (can(user, "request.view_issuable")) or.push({ status: { in: [...APPROVED_FAMILY] } });
  return { OR: or };
}

export async function getVisibleRequest(user: AuthUser, id: number) {
  const r = await prisma.fuelRequest.findFirst({ where: { AND: [{ id }, visibilityWhere(user)] } });
  if (!r) throw notFound("Fuel request not found");
  return r;
}

function snapshot(r: FuelRequest) {
  return {
    status: r.status,
    vehicleId: r.vehicleId,
    fuelTypeId: r.fuelTypeId,
    requestedLiters: Number(r.requestedLiters),
    approvedLiters: r.approvedLiters === null ? null : Number(r.approvedLiters),
    estimatedPricePerLiter: Number(r.estimatedPricePerLiter),
    estimatedTotalCost: Number(r.estimatedTotalCost),
    purpose: r.purpose,
    destination: r.destination,
    travelDate: r.travelDate,
    intendedFuelingDate: r.intendedFuelingDate,
    officeId: r.officeId,
    reason: r.reason,
    remarks: r.remarks,
    fuelTypeOverride: r.fuelTypeOverride,
    overrideReason: r.overrideReason,
  };
}

async function buildData(db: Db, user: AuthUser, input: RequestInput) {
  const vehicle = await db.vehicle.findFirst({ where: { AND: [{ id: input.vehicleId }, vehicleScope(user)] } });
  if (!vehicle) throw badRequest("Please correct the highlighted fields", { fields: { vehicleId: "Vehicle not found" } });
  const fuelType = await db.fuelType.findUnique({ where: { id: input.fuelTypeId } });
  if (!fuelType || !fuelType.active) throw badRequest("Please correct the highlighted fields", { fields: { fuelTypeId: "Fuel type not available" } });
  const status = await odometerStatus(db, vehicle.id);
  const total = computeCost(input.requestedLiters, input.estimatedPricePerLiter);
  return {
    officeId: input.officeId ?? user.officeId ?? vehicle.officeId ?? null,
    purpose: input.purpose,
    destination: input.destination ?? null,
    travelDate: input.travelDate ? dateOnly(input.travelDate) : null,
    remarks: input.remarks ?? null,
    vehicleId: vehicle.id,
    fuelTypeId: fuelType.id,
    fuelTypeOverride: fuelType.id !== vehicle.fuelTypeId,
    overrideReason: fuelType.id !== vehicle.fuelTypeId ? (input.overrideReason ?? null) : null,
    requestedLiters: input.requestedLiters,
    estimatedPricePerLiter: input.estimatedPricePerLiter,
    estimatedTotalCost: total,
    intendedFuelingDate: input.intendedFuelingDate ? dateOnly(input.intendedFuelingDate) : null,
    reason: input.reason ?? null,
    odometerAtRequest: status.latestVerified?.odometer ?? null,
  };
}

async function syncItem(db: Db, r: FuelRequest) {
  await db.fuelRequestItem.deleteMany({ where: { requestId: r.id } });
  await db.fuelRequestItem.create({
    data: { requestId: r.id, fuelTypeId: r.fuelTypeId, liters: r.requestedLiters, pricePerLiter: r.estimatedPricePerLiter, lineTotal: r.estimatedTotalCost },
  });
}

/** Create a draft. A repeated clientToken returns the existing request instead of a duplicate. */
export async function createDraft(user: AuthUser, input: RequestInput, ip?: string) {
  if (input.clientToken) {
    const existing = await prisma.fuelRequest.findUnique({ where: { clientToken: input.clientToken } });
    if (existing) {
      if (existing.requesterId !== user.id) throw conflict("Duplicate form token");
      return { request: existing, duplicate: true };
    }
  }
  const request = await prisma.$transaction(async (tx) => {
    const data = await buildData(tx, user, input);
    const r = await tx.fuelRequest.create({
      data: {
        ...data,
        clientToken: input.clientToken ?? null,
        requestNumber: await nextNumber(tx, "FR"),
        requestDate: dateOnly(manilaToday()),
        requesterId: user.id,
        status: "DRAFT",
      },
    });
    await syncItem(tx, r);
    await audit(tx, { userId: user.id, action: "REQUEST_CREATED", module: "FUEL_REQUEST", recordId: r.requestNumber, after: snapshot(r), ip });
    return r;
  });
  return { request, duplicate: false };
}

export async function updateDraft(user: AuthUser, id: number, input: RequestInput, ip?: string) {
  return prisma.$transaction(async (tx) => {
    const r = await tx.fuelRequest.findUnique({ where: { id } });
    if (!r || r.requesterId !== user.id) throw notFound("Fuel request not found");
    if (r.status !== "DRAFT" && r.status !== "RETURNED") throw conflict(`A request that is ${STATUS_LABELS[r.status]} can no longer be edited`);
    const data = await buildData(tx, user, input);
    const updated = await tx.fuelRequest.update({ where: { id }, data });
    await syncItem(tx, updated);
    const d = diff(snapshot(r), snapshot(updated));
    if (d.changed) await audit(tx, { userId: user.id, action: "REQUEST_MODIFIED", module: "FUEL_REQUEST", recordId: r.requestNumber, before: d.before, after: d.after, ip });
    return updated;
  });
}

async function chooseApprover(db: Db, r: FuelRequest): Promise<number | null> {
  const isApprover = { isActive: true, roles: { some: { role: { code: "APPROVER" as const } } } };
  if (r.officeId) {
    const office = await db.office.findUnique({ where: { id: r.officeId }, include: { defaultApprover: { include: { roles: { include: { role: true } } } } } });
    const a = office?.defaultApprover;
    if (a && a.isActive && a.id !== r.requesterId && a.roles.some((x) => x.role.code === "APPROVER")) return a.id;
  }
  // Otherwise: the active approving officer (other than the requester) with the fewest pending requests.
  const candidates = await db.user.findMany({
    where: { ...isApprover, id: { not: r.requesterId } },
    select: { id: true, officeId: true, _count: { select: { assignedRequests: { where: { status: "PENDING_APPROVAL" } } } } },
  });
  candidates.sort((a, b) => Number(b.officeId === r.officeId) - Number(a.officeId === r.officeId) || a._count.assignedRequests - b._count.assignedRequests || a.id - b.id);
  return candidates[0]?.id ?? null;
}

/** Full validation, duplicate screening, approver assignment and status change to Pending Approval. */
export async function submitRequest(user: AuthUser, id: number, ip?: string) {
  const result = await prisma.$transaction(async (tx) => {
    // Row lock so two clicks cannot submit the same request twice.
    await tx.$queryRaw`SELECT id FROM fuel_requests WHERE id = ${id} FOR UPDATE`;
    const r = await tx.fuelRequest.findUnique({ where: { id }, include: { vehicle: true } });
    if (!r || r.requesterId !== user.id) throw notFound("Fuel request not found");
    if (r.status === "PENDING_APPROVAL") throw conflict("This request has already been submitted", { requestNumber: r.requestNumber });
    if (r.status !== "DRAFT" && r.status !== "RETURNED") throw conflict(`A request that is ${STATUS_LABELS[r.status]} cannot be submitted`);
    const settings = await getSettings(tx);
    const fields: Record<string, string> = {};
    const today = manilaToday();

    if (r.vehicle.status !== "ACTIVE") fields.vehicleId = `Vehicle ${r.vehicle.plateNumber} is not active (${r.vehicle.status.replace("_", " ").toLowerCase()})`;
    if (r.fuelTypeId !== r.vehicle.fuelTypeId) {
      if (!settings["workflow.allowFuelTypeOverride"]) fields.fuelTypeId = "Fuel type must match the vehicle's registered fuel type";
      else if (!r.overrideReason) fields.overrideReason = "Give the reason for using a different fuel type";
    }
    if (!(Number(r.requestedLiters) > 0)) fields.requestedLiters = "Requested liters must be greater than zero";
    if (r.vehicle.tankCapacityLiters && Number(r.requestedLiters) > Number(r.vehicle.tankCapacityLiters) * 1.5)
      fields.requestedLiters = `Requested liters exceed the vehicle's tank capacity (${Number(r.vehicle.tankCapacityLiters)} L) by more than 50%`;
    if (!r.intendedFuelingDate) fields.intendedFuelingDate = "Intended fueling date is required";
    else {
      const d = r.intendedFuelingDate.toISOString().slice(0, 10);
      if (d < today) fields.intendedFuelingDate = "Intended fueling date cannot be in the past";
      else if (d > addDays(today, settings["workflow.maxFuelingDaysAhead"])) fields.intendedFuelingDate = `Intended fueling date must be within ${settings["workflow.maxFuelingDaysAhead"]} days`;
    }
    if (r.travelDate && r.travelDate.toISOString().slice(0, 10) < today) fields.travelDate = "Date of intended travel cannot be in the past";
    if (!r.officeId) fields.officeId = "Office or division is required";
    if (settings["workflow.requireRequestAttachment"]) {
      const n = await tx.attachment.count({ where: { entityType: "FUEL_REQUEST", entityId: r.id } });
      if (n === 0) fields.attachments = "A supporting document is required by office policy";
    }
    if (Object.keys(fields).length) throw badRequest("The request cannot be submitted yet", { fields });

    // Duplicate / suspicious screening: flagged for the approving officer, not blocked.
    const flags: string[] = [];
    const windowStart = new Date(Date.now() - settings["workflow.duplicateWindowHours"] * 3600_000);
    const recent = await tx.fuelRequest.findMany({
      where: { id: { not: r.id }, vehicleId: r.vehicleId, status: { in: OPEN }, submittedAt: { gte: windowStart } },
      select: { requestNumber: true, requesterId: true, requestedLiters: true },
    });
    for (const o of recent) {
      if (o.requesterId === r.requesterId && Number(o.requestedLiters) === Number(r.requestedLiters))
        flags.push(`Possible duplicate of ${o.requestNumber} (same requester, vehicle and quantity)`);
      else flags.push(`Another open request for this vehicle (${o.requestNumber}) was submitted within ${settings["workflow.duplicateWindowHours"]} hours`);
    }
    if (r.vehicle.tankCapacityLiters && Number(r.requestedLiters) > Number(r.vehicle.tankCapacityLiters))
      flags.push(`Requested liters exceed tank capacity (${Number(r.vehicle.tankCapacityLiters)} L)`);
    const freqStart = new Date(Date.now() - settings["alerts.frequentRequestDays"] * 86400_000);
    const freq = await tx.fuelRequest.count({ where: { vehicleId: r.vehicleId, id: { not: r.id }, submittedAt: { gte: freqStart }, status: { not: "CANCELLED" } } });
    if (freq >= settings["alerts.frequentRequestCount"]) flags.push(`${freq} other requests for this vehicle in the last ${settings["alerts.frequentRequestDays"]} days`);
    if (r.fuelTypeOverride) flags.push("Fuel type differs from the vehicle's registered fuel type");

    const approverId = await chooseApprover(tx, r);
    const updated = await tx.fuelRequest.update({
      where: { id },
      data: {
        status: "PENDING_APPROVAL",
        requestDate: dateOnly(today),
        submittedAt: new Date(),
        assignedApproverId: approverId,
        flaggedForReview: flags.length > 0,
        flagReasons: flags,
      },
    });
    const action = r.status === "RETURNED" ? "RESUBMIT" : "SUBMIT";
    await tx.fuelApproval.create({ data: { requestId: id, action, previousStatus: r.status, newStatus: "PENDING_APPROVAL", actedById: user.id, remarks: flags.length ? `Flagged for review: ${flags.join("; ")}` : null } });
    await audit(tx, { userId: user.id, action: action === "SUBMIT" ? "REQUEST_SUBMITTED" : "REQUEST_RESUBMITTED", module: "FUEL_REQUEST", recordId: r.requestNumber, before: { status: r.status }, after: { status: "PENDING_APPROVAL", assignedApproverId: approverId, flags }, ip });
    const link = `/requests/${id}`;
    await notifyUsers(tx, [user.id], { type: "REQUEST_SUBMITTED", title: `Request ${r.requestNumber} submitted`, message: `Your fuel request for ${r.vehicle.plateNumber} is pending approval.`, link });
    const approvers = approverId ? [approverId] : await usersWithRoles(tx, ["ADMIN"]);
    await notifyUsers(tx, approvers, {
      type: "PENDING_APPROVAL",
      title: `Request ${r.requestNumber} awaits approval`,
      message: `${user.fullName} requested ${Number(r.requestedLiters)} L for ${r.vehicle.plateNumber}.${flags.length ? " Flagged for review." : ""}`,
      link,
    });
    return updated;
  });
  return result;
}

type Decision = "APPROVE" | "REJECT" | "RETURN";

export const decisionInput = z.object({
  action: z.enum(["APPROVE", "REJECT", "RETURN"]),
  approvedLiters: z.preprocess((v) => (v === "" || v === null ? undefined : v), zPositive("Approved liters").optional()),
  remarks: zOptText(2000),
  reason: zOptText(2000),
});

export async function decide(user: AuthUser, id: number, input: z.infer<typeof decisionInput>, ip?: string) {
  if (!can(user, "request.approve")) throw forbidden();
  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM fuel_requests WHERE id = ${id} FOR UPDATE`;
    const r = await tx.fuelRequest.findUnique({ where: { id }, include: { vehicle: true } });
    if (!r || r.status === "DRAFT") throw notFound("Fuel request not found");
    if (r.status !== "PENDING_APPROVAL") throw conflict(`This request is already ${STATUS_LABELS[r.status]}`);
    const isAdmin = user.roles.includes("ADMIN");
    if (r.assignedApproverId !== user.id && !isAdmin) throw forbidden("This request is assigned to another approving officer");
    const settings = await getSettings(tx);
    if (r.requesterId === user.id && !settings["workflow.allowSelfApproval"]) throw forbidden("You cannot act on your own fuel request");

    const action = input.action as Decision;
    if ((action === "REJECT" || action === "RETURN") && !input.reason)
      throw badRequest("Please correct the highlighted fields", { fields: { reason: action === "REJECT" ? "Give the reason for rejection" : "Explain what needs to be revised" } });
    let approvedLiters: number | null = null;
    if (action === "APPROVE") {
      approvedLiters = input.approvedLiters ?? Number(r.requestedLiters);
      if (approvedLiters > Number(r.requestedLiters))
        throw badRequest("Please correct the highlighted fields", { fields: { approvedLiters: "Approved liters cannot exceed the requested liters" } });
    }
    const newStatus: RequestStatus = action === "APPROVE" ? "APPROVED" : action === "REJECT" ? "REJECTED" : "RETURNED";
    const updated = await tx.fuelRequest.update({
      where: { id },
      data: { status: newStatus, approvedLiters: approvedLiters ?? undefined, decidedAt: new Date() },
    });
    await tx.fuelApproval.create({
      data: { requestId: id, action, previousStatus: r.status, newStatus, actedById: user.id, remarks: input.remarks ?? null, reason: input.reason ?? null, approvedLiters },
    });
    await audit(tx, {
      userId: user.id,
      action: `REQUEST_${action === "APPROVE" ? "APPROVED" : action === "REJECT" ? "REJECTED" : "RETURNED"}`,
      module: "FUEL_REQUEST",
      recordId: r.requestNumber,
      before: { status: r.status },
      after: { status: newStatus, approvedLiters },
      reason: input.reason ?? input.remarks ?? null,
      ip,
    });
    const link = `/requests/${id}`;
    const msg =
      action === "APPROVE"
        ? `Approved for ${approvedLiters} L. Fuel will be recorded as issued once dispensed.`
        : action === "REJECT"
          ? `Rejected: ${input.reason}`
          : `Returned for revision: ${input.reason}`;
    await notifyUsers(tx, [r.requesterId], {
      type: action === "APPROVE" ? "REQUEST_APPROVED" : action === "REJECT" ? "REQUEST_REJECTED" : "REQUEST_RETURNED",
      title: `Request ${r.requestNumber} ${action === "APPROVE" ? "approved" : action === "REJECT" ? "rejected" : "returned for revision"}`,
      message: msg,
      link,
    });
    if (action === "APPROVE") {
      await notifyUsers(tx, await usersWithRoles(tx, ["CUSTODIAN"]), {
        type: "READY_FOR_ISSUANCE",
        title: `Request ${r.requestNumber} approved for issuance`,
        message: `${approvedLiters} L for ${r.vehicle.plateNumber} can now be issued.`,
        link,
      });
    }
    return updated;
  });
}

export async function markReady(user: AuthUser, id: number, remarks: string | null, ip?: string) {
  if (!can(user, "transaction.create")) throw forbidden();
  return prisma.$transaction(async (tx) => {
    const r = await tx.fuelRequest.findUnique({ where: { id } });
    if (!r) throw notFound("Fuel request not found");
    if (r.status !== "APPROVED") throw conflict(`Only approved requests can be marked ready (this one is ${STATUS_LABELS[r.status]})`);
    const updated = await tx.fuelRequest.update({ where: { id }, data: { status: "READY_FOR_ISSUANCE" } });
    await tx.fuelApproval.create({ data: { requestId: id, action: "READY", previousStatus: r.status, newStatus: "READY_FOR_ISSUANCE", actedById: user.id, remarks } });
    await audit(tx, { userId: user.id, action: "REQUEST_READY_FOR_ISSUANCE", module: "FUEL_REQUEST", recordId: r.requestNumber, before: { status: r.status }, after: { status: "READY_FOR_ISSUANCE" }, ip });
    await notifyUsers(tx, [r.requesterId], { type: "READY_FOR_ISSUANCE", title: `Request ${r.requestNumber} is ready for issuance`, message: remarks ?? "Proceed to the fuel custodian.", link: `/requests/${id}` });
    return updated;
  });
}

export async function cancelRequest(user: AuthUser, id: number, reason: string | null, ip?: string) {
  return prisma.$transaction(async (tx) => {
    const r = await tx.fuelRequest.findUnique({ where: { id } });
    if (!r) throw notFound("Fuel request not found");
    const owner = r.requesterId === user.id;
    if (!owner && !can(user, "request.cancel_any")) throw forbidden("Only the requester or an administrator can cancel this request");
    if (!owner && r.status === "DRAFT") throw notFound("Fuel request not found");
    const cancellable: RequestStatus[] = ["DRAFT", "PENDING_APPROVAL", "RETURNED", "APPROVED", "READY_FOR_ISSUANCE"];
    if (!cancellable.includes(r.status)) throw conflict(`A request that is ${STATUS_LABELS[r.status]} cannot be cancelled`);
    if (Number(r.issuedLiters) > 0) throw conflict("Fuel has already been issued against this request");
    if (r.status !== "DRAFT" && !reason) throw badRequest("Please correct the highlighted fields", { fields: { reason: "Give the reason for cancelling" } });
    const updated = await tx.fuelRequest.update({ where: { id }, data: { status: "CANCELLED" } });
    await tx.fuelApproval.create({ data: { requestId: id, action: "CANCEL", previousStatus: r.status, newStatus: "CANCELLED", actedById: user.id, reason } });
    await audit(tx, { userId: user.id, action: "REQUEST_CANCELLED", module: "FUEL_REQUEST", recordId: r.requestNumber, before: { status: r.status }, after: { status: "CANCELLED" }, reason, ip });
    if (!owner) await notifyUsers(tx, [r.requesterId], { type: "REQUEST_CANCELLED", title: `Request ${r.requestNumber} cancelled`, message: reason ?? "", link: `/requests/${id}` });
    return updated;
  });
}

export async function reassign(user: AuthUser, id: number, approverId: number, ip?: string) {
  if (!user.roles.includes("ADMIN")) throw forbidden();
  return prisma.$transaction(async (tx) => {
    const r = await tx.fuelRequest.findUnique({ where: { id } });
    if (!r) throw notFound("Fuel request not found");
    if (r.status !== "PENDING_APPROVAL") throw conflict("Only pending requests can be reassigned");
    const a = await tx.user.findFirst({ where: { id: approverId, isActive: true, roles: { some: { role: { code: "APPROVER" } } } } });
    if (!a) throw badRequest("Please correct the highlighted fields", { fields: { approverId: "Select an active approving officer" } });
    if (a.id === r.requesterId) throw badRequest("Please correct the highlighted fields", { fields: { approverId: "The requester cannot approve their own request" } });
    const updated = await tx.fuelRequest.update({ where: { id }, data: { assignedApproverId: a.id } });
    await tx.fuelApproval.create({ data: { requestId: id, action: "REASSIGN", previousStatus: r.status, newStatus: r.status, actedById: user.id, remarks: `Assigned to ${a.fullName}` } });
    await audit(tx, { userId: user.id, action: "REQUEST_REASSIGNED", module: "FUEL_REQUEST", recordId: r.requestNumber, before: { assignedApproverId: r.assignedApproverId }, after: { assignedApproverId: a.id }, ip });
    await notifyUsers(tx, [a.id], { type: "PENDING_APPROVAL", title: `Request ${r.requestNumber} awaits approval`, message: "A fuel request was assigned to you.", link: `/requests/${id}` });
    return updated;
  });
}

/** Recompute issued liters and status from ACTIVE transactions (after issuance, correction or void). */
export async function syncIssued(db: Db, requestId: number, userId: number) {
  const r = await db.fuelRequest.findUniqueOrThrow({ where: { id: requestId } });
  const agg = await db.fuelTransaction.aggregate({ where: { requestId, status: "ACTIVE" }, _sum: { litersIssued: true } });
  const issued = Number(agg._sum.litersIssued ?? 0);
  const approved = Number(r.approvedLiters ?? 0);
  let status: RequestStatus = r.status;
  if (issued <= 0) status = r.status === "PARTIALLY_ISSUED" || r.status === "FULLY_ISSUED" ? "APPROVED" : r.status;
  else if (issued + 1e-9 >= approved) status = "FULLY_ISSUED";
  else status = "PARTIALLY_ISSUED";
  if (status !== r.status || issued !== Number(r.issuedLiters)) {
    await db.fuelRequest.update({ where: { id: requestId }, data: { issuedLiters: issued, status } });
    if (status !== r.status) {
      await db.fuelApproval.create({ data: { requestId, action: "ISSUE", previousStatus: r.status, newStatus: status, actedById: userId, remarks: `Issued ${issued} of ${approved} L` } });
    }
  }
  return { issued, status, previousStatus: r.status };
}
