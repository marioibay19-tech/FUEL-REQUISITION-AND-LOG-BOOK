const TZ = "Asia/Manila";

export const peso = (v: number | string | null | undefined) =>
  v === null || v === undefined || v === "" ? "—" : new Intl.NumberFormat("en-PH", { style: "currency", currency: "PHP" }).format(Number(v));

export const num = (v: number | string | null | undefined, dp = 2) =>
  v === null || v === undefined || v === "" ? "—" : new Intl.NumberFormat("en-PH", { minimumFractionDigits: 0, maximumFractionDigits: dp }).format(Number(v));

export const liters = (v: number | string | null | undefined) => (v === null || v === undefined ? "—" : `${new Intl.NumberFormat("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Number(v))} L`);
export const km = (v: number | string | null | undefined) => (v === null || v === undefined ? "—" : `${new Intl.NumberFormat("en-PH", { maximumFractionDigits: 1 }).format(Number(v))} km`);
export const kmpl = (v: number | string | null | undefined) => (v === null || v === undefined ? "—" : `${new Intl.NumberFormat("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Number(v))} km/L`);

/** Timestamp in Manila time. */
export function dateTime(v: string | Date | null | undefined) {
  if (!v) return "—";
  return new Intl.DateTimeFormat("en-PH", { timeZone: TZ, year: "numeric", month: "short", day: "2-digit", hour: "numeric", minute: "2-digit" }).format(new Date(v));
}
export function dateManila(v: string | Date | null | undefined) {
  if (!v) return "—";
  return new Intl.DateTimeFormat("en-PH", { timeZone: TZ, year: "numeric", month: "short", day: "2-digit" }).format(new Date(v));
}
/** Calendar date stored as a date-only value (UTC midnight). */
export function dateOnly(v: string | Date | null | undefined) {
  if (!v) return "—";
  return new Intl.DateTimeFormat("en-PH", { timeZone: "UTC", year: "numeric", month: "short", day: "2-digit" }).format(new Date(v));
}
export const isoDate = (v: string | null | undefined) => (v ? v.slice(0, 10) : "");

/** Today's date in Manila (YYYY-MM-DD). */
export const manilaToday = () => new Date(Date.now() + 8 * 3600_000).toISOString().slice(0, 10);
export const manilaMonthStart = () => manilaToday().slice(0, 8) + "01";
export const addDays = (d: string, n: number) => new Date(Date.parse(`${d}T00:00:00Z`) + n * 86400_000).toISOString().slice(0, 10);

/** Value for <input type="datetime-local"> in Manila time, and back to an ISO instant. */
export const toManilaLocalInput = (d: Date) => new Date(d.getTime() + 8 * 3600_000).toISOString().slice(0, 16);
export const fromManilaLocalInput = (s: string) => new Date(`${s}:00+08:00`).toISOString();

export const monthLabel = (k: string) => new Date(`${k}-01T00:00:00Z`).toLocaleString("en-US", { month: "short", year: "2-digit", timeZone: "UTC" });

export const humanize = (s: string | null | undefined) => (s ? s.replaceAll("_", " ").toLowerCase().replace(/^./, (c) => c.toUpperCase()) : "");

export const uid = () => (crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`);
