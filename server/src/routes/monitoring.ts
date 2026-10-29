import { Router } from "express";
import { z } from "zod";
import { prisma } from "../db.js";
import { getSettings } from "../lib/settings.js";
import { manilaMonthStart, manilaToday } from "../lib/time.js";
import { parse, zDate } from "../lib/validate.js";
import { requirePerm } from "../middleware/auth.js";
import { ALERT_LABELS, computeAlerts, vehicleStats, vehiclesNeedingVerification } from "../services/analytics.js";

export const monitoringRouter = Router();
monitoringRouter.use(requirePerm("monitoring.view"));

const q = z.object({
  from: zDate.optional(),
  to: zDate.optional(),
  vehicleId: z.coerce.number().int().positive().optional(),
  fuelTypeId: z.coerce.number().int().positive().optional(),
  officeId: z.coerce.number().int().positive().optional(),
});

monitoringRouter.get("/vehicles", async (req, res) => {
  const f = parse(q, req.query);
  const from = f.from ?? manilaMonthStart();
  const to = f.to ?? manilaToday();
  res.json({ period: { from, to }, rows: await vehicleStats({ from, to }, f) });
});

monitoringRouter.get("/alerts", async (req, res) => {
  const f = parse(q, req.query);
  const from = f.from ?? manilaMonthStart();
  const to = f.to ?? manilaToday();
  const settings = await getSettings(prisma);
  const alerts = await computeAlerts({ from, to }, { vehicleId: f.vehicleId }, settings);
  const thresholds = Object.fromEntries(Object.entries(settings).filter(([k]) => k.startsWith("alerts.")));
  res.json({ period: { from, to }, alerts, labels: ALERT_LABELS, thresholds, verification: await vehiclesNeedingVerification(settings, { vehicleId: f.vehicleId }) });
});
