import { Router } from "express";
import { z } from "zod";
import { prisma, type Prisma, type RequestStatus } from "../db.js";
import { notFound } from "../lib/errors.js";
import { getSettings } from "../lib/settings.js";
import { manilaToday } from "../lib/time.js";
import { paged, parse, zId, zListQuery, zOptText } from "../lib/validate.js";
import { can, requirePerm, userOf } from "../middleware/auth.js";
import { odometerStatus } from "../services/odometer.js";
import {
  cancelRequest,
  createDraft,
  decide,
  decisionInput,
  getVisibleRequest,
  markReady,
  reassign,
  requestInput,
  STATUS_LABELS,
  submitRequest,
  updateDraft,
  visibilityWhere,
} from "../services/requests.js";

export const requestsRouter = Router();
const viewPerms = ["request.view_own", "request.view_all", "request.view_assigned", "request.view_issuable"] as const;

const listQuery = zListQuery.extend({
  status: z.string().max(200).optional(), // comma-separated
  vehicleId: z.coerce.number().int().positive().optional(),
  scope: z.enum(["all", "mine", "assigned", "issuable"]).default("all"),
  flagged: z.enum(["true", "false"]).optional(),
});

requestsRouter.get("/", requirePerm(...viewPerms), async (req, res) => {
  const user = userOf(req);
  const q = parse(listQuery, req.query);
  const and: Prisma.FuelRequestWhereInput[] = [visibilityWhere(user)];
  if (q.scope === "mine") and.push({ requesterId: user.id });
  if (q.scope === "assigned") and.push({ assignedApproverId: user.id, status: "PENDING_APPROVAL" });
  if (q.scope === "issuable") and.push({ status: { in: ["APPROVED", "READY_FOR_ISSUANCE", "PARTIALLY_ISSUED"] } });
  if (q.status) {
    const st = q.status.split(",").filter((s) => s in STATUS_LABELS) as RequestStatus[];
    if (st.length) and.push({ status: { in: st } });
  }
  if (q.vehicleId) and.push({ vehicleId: q.vehicleId });
  if (q.flagged) and.push({ flaggedForReview: q.flagged === "true" });
  if (q.from) and.push({ requestDate: { gte: new Date(`${q.from}T00:00:00Z`) } });
  if (q.to) and.push({ requestDate: { lte: new Date(`${q.to}T00:00:00Z`) } });
  if (q.q)
    and.push({
      OR: [
        { requestNumber: { contains: q.q, mode: "insensitive" } },
        { purpose: { contains: q.q, mode: "insensitive" } },
        { vehicle: { plateNumber: { contains: q.q, mode: "insensitive" } } },
        { requester: { fullName: { contains: q.q, mode: "insensitive" } } },
      ],
    });
  const where = { AND: and };
  const [items, total] = await Promise.all([
    prisma.fuelRequest.findMany({
      where,
      include: {
        vehicle: { select: { id: true, plateNumber: true, description: true } },
        requester: { select: { id: true, fullName: true } },
        fuelType: { select: { id: true, name: true } },
        office: { select: { id: true, code: true, name: true } },
        assignedApprover: { select: { id: true, fullName: true } },
      },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      skip: (q.page - 1) * q.pageSize,
      take: q.pageSize,
    }),
    prisma.fuelRequest.count({ where }),
  ]);
  res.json(paged(items, total, q.page, q.pageSize));
});

/** Form helper: today's date and the next-number format, so the form can show them before saving. */
requestsRouter.get("/meta/form", requirePerm("request.create"), async (_req, res) => {
  const settings = await getSettings(prisma);
  res.json({
    today: manilaToday(),
    maxFuelingDaysAhead: settings["workflow.maxFuelingDaysAhead"],
    allowFuelTypeOverride: settings["workflow.allowFuelTypeOverride"],
    requireAttachment: settings["workflow.requireRequestAttachment"],
  });
});

requestsRouter.get("/:id", requirePerm(...viewPerms), async (req, res) => {
  const user = userOf(req);
  const id = parse(zId, req.params.id);
  await getVisibleRequest(user, id);
  const r = await prisma.fuelRequest.findUniqueOrThrow({
    where: { id },
    include: {
      vehicle: { include: { fuelType: true, office: true } },
      requester: { select: { id: true, fullName: true, position: true } },
      fuelType: true,
      office: true,
      assignedApprover: { select: { id: true, fullName: true, position: true } },
      approvals: { include: { actedBy: { select: { id: true, fullName: true } } }, orderBy: { createdAt: "asc" } },
      transactions: { include: { encodedBy: { select: { fullName: true } } }, orderBy: { transactionDate: "asc" } },
      items: true,
    },
  });
  const attachments = await prisma.attachment.findMany({ where: { entityType: "FUEL_REQUEST", entityId: id }, omit: { content: true }, include: { uploadedBy: { select: { fullName: true } } } });
  const settings = await getSettings(prisma);
  const isOwner = r.requesterId === user.id;
  const actions = {
    edit: isOwner && (r.status === "DRAFT" || r.status === "RETURNED"),
    submit: isOwner && (r.status === "DRAFT" || r.status === "RETURNED"),
    decide:
      r.status === "PENDING_APPROVAL" &&
      can(user, "request.approve") &&
      (r.assignedApproverId === user.id || user.roles.includes("ADMIN")) &&
      (!isOwner || settings["workflow.allowSelfApproval"]),
    markReady: r.status === "APPROVED" && can(user, "transaction.create"),
    issue: ["APPROVED", "READY_FOR_ISSUANCE", "PARTIALLY_ISSUED"].includes(r.status) && can(user, "transaction.create"),
    cancel:
      (isOwner || can(user, "request.cancel_any")) &&
      ["DRAFT", "PENDING_APPROVAL", "RETURNED", "APPROVED", "READY_FOR_ISSUANCE"].includes(r.status) &&
      Number(r.issuedLiters) === 0,
    reassign: r.status === "PENDING_APPROVAL" && user.roles.includes("ADMIN"),
  };
  res.json({ ...r, attachments, actions, odometer: await odometerStatus(prisma, r.vehicleId) });
});

requestsRouter.post("/", requirePerm("request.create"), async (req, res) => {
  const user = userOf(req);
  const input = parse(requestInput, req.body);
  const { request, duplicate } = await createDraft(user, input, req.ip);
  res.status(duplicate ? 200 : 201).json({ ...request, duplicate });
});

requestsRouter.put("/:id", requirePerm("request.create"), async (req, res) => {
  const user = userOf(req);
  const r = await updateDraft(user, parse(zId, req.params.id), parse(requestInput, req.body), req.ip);
  res.json(r);
});

requestsRouter.post("/:id/submit", requirePerm("request.create"), async (req, res) => {
  res.json(await submitRequest(userOf(req), parse(zId, req.params.id), req.ip));
});

requestsRouter.post("/:id/decision", requirePerm("request.approve"), async (req, res) => {
  res.json(await decide(userOf(req), parse(zId, req.params.id), parse(decisionInput, req.body), req.ip));
});

requestsRouter.post("/:id/ready", requirePerm("transaction.create"), async (req, res) => {
  const { remarks } = parse(z.object({ remarks: zOptText(1000) }), req.body ?? {});
  res.json(await markReady(userOf(req), parse(zId, req.params.id), remarks ?? null, req.ip));
});

requestsRouter.post("/:id/cancel", requirePerm(...viewPerms), async (req, res) => {
  const { reason } = parse(z.object({ reason: zOptText(1000) }), req.body ?? {});
  const user = userOf(req);
  const id = parse(zId, req.params.id);
  const r = await prisma.fuelRequest.findUnique({ where: { id } });
  if (!r || (r.status === "DRAFT" && r.requesterId !== user.id)) throw notFound("Fuel request not found");
  res.json(await cancelRequest(user, id, reason ?? null, req.ip));
});

requestsRouter.post("/:id/reassign", requirePerm("user.manage"), async (req, res) => {
  const { approverId } = parse(z.object({ approverId: zId }), req.body);
  res.json(await reassign(userOf(req), parse(zId, req.params.id), approverId, req.ip));
});
