import { Router } from "express";
import { prisma } from "../db.js";
import { parse, zId } from "../lib/validate.js";
import { userOf } from "../middleware/auth.js";

export const notificationsRouter = Router();

notificationsRouter.get("/", async (req, res) => {
  const me = userOf(req);
  const [items, unread] = await Promise.all([
    prisma.notification.findMany({ where: { userId: me.id }, orderBy: { createdAt: "desc" }, take: 30 }),
    prisma.notification.count({ where: { userId: me.id, readAt: null } }),
  ]);
  res.json({ items, unread });
});
notificationsRouter.post("/read-all", async (req, res) => {
  const me = userOf(req);
  const r = await prisma.notification.updateMany({ where: { userId: me.id, readAt: null }, data: { readAt: new Date() } });
  res.json({ updated: r.count });
});
notificationsRouter.post("/:id/read", async (req, res) => {
  const me = userOf(req);
  const r = await prisma.notification.updateMany({ where: { id: parse(zId, req.params.id), userId: me.id, readAt: null }, data: { readAt: new Date() } });
  res.json({ updated: r.count });
});
