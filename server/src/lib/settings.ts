import { z } from "zod";
import type { Db } from "../db.js";

// Every configurable rule, with its default, type and description. Admins
// change these on the System Settings page; values are validated here.
export const SETTING_DEFS = {
  "org.agency": { group: "Organization", label: "Agency name (report header)", schema: z.string().min(1).max(150), default: "Department of Public Works and Highways" },
  "org.office": { group: "Organization", label: "Office name (report header)", schema: z.string().min(1).max(150), default: "Regional Office I — Equipment Management Division" },
  "org.address": { group: "Organization", label: "Office address", schema: z.string().max(200), default: "Aguila Road, Sevilla, San Fernando City, La Union" },

  "workflow.allowSelfApproval": { group: "Workflow", label: "Allow approving officers to approve their own requests", schema: z.boolean(), default: false },
  "workflow.allowFuelTypeOverride": { group: "Workflow", label: "Allow a fuel type different from the vehicle's registered fuel type (with reason)", schema: z.boolean(), default: true },
  "workflow.requireRequestAttachment": { group: "Workflow", label: "Require a supporting document when submitting a request", schema: z.boolean(), default: false },
  "workflow.requireReceiptForIssuance": { group: "Workflow", label: "Require a receipt / document number when recording issuance", schema: z.boolean(), default: false },
  "workflow.duplicateWindowHours": { group: "Workflow", label: "Flag requests for the same vehicle submitted within (hours)", schema: z.number().int().min(0).max(720), default: 24 },
  "workflow.maxFuelingDaysAhead": { group: "Workflow", label: "Latest intended fueling date allowed (days from today)", schema: z.number().int().min(1).max(365), default: 60 },
  "workflow.requireSeparateVerifier": { group: "Workflow", label: "Verifier must be a different person from the encoder", schema: z.boolean(), default: true },

  "odometer.estimateMethod": {
    group: "Odometer estimation",
    label: "Reference fuel-efficiency method",
    schema: z.enum(["LAST_INTERVAL", "ROLLING_AVERAGE", "APPROVED_REFERENCE"]),
    default: "ROLLING_AVERAGE",
    options: { LAST_INTERVAL: "Most recent verified interval", ROLLING_AVERAGE: "Rolling average of recent verified intervals", APPROVED_REFERENCE: "Reference approved per vehicle" },
  },
  "odometer.consumptionBasis": {
    group: "Odometer estimation",
    label: "Fuel consumption basis",
    schema: z.enum(["FULL_TANK", "ISSUANCE"]),
    default: "FULL_TANK",
    options: { FULL_TANK: "Full tank to full tank (refill = fuel used since last reading)", ISSUANCE: "Issuance-based (fuel issued is used before the next reading; always an estimate)" },
  },
  "odometer.rollingWindow": { group: "Odometer estimation", label: "Intervals in the rolling average", schema: z.number().int().min(1).max(24), default: 3 },
  "odometer.variancePctThreshold": { group: "Odometer estimation", label: "Flag actual vs. estimated difference above (% of estimated distance)", schema: z.number().min(1).max(500), default: 25 },
  "odometer.verificationDays": { group: "Odometer estimation", label: "Vehicle needs odometer verification if no verified reading for (days)", schema: z.number().int().min(1).max(365), default: 30 },

  "alerts.highConsumptionPct": { group: "Alerts", label: "Efficiency below the vehicle's own baseline by more than (%)", schema: z.number().min(1).max(100), default: 25 },
  "alerts.classDeviationPct": { group: "Alerts", label: "Efficiency below the median of the same vehicle classification by more than (%)", schema: z.number().min(1).max(100), default: 35 },
  "alerts.efficiencyChangePct": { group: "Alerts", label: "Change between consecutive intervals above (%)", schema: z.number().min(1).max(200), default: 30 },
  "alerts.minIntervals": { group: "Alerts", label: "Minimum verified intervals before consumption alerts are raised", schema: z.number().int().min(1).max(20), default: 3 },
  "alerts.duplicateTxHours": { group: "Alerts", label: "Possible duplicate: same vehicle and liters within (hours)", schema: z.number().int().min(1).max(168), default: 12 },
  "alerts.frequentRequestCount": { group: "Alerts", label: "Frequent requests: more than this many requests…", schema: z.number().int().min(1).max(100), default: 4 },
  "alerts.frequentRequestDays": { group: "Alerts", label: "…within this many days", schema: z.number().int().min(1).max(90), default: 7 },
} as const;

export type SettingKey = keyof typeof SETTING_DEFS;
export type Settings = { [K in SettingKey]: z.infer<(typeof SETTING_DEFS)[K]["schema"]> };

export async function getSettings(db: Db): Promise<Settings> {
  const rows = await db.systemSetting.findMany();
  const map = new Map(rows.map((r) => [r.key, r.value]));
  const out: Record<string, unknown> = {};
  for (const [key, def] of Object.entries(SETTING_DEFS)) {
    const parsed = def.schema.safeParse(map.get(key));
    out[key] = parsed.success ? parsed.data : def.default;
  }
  return out as Settings;
}

export function validateSetting(key: string, value: unknown): { ok: true; value: unknown } | { ok: false; error: string } {
  const def = (SETTING_DEFS as Record<string, { schema: z.ZodType }>)[key];
  if (!def) return { ok: false, error: `Unknown setting ${key}` };
  const r = def.schema.safeParse(value);
  return r.success ? { ok: true, value: r.data } : { ok: false, error: r.error.issues[0]?.message ?? "Invalid value" };
}
