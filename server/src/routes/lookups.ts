import { Router } from "express";
import { z } from "zod";
import { prisma } from "../db.js";
import { audit, diff } from "../lib/audit.js";
import { badRequest, notFound } from "../lib/errors.js";
import { ROLE_LABELS } from "../lib/permissions.js";
import { parse, zId, zNonNeg, zOptId, zRequiredText } from "../lib/validate.js";
import { requirePerm, userOf } from "../middleware/auth.js";

export const lookupsRouter = Router();

lookupsRouter.get("/fuel-types", async (_req, res) => {
  res.json(await prisma.fuelType.findMany({ orderBy: { name: "asc" } }));
});
lookupsRouter.get("/offices", async (_req, res) => {
  res.json(await prisma.office.findMany({ include: { defaultApprover: { select: { id: true, fullName: true } } }, orderBy: { name: "asc" } }));
});
lookupsRouter.get("/roles", async (_req, res) => {
  res.json(Object.entries(ROLE_LABELS).map(([code, name]) => ({ code, name })));
});
/** People lists for filters (encoders, requesters, approving officers). */
lookupsRouter.get("/people", requirePerm("report.view", "transaction.view", "audit.view", "user.manage"), async (_req, res) => {
  const users = await prisma.user.findMany({ select: { id: true, fullName: true, isActive: true, roles: { select: { role: { select: { code: true } } } } }, orderBy: { fullName: "asc" } });
  res.json(users.map((u) => ({ id: u.id, fullName: u.fullName, isActive: u.isActive, roles: u.roles.map((r) => r.role.code) })));
});

const fuelTypeInput = z.object({
  code: zRequiredText(20, "Code").transform((s) => s.toUpperCase()),
  name: zRequiredText(60, "Name"),
  defaultPricePerLiter: zNonNeg("Default price per liter"),
  active: z.boolean().default(true),
});
lookupsRouter.post("/fuel-types", requirePerm("settings.manage"), async (req, res) => {
  const input = parse(fuelTypeInput, req.body);
  const ft = await prisma.fuelType.create({ data: input });
  await audit(prisma, { userId: userOf(req).id, action: "FUEL_TYPE_CREATED", module: "SETTINGS", recordId: ft.code, after: input, ip: req.ip });
  res.status(201).json(ft);
});
lookupsRouter.put("/fuel-types/:id", requirePerm("settings.manage"), async (req, res) => {
  const id = parse(zId, req.params.id);
  const input = parse(fuelTypeInput, req.body);
  const before = await prisma.fuelType.findUnique({ where: { id } });
  if (!before) throw notFound();
  const ft = await prisma.fuelType.update({ where: { id }, data: input });
  const d = diff({ ...before, defaultPricePerLiter: Number(before.defaultPricePerLiter) } as Record<string, unknown>, input);
  if (d.changed) await audit(prisma, { userId: userOf(req).id, action: "FUEL_TYPE_UPDATED", module: "SETTINGS", recordId: ft.code, before: d.before, after: d.after, ip: req.ip });
  res.json(ft);
});

const officeInput = z.object({
  code: zRequiredText(20, "Code").transform((s) => s.toUpperCase()),
  name: zRequiredText(150, "Name"),
  defaultApproverId: zOptId.optional(),
  active: z.boolean().default(true),
});
async function checkApprover(id: number | null | undefined) {
  if (!id) return;
  const ok = await prisma.user.findFirst({ where: { id, isActive: true, roles: { some: { role: { code: "APPROVER" } } } } });
  if (!ok) throw badRequest("Please correct the highlighted fields", { fields: { defaultApproverId: "Select an active approving officer" } });
}
lookupsRouter.post("/offices", requirePerm("settings.manage"), async (req, res) => {
  const input = parse(officeInput, req.body);
  await checkApprover(input.defaultApproverId);
  const o = await prisma.office.create({ data: input });
  await audit(prisma, { userId: userOf(req).id, action: "OFFICE_CREATED", module: "SETTINGS", recordId: o.code, after: input, ip: req.ip });
  res.status(201).json(o);
});
lookupsRouter.put("/offices/:id", requirePerm("settings.manage"), async (req, res) => {
  const id = parse(zId, req.params.id);
  const input = parse(officeInput, req.body);
  await checkApprover(input.defaultApproverId);
  const before = await prisma.office.findUnique({ where: { id } });
  if (!before) throw notFound();
  const o = await prisma.office.update({ where: { id }, data: input });
  const d = diff(before as unknown as Record<string, unknown>, input);
  if (d.changed) await audit(prisma, { userId: userOf(req).id, action: "OFFICE_UPDATED", module: "SETTINGS", recordId: o.code, before: d.before, after: d.after, ip: req.ip });
  res.json(o);
});
