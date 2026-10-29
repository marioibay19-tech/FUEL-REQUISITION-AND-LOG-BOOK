import { Router } from "express";
import { z } from "zod";
import { prisma, type Prisma } from "../db.js";
import { audit } from "../lib/audit.js";
import { badRequest, conflict, notFound } from "../lib/errors.js";
import { hashPassword, zPassword } from "../lib/password.js";
import { ROLE_CODES, ROLE_LABELS } from "../lib/permissions.js";
import { paged, parse, zId, zListQuery, zOptId, zOptText, zRequiredText } from "../lib/validate.js";
import { requirePerm, userOf } from "../middleware/auth.js";

export const usersRouter = Router();
usersRouter.use(requirePerm("user.manage"));

const userInput = z.object({
  username: z.string().trim().toLowerCase().min(3, "Username must be at least 3 characters").max(50).regex(/^[a-z0-9._-]+$/, "Use letters, numbers, dot, dash or underscore"),
  fullName: zRequiredText(120, "Full name"),
  email: z.preprocess((v) => (v === "" ? null : v), z.string().trim().toLowerCase().email("Enter a valid email").max(150).nullable().optional()),
  position: zOptText(120),
  officeId: zOptId.optional(),
  roles: z.array(z.enum(ROLE_CODES)).min(1, "Assign at least one role"),
  isActive: z.boolean().default(true),
});

const publicUser = {
  id: true, username: true, fullName: true, email: true, position: true, officeId: true, isActive: true,
  mustChangePassword: true, lastLoginAt: true, createdAt: true, lockedUntil: true,
  office: { select: { id: true, code: true, name: true } },
  roles: { select: { role: { select: { code: true } } } },
} satisfies Prisma.UserSelect;

const shape = (u: Prisma.UserGetPayload<{ select: typeof publicUser }>) => ({ ...u, roles: u.roles.map((r) => r.role.code) });

usersRouter.get("/", async (req, res) => {
  const q = parse(zListQuery.extend({ role: z.enum(ROLE_CODES).optional(), active: z.enum(["true", "false"]).optional() }), req.query);
  const and: Prisma.UserWhereInput[] = [];
  if (q.role) and.push({ roles: { some: { role: { code: q.role } } } });
  if (q.active) and.push({ isActive: q.active === "true" });
  if (q.q) and.push({ OR: [{ username: { contains: q.q, mode: "insensitive" } }, { fullName: { contains: q.q, mode: "insensitive" } }, { email: { contains: q.q, mode: "insensitive" } }] });
  const where = { AND: and };
  const [items, total] = await Promise.all([
    prisma.user.findMany({ where, select: publicUser, orderBy: { fullName: "asc" }, skip: (q.page - 1) * q.pageSize, take: q.pageSize }),
    prisma.user.count({ where }),
  ]);
  res.json({ ...paged(items.map(shape), total, q.page, q.pageSize), roleLabels: ROLE_LABELS });
});

async function setRoles(tx: Prisma.TransactionClient, userId: number, roles: string[]) {
  const roleRows = await tx.role.findMany({ where: { code: { in: roles as never } } });
  await tx.userRole.deleteMany({ where: { userId } });
  await tx.userRole.createMany({ data: roleRows.map((r) => ({ userId, roleId: r.id })) });
}

usersRouter.post("/", async (req, res) => {
  const me = userOf(req);
  const input = parse(userInput.extend({ password: zPassword }), req.body);
  if (await prisma.user.findUnique({ where: { username: input.username } })) throw badRequest("Please correct the highlighted fields", { fields: { username: "Username is already taken" } });
  const u = await prisma.$transaction(async (tx) => {
    const { roles, password, ...data } = input;
    const u = await tx.user.create({ data: { ...data, passwordHash: await hashPassword(password), mustChangePassword: true } });
    await setRoles(tx, u.id, roles);
    await audit(tx, { userId: me.id, action: "USER_CREATED", module: "USER", recordId: u.username, after: { ...data, roles }, ip: req.ip });
    return u;
  });
  res.status(201).json(shape(await prisma.user.findUniqueOrThrow({ where: { id: u.id }, select: publicUser })));
});

usersRouter.put("/:id", async (req, res) => {
  const me = userOf(req);
  const id = parse(zId, req.params.id);
  const input = parse(userInput, req.body);
  const before = await prisma.user.findUnique({ where: { id }, select: publicUser });
  if (!before) throw notFound("User not found");
  const clash = await prisma.user.findFirst({ where: { username: input.username, id: { not: id } } });
  if (clash) throw badRequest("Please correct the highlighted fields", { fields: { username: "Username is already taken" } });
  if (id === me.id && (!input.isActive || !input.roles.includes("ADMIN"))) throw conflict("You cannot deactivate your own account or remove your own administrator role");
  if (before.roles.some((r) => r.role.code === "ADMIN") && (!input.roles.includes("ADMIN") || !input.isActive)) {
    const admins = await prisma.user.count({ where: { isActive: true, id: { not: id }, roles: { some: { role: { code: "ADMIN" } } } } });
    if (admins === 0) throw conflict("At least one active administrator is required");
  }
  await prisma.$transaction(async (tx) => {
    const { roles, ...data } = input;
    await tx.user.update({ where: { id }, data });
    await setRoles(tx, id, roles);
    const b = shape(before);
    const changes: Record<string, [unknown, unknown]> = {};
    for (const k of ["username", "fullName", "email", "position", "officeId", "isActive"] as const) if (b[k] !== data[k]) changes[k] = [b[k], data[k] ?? null];
    if (JSON.stringify([...b.roles].sort()) !== JSON.stringify([...roles].sort())) changes.roles = [b.roles, roles];
    if (Object.keys(changes).length) {
      const action = "roles" in changes ? "USER_ROLES_CHANGED" : "isActive" in changes ? (data.isActive ? "USER_ACTIVATED" : "USER_DEACTIVATED") : "USER_UPDATED";
      await audit(tx, { userId: me.id, action, module: "USER", recordId: data.username, before: Object.fromEntries(Object.entries(changes).map(([k, v]) => [k, v[0]])), after: Object.fromEntries(Object.entries(changes).map(([k, v]) => [k, v[1]])), ip: req.ip });
    }
  });
  if (!input.isActive) await prisma.session.deleteMany({ where: { sess: { path: ["userId"], equals: id } } });
  res.json(shape(await prisma.user.findUniqueOrThrow({ where: { id }, select: publicUser })));
});

usersRouter.post("/:id/reset-password", async (req, res) => {
  const me = userOf(req);
  const id = parse(zId, req.params.id);
  const { password } = parse(z.object({ password: zPassword }), req.body);
  const u = await prisma.user.update({ where: { id }, data: { passwordHash: await hashPassword(password), mustChangePassword: true, failedLoginCount: 0, lockedUntil: null } });
  await prisma.session.deleteMany({ where: { sess: { path: ["userId"], equals: id } } });
  await audit(prisma, { userId: me.id, action: "USER_PASSWORD_RESET", module: "USER", recordId: u.username, ip: req.ip });
  res.json({ ok: true });
});

usersRouter.post("/:id/unlock", async (req, res) => {
  const me = userOf(req);
  const id = parse(zId, req.params.id);
  const u = await prisma.user.update({ where: { id }, data: { failedLoginCount: 0, lockedUntil: null } });
  await audit(prisma, { userId: me.id, action: "USER_UNLOCKED", module: "USER", recordId: u.username, ip: req.ip });
  res.json({ ok: true });
});
