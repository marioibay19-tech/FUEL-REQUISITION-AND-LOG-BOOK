import { Router } from "express";
import { z } from "zod";
import { prisma, type Prisma } from "../db.js";
import { notFound } from "../lib/errors.js";
import { getSettings } from "../lib/settings.js";
import { manilaDayEnd, manilaDayStart } from "../lib/time.js";
import { paged, parse, zId, zListQuery, zRequiredText } from "../lib/validate.js";
import { can, requirePerm, userOf } from "../middleware/auth.js";
import { correctionInput, correctTransaction, issueFuel, issueInput, verifyTransaction, voidTransaction } from "../services/transactions.js";

export const transactionsRouter = Router();

const listQuery = zListQuery.extend({
  vehicleId: z.coerce.number().int().positive().optional(),
  fuelTypeId: z.coerce.number().int().positive().optional(),
  encodedById: z.coerce.number().int().positive().optional(),
  status: z.enum(["ACTIVE", "SUPERSEDED", "VOIDED", "ALL"]).default("ACTIVE"),
  verified: z.enum(["true", "false"]).optional(),
});

export function transactionWhere(q: z.infer<typeof listQuery>): Prisma.FuelTransactionWhereInput {
  const and: Prisma.FuelTransactionWhereInput[] = [];
  if (q.status !== "ALL") and.push({ status: q.status });
  if (q.vehicleId) and.push({ vehicleId: q.vehicleId });
  if (q.fuelTypeId) and.push({ fuelTypeId: q.fuelTypeId });
  if (q.encodedById) and.push({ encodedById: q.encodedById });
  if (q.verified) and.push({ verifiedById: q.verified === "true" ? { not: null } : null });
  if (q.from) and.push({ transactionDate: { gte: manilaDayStart(q.from) } });
  if (q.to) and.push({ transactionDate: { lt: manilaDayEnd(q.to) } });
  if (q.q)
    and.push({
      OR: [
        { transactionNumber: { contains: q.q, mode: "insensitive" } },
        { receiptNumber: { contains: q.q, mode: "insensitive" } },
        { station: { contains: q.q, mode: "insensitive" } },
        { vehicle: { plateNumber: { contains: q.q, mode: "insensitive" } } },
        { request: { requestNumber: { contains: q.q, mode: "insensitive" } } },
      ],
    });
  return { AND: and };
}

transactionsRouter.get("/", requirePerm("transaction.view"), async (req, res) => {
  const q = parse(listQuery, req.query);
  const where = transactionWhere(q);
  const [items, total, agg] = await Promise.all([
    prisma.fuelTransaction.findMany({
      where,
      include: {
        vehicle: { select: { id: true, plateNumber: true, description: true } },
        fuelType: { select: { id: true, name: true } },
        request: { select: { id: true, requestNumber: true } },
        encodedBy: { select: { id: true, fullName: true } },
        verifiedBy: { select: { id: true, fullName: true } },
        odometerLog: { select: { id: true, recordNumber: true, readingType: true, actualOdometer: true, estimatedOdometer: true, verificationStatus: true } },
      },
      orderBy: [{ transactionDate: "desc" }, { id: "desc" }],
      skip: (q.page - 1) * q.pageSize,
      take: q.pageSize,
    }),
    prisma.fuelTransaction.count({ where }),
    prisma.fuelTransaction.aggregate({ where, _sum: { litersIssued: true, totalCost: true } }),
  ]);
  res.json({ ...paged(items, total, q.page, q.pageSize), totals: { liters: agg._sum.litersIssued ?? 0, cost: agg._sum.totalCost ?? 0 } });
});

transactionsRouter.get("/:id", requirePerm("transaction.view"), async (req, res) => {
  const user = userOf(req);
  const id = parse(zId, req.params.id);
  const t = await prisma.fuelTransaction.findUnique({
    where: { id },
    include: {
      vehicle: { include: { fuelType: true, office: true } },
      fuelType: true,
      request: { include: { requester: { select: { fullName: true } } } },
      encodedBy: { select: { id: true, fullName: true } },
      verifiedBy: { select: { id: true, fullName: true } },
      odometerLog: true,
      corrects: { select: { id: true, transactionNumber: true } },
      correctedBy: { select: { id: true, transactionNumber: true } },
    },
  });
  if (!t) throw notFound("Transaction not found");
  const attachments = await prisma.attachment.findMany({ where: { entityType: "FUEL_TRANSACTION", entityId: id }, include: { uploadedBy: { select: { fullName: true } } } });
  const settings = await getSettings(prisma);
  const mayChange = t.status === "ACTIVE" && can(user, "transaction.correct") && (user.roles.includes("ADMIN") || t.encodedById === user.id);
  res.json({
    ...t,
    attachments,
    actions: {
      correct: mayChange,
      void: mayChange,
      verify: t.status === "ACTIVE" && !t.verifiedById && can(user, "transaction.verify") && (!settings["workflow.requireSeparateVerifier"] || t.encodedById !== user.id),
      attach: t.status === "ACTIVE" && can(user, "transaction.create"),
    },
  });
});

transactionsRouter.post("/", requirePerm("transaction.create"), async (req, res) => {
  const { transaction, duplicate } = await issueFuel(userOf(req), parse(issueInput, req.body), req.ip);
  res.status(duplicate ? 200 : 201).json({ ...transaction, duplicate });
});

transactionsRouter.post("/:id/correct", requirePerm("transaction.correct"), async (req, res) => {
  res.status(201).json(await correctTransaction(userOf(req), parse(zId, req.params.id), parse(correctionInput, req.body), req.ip));
});

transactionsRouter.post("/:id/void", requirePerm("transaction.correct"), async (req, res) => {
  const { reason } = parse(z.object({ reason: zRequiredText(1000, "Reason for cancellation") }), req.body);
  res.json(await voidTransaction(userOf(req), parse(zId, req.params.id), reason, req.ip));
});

transactionsRouter.post("/:id/verify", requirePerm("transaction.verify"), async (req, res) => {
  res.json(await verifyTransaction(userOf(req), parse(zId, req.params.id), req.ip));
});
