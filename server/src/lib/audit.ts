import type { Db } from "../db.js";

export interface AuditEntry {
  userId: number | null;
  action: string;
  module: string;
  recordId?: string | number | null;
  before?: unknown;
  after?: unknown;
  reason?: string | null;
  ip?: string | null;
}

const toJson = (v: unknown) =>
  v === undefined || v === null ? undefined : JSON.parse(JSON.stringify(v, (_k, val) => (typeof val === "bigint" ? val.toString() : val)));

/** Append an audit record. Audit records are append-only (enforced by a DB trigger). */
export async function audit(db: Db, e: AuditEntry) {
  await db.auditLog.create({
    data: {
      userId: e.userId,
      action: e.action,
      module: e.module,
      recordId: e.recordId == null ? null : String(e.recordId),
      before: toJson(e.before),
      after: toJson(e.after),
      reason: e.reason ?? null,
      ipAddress: e.ip ?? null,
    },
  });
}

/** Keep only the fields that changed, for before/after audit details. */
export function diff<T extends Record<string, unknown>>(before: T, after: Partial<T>) {
  const b: Record<string, unknown> = {};
  const a: Record<string, unknown> = {};
  for (const key of Object.keys(after)) {
    const bv = JSON.stringify(before[key] ?? null);
    const av = JSON.stringify(after[key] ?? null);
    if (bv !== av) {
      b[key] = before[key] ?? null;
      a[key] = after[key] ?? null;
    }
  }
  return { before: b, after: a, changed: Object.keys(a).length > 0 };
}
