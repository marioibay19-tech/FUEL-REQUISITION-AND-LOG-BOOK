import type { Db } from "../db.js";

export interface NotificationInput {
  type: string;
  title: string;
  message: string;
  link?: string;
}

export async function notifyUsers(db: Db, userIds: (number | null | undefined)[], n: NotificationInput) {
  const ids = [...new Set(userIds.filter((x): x is number => typeof x === "number"))];
  if (ids.length === 0) return;
  await db.notification.createMany({ data: ids.map((userId) => ({ userId, ...n })) });
}

/** Active users holding any of the roles. */
export async function usersWithRoles(db: Db, roles: ("ADMIN" | "APPROVER" | "CUSTODIAN" | "REQUESTER")[]) {
  const users = await db.user.findMany({
    where: { isActive: true, roles: { some: { role: { code: { in: roles } } } } },
    select: { id: true },
  });
  return users.map((u) => u.id);
}
