// Dates: timestamps are stored in UTC and displayed in Asia/Manila (UTC+8, no DST).
// Date-only fields (request date, travel date) are stored as calendar dates.
const MANILA_OFFSET_MS = 8 * 60 * 60 * 1000;

/** Today's calendar date in Manila as YYYY-MM-DD. */
export function manilaToday(now = new Date()): string {
  return new Date(now.getTime() + MANILA_OFFSET_MS).toISOString().slice(0, 10);
}

/** Parse a YYYY-MM-DD calendar date into a Date at UTC midnight (for @db.Date columns). */
export function dateOnly(s: string): Date {
  return new Date(`${s}T00:00:00.000Z`);
}

/** Start of a Manila calendar day as a UTC instant. */
export function manilaDayStart(s: string): Date {
  return new Date(new Date(`${s}T00:00:00.000Z`).getTime() - MANILA_OFFSET_MS);
}

/** End (exclusive) of a Manila calendar day as a UTC instant. */
export function manilaDayEnd(s: string): Date {
  return new Date(manilaDayStart(s).getTime() + 24 * 60 * 60 * 1000);
}

export function addDays(s: string, days: number): string {
  const d = dateOnly(s);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export function manilaMonthStart(now = new Date()): string {
  return manilaToday(now).slice(0, 8) + "01";
}

/** YYYY-MM for a timestamp, in Manila time. */
export function manilaMonthKey(d: Date): string {
  return new Date(d.getTime() + MANILA_OFFSET_MS).toISOString().slice(0, 7);
}

export function formatManila(d: Date | null | undefined, withTime = true): string {
  if (!d) return "";
  return new Intl.DateTimeFormat("en-PH", {
    timeZone: "Asia/Manila",
    year: "numeric",
    month: "short",
    day: "2-digit",
    ...(withTime ? { hour: "2-digit", minute: "2-digit", hour12: true } : {}),
  }).format(d);
}

export function formatDateOnly(d: Date | null | undefined): string {
  if (!d) return "";
  return new Intl.DateTimeFormat("en-PH", { timeZone: "UTC", year: "numeric", month: "short", day: "2-digit" }).format(d);
}
