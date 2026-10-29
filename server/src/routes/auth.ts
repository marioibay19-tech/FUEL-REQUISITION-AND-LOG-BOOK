import { Router } from "express";
import { z } from "zod";
import { prisma } from "../db.js";
import { audit } from "../lib/audit.js";
import { badRequest, HttpError, unauthorized } from "../lib/errors.js";
import { hashPassword, verifyPassword, zPassword } from "../lib/password.js";
import { ROLE_LABELS } from "../lib/permissions.js";
import { parse } from "../lib/validate.js";
import { loadUser, requireAuth, userOf } from "../middleware/auth.js";

export const authRouter = Router();

const MAX_FAILED = 5;
const LOCK_MINUTES = 15;
// Compared against when the username does not exist, so timing does not reveal valid usernames.
const DUMMY_HASH = "$2b$12$kN42J7Ez8pmCyR3FamuqeuenxfY1DpZ93ucTPgyWl7fflF3uWPUNW";

authRouter.post("/login", async (req, res) => {
  const { username, password } = parse(
    z.object({ username: z.string().trim().min(1, "Username is required").max(50), password: z.string().min(1, "Password is required").max(128) }),
    req.body,
  );
  const user = await prisma.user.findUnique({ where: { username: username.toLowerCase() } });
  const generic = new HttpError(401, "Invalid username or password", undefined, "INVALID_CREDENTIALS");
  if (!user) {
    await verifyPassword(password, DUMMY_HASH);
    await audit(prisma, { userId: null, action: "LOGIN_FAILED", module: "AUTH", recordId: username, ip: req.ip, reason: "Unknown username" });
    throw generic;
  }
  if (user.lockedUntil && user.lockedUntil > new Date()) {
    throw new HttpError(423, `Account temporarily locked after repeated failed attempts. Try again after ${LOCK_MINUTES} minutes.`, undefined, "LOCKED");
  }
  const ok = await verifyPassword(password, user.passwordHash);
  if (!ok) {
    const failed = user.failedLoginCount + 1;
    await prisma.user.update({
      where: { id: user.id },
      data: { failedLoginCount: failed, lockedUntil: failed >= MAX_FAILED ? new Date(Date.now() + LOCK_MINUTES * 60_000) : null },
    });
    await audit(prisma, { userId: user.id, action: "LOGIN_FAILED", module: "AUTH", recordId: user.id, ip: req.ip, reason: failed >= MAX_FAILED ? "Account locked" : "Wrong password" });
    throw generic;
  }
  if (!user.isActive) {
    await audit(prisma, { userId: user.id, action: "LOGIN_FAILED", module: "AUTH", recordId: user.id, ip: req.ip, reason: "Account deactivated" });
    throw new HttpError(403, "This account has been deactivated. Contact the system administrator.", undefined, "INACTIVE");
  }
  await prisma.user.update({ where: { id: user.id }, data: { failedLoginCount: 0, lockedUntil: null, lastLoginAt: new Date() } });
  await new Promise<void>((resolve, reject) => req.session.regenerate((err) => (err ? reject(err) : resolve())));
  req.session.userId = user.id;
  await audit(prisma, { userId: user.id, action: "LOGIN", module: "AUTH", recordId: user.id, ip: req.ip });
  res.json({ user: await mePayload(user.id) });
});

authRouter.post("/logout", async (req, res) => {
  if (req.user) await audit(prisma, { userId: req.user.id, action: "LOGOUT", module: "AUTH", recordId: req.user.id, ip: req.ip });
  await new Promise<void>((resolve) => req.session.destroy(() => resolve()));
  res.clearCookie("fueltrack.sid");
  res.json({ ok: true });
});

authRouter.get("/me", async (req, res) => {
  if (!req.user) throw unauthorized();
  res.json({ user: await mePayload(req.user.id) });
});

authRouter.post("/change-password", requireAuth, async (req, res) => {
  const me = userOf(req);
  const body = parse(
    z.object({ currentPassword: z.string().min(1, "Current password is required"), newPassword: zPassword }),
    req.body,
  );
  const user = await prisma.user.findUniqueOrThrow({ where: { id: me.id } });
  if (!(await verifyPassword(body.currentPassword, user.passwordHash))) throw badRequest("Please correct the highlighted fields", { fields: { currentPassword: "Current password is incorrect" } });
  if (body.currentPassword === body.newPassword) throw badRequest("Please correct the highlighted fields", { fields: { newPassword: "Choose a password different from the current one" } });
  await prisma.user.update({ where: { id: me.id }, data: { passwordHash: await hashPassword(body.newPassword), mustChangePassword: false } });
  await audit(prisma, { userId: me.id, action: "PASSWORD_CHANGED", module: "AUTH", recordId: me.id, ip: req.ip });
  res.json({ ok: true });
});

async function mePayload(id: number) {
  const u = await loadUser(id);
  if (!u) throw unauthorized();
  const office = u.officeId ? await prisma.office.findUnique({ where: { id: u.officeId } }) : null;
  return { ...u, roleLabels: u.roles.map((r) => ROLE_LABELS[r]), office: office ? { id: office.id, code: office.code, name: office.name } : null };
}
