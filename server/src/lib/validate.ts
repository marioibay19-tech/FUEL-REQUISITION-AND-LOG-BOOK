import { z } from "zod";
import { badRequest } from "./errors.js";

export function parse<T extends z.ZodType>(schema: T, data: unknown): z.infer<T> {
  const r = schema.safeParse(data);
  if (!r.success) {
    const fields: Record<string, string> = {};
    for (const issue of r.error.issues) {
      const key = issue.path.join(".") || "_";
      if (!fields[key]) fields[key] = issue.message;
    }
    throw badRequest("Please correct the highlighted fields", { fields });
  }
  return r.data;
}

const trimmed = z.string().trim();
export const zText = (max: number) => trimmed.max(max);
export const zRequiredText = (max: number, label = "This field") => trimmed.min(1, `${label} is required`).max(max);
export const zOptText = (max: number) =>
  z.preprocess((v) => (typeof v === "string" && v.trim() === "" ? null : v), trimmed.max(max).nullable().optional());
export const zDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use a valid date (YYYY-MM-DD)").refine((s) => !isNaN(Date.parse(s)), "Invalid date");
export const zOptDate = z.preprocess((v) => (v === "" ? null : v), zDate.nullable().optional());
export const zId = z.coerce.number().int().positive();
export const zOptId = z.preprocess((v) => (v === "" || v === null || v === undefined ? null : v), z.coerce.number().int().positive().nullable());
export const zPositive = (label: string) =>
  z.coerce.number({ message: `${label} must be a number` }).refine(Number.isFinite, `${label} must be a number`).gt(0, `${label} must be greater than zero`);
export const zNonNeg = (label: string) =>
  z.coerce.number({ message: `${label} must be a number` }).refine(Number.isFinite, `${label} must be a number`).min(0, `${label} cannot be negative`);
export const zOptNonNeg = (label: string) => z.preprocess((v) => (v === "" || v === null || v === undefined ? null : v), zNonNeg(label).nullable());

/** Common list query: page, pageSize, q, from, to. */
export const zListQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(20),
  q: z.string().trim().max(100).optional(),
  from: zDate.optional(),
  to: zDate.optional(),
});

export function paged<T>(items: T[], total: number, page: number, pageSize: number) {
  return { items, total, page, pageSize, pages: Math.max(1, Math.ceil(total / pageSize)) };
}
