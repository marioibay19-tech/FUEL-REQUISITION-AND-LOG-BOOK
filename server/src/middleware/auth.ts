import type { NextFunction, Request, Response } from "express";
import { prisma } from "../db.js";
import { forbidden, unauthorized } from "../lib/errors.js";
import { permissionsFor, type Permission, type Role } from "../lib/permissions.js";

export interface AuthUser {
  id: number;
  username: string;
  fullName: string;
  officeId: number | null;
  position: string | null;
  roles: Role[];
  permissions: Permission[];
  mustChangePassword: boolean;
}

declare module "express-session" {
  interface SessionData {
    userId?: number;
  }
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: AuthUser;
    }
  }
}

export async function loadUser(userId: number): Promise<AuthUser | null> {
  const u = await prisma.user.findUnique({
    where: { id: userId },
    include: { roles: { include: { role: true } } },
  });
  if (!u || !u.isActive) return null;
  const roles = u.roles.map((r) => r.role.code as Role);
  return {
    id: u.id,
    username: u.username,
    fullName: u.fullName,
    officeId: u.officeId,
    position: u.position,
    roles,
    permissions: permissionsFor(roles),
    mustChangePassword: u.mustChangePassword,
  };
}

/** Attach the signed-in user (re-read every request so deactivation and role changes apply at once). */
export async function attachUser(req: Request, _res: Response, next: NextFunction) {
  if (req.session?.userId) {
    const user = await loadUser(req.session.userId);
    if (user) req.user = user;
    else delete req.session.userId;
  }
  next();
}

export function requireAuth(req: Request, _res: Response, next: NextFunction) {
  if (!req.user) return next(unauthorized());
  next();
}

export const can = (user: AuthUser | undefined, p: Permission) => !!user && user.permissions.includes(p);

/** Require at least one of the permissions. */
export function requirePerm(...perms: Permission[]) {
  return (req: Request, _res: Response, next: NextFunction) => {
    if (!req.user) return next(unauthorized());
    if (!perms.some((p) => req.user!.permissions.includes(p))) return next(forbidden());
    next();
  };
}

export const userOf = (req: Request): AuthUser => {
  if (!req.user) throw unauthorized();
  return req.user;
};
