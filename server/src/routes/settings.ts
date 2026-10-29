import { Router } from "express";
import { z } from "zod";
import { prisma } from "../db.js";
import { audit } from "../lib/audit.js";
import { badRequest } from "../lib/errors.js";
import { getSettings, SETTING_DEFS, validateSetting } from "../lib/settings.js";
import { parse } from "../lib/validate.js";
import { requirePerm, userOf } from "../middleware/auth.js";

export const settingsRouter = Router();

settingsRouter.get("/", requirePerm("settings.manage"), async (_req, res) => {
  const values = await getSettings(prisma);
  res.json(
    Object.entries(SETTING_DEFS).map(([key, def]) => ({
      key,
      group: def.group,
      label: def.label,
      value: values[key as keyof typeof values],
      default: def.default,
      type: typeof def.default === "boolean" ? "boolean" : typeof def.default === "number" ? "number" : "options" in def ? "select" : "text",
      options: "options" in def ? def.options : undefined,
    })),
  );
});

settingsRouter.put("/", requirePerm("settings.manage"), async (req, res) => {
  const me = userOf(req);
  const { values, reason } = parse(z.object({ values: z.record(z.string(), z.unknown()), reason: z.string().trim().max(500).optional() }), req.body);
  const current = await getSettings(prisma);
  const fields: Record<string, string> = {};
  const changes: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(values)) {
    const r = validateSetting(k, v);
    if (!r.ok) fields[k] = r.error;
    else if (JSON.stringify(current[k as keyof typeof current]) !== JSON.stringify(r.value)) changes[k] = r.value;
  }
  if (Object.keys(fields).length) throw badRequest("Please correct the highlighted fields", { fields });
  const estimationChanged = Object.keys(changes).some((k) => k.startsWith("odometer."));
  if (estimationChanged && !reason) throw badRequest("Please correct the highlighted fields", { fields: { reason: "Give the reason for changing the estimation method" } });
  await prisma.$transaction(async (tx) => {
    for (const [key, value] of Object.entries(changes)) {
      await tx.systemSetting.upsert({ where: { key }, update: { value: value as never, updatedById: me.id }, create: { key, value: value as never, updatedById: me.id } });
    }
    if (Object.keys(changes).length)
      await audit(tx, {
        userId: me.id,
        action: "SETTINGS_UPDATED",
        module: "SETTINGS",
        recordId: "system_settings",
        before: Object.fromEntries(Object.keys(changes).map((k) => [k, current[k as keyof typeof current]])),
        after: changes,
        reason: reason ?? null,
        ip: req.ip,
      });
  });
  res.json({ updated: Object.keys(changes) });
});
