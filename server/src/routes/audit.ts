import { Router } from "express";
import { z } from "zod";
import { prisma, type Prisma } from "../db.js";
import { manilaDayEnd, manilaDayStart } from "../lib/time.js";
import { paged, parse, zListQuery } from "../lib/validate.js";
import { requirePerm } from "../middleware/auth.js";

export const auditRouter = Router();
auditRouter.use(requirePerm("audit.view"));

auditRouter.get("/", async (req, res) => {
  const q = parse(zListQuery.extend({ userId: z.coerce.number().int().positive().optional(), module: z.string().max(40).optional(), action: z.string().max(60).optional() }), req.query);
  const and: Prisma.AuditLogWhereInput[] = [];
  if (q.userId) and.push({ userId: q.userId });
  if (q.module) and.push({ module: q.module });
  if (q.action) and.push({ action: q.action });
  if (q.from) and.push({ createdAt: { gte: manilaDayStart(q.from) } });
  if (q.to) and.push({ createdAt: { lt: manilaDayEnd(q.to) } });
  if (q.q) and.push({ OR: [{ recordId: { contains: q.q, mode: "insensitive" } }, { action: { contains: q.q, mode: "insensitive" } }, { reason: { contains: q.q, mode: "insensitive" } }] });
  const where = { AND: and };
  const [items, total, modules, actions] = await Promise.all([
    prisma.auditLog.findMany({ where, include: { user: { select: { id: true, fullName: true, username: true } } }, orderBy: { createdAt: "desc" }, skip: (q.page - 1) * q.pageSize, take: q.pageSize }),
    prisma.auditLog.count({ where }),
    prisma.auditLog.findMany({ distinct: ["module"], select: { module: true }, orderBy: { module: "asc" } }),
    prisma.auditLog.findMany({ distinct: ["action"], select: { action: true }, orderBy: { action: "asc" } }),
  ]);
  res.json({ ...paged(items, total, q.page, q.pageSize), modules: modules.map((m) => m.module), actions: actions.map((a) => a.action) });
});
