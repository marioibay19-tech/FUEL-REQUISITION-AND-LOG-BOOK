import type { Db } from "../db.js";
import { manilaToday } from "./time.js";

/**
 * Atomically allocate the next number in a yearly sequence, e.g. FR-2026-000001.
 * Uses INSERT … ON CONFLICT so concurrent requests never get the same number.
 */
export async function nextNumber(db: Db, prefix: "FR" | "FT" | "OD"): Promise<string> {
  const year = manilaToday().slice(0, 4);
  const name = `${prefix}-${year}`;
  const rows = await db.$queryRaw<{ value: number }[]>`
    INSERT INTO number_sequences (name, value) VALUES (${name}, 1)
    ON CONFLICT (name) DO UPDATE SET value = number_sequences.value + 1
    RETURNING value`;
  return `${name}-${String(rows[0].value).padStart(6, "0")}`;
}
