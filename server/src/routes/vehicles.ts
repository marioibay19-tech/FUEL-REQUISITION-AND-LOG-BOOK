import { Router } from "express";
import { z } from "zod";
import { prisma, type Prisma } from "../db.js";
import { audit, diff } from "../lib/audit.js";
import { badRequest, notFound } from "../lib/errors.js";
import { nextNumber } from "../lib/numbering.js";
import { addDays, dateOnly, manilaToday } from "../lib/time.js";
import { paged, parse, zId, zListQuery, zNonNeg, zOptDate, zOptId, zOptText, zRequiredText } from "../lib/validate.js";
import { can, requirePerm, userOf } from "../middleware/auth.js";
import { vehicleScope } from "../lib/scope.js";
import { vehicleStats } from "../services/analytics.js";
import { odometerStatus, refreshVehicleOdometer } from "../services/odometer.js";
import { visibilityWhere } from "../services/requests.js";

export const vehiclesRouter = Router();

const vehicleInput = z.object({
  plateNumber: zRequiredText(20, "Plate number").transform((s) => s.toUpperCase().replace(/\s+/g, " ")),
  propertyNumber: zOptText(40),
  description: zRequiredText(200, "Description"),
  make: zOptText(60),
  model: zOptText(60),
  year: z.preprocess((v) => (v === "" || v === null ? null : v), z.coerce.number().int().min(1950).max(2100).nullable().optional()),
  classification: zRequiredText(60, "Classification"),
  fuelTypeId: z.coerce.number({ message: "Select a fuel type" }).int().positive("Select a fuel type"),
  officeId: zOptId.optional(),
  custodianName: zOptText(120),
  custodianUserId: zOptId.optional(),
  tankCapacityLiters: z.preprocess((v) => (v === "" || v === null ? null : v), zNonNeg("Tank capacity").nullable().optional()),
  registrationExpiry: zOptDate,
  lastMaintenanceDate: zOptDate,
  nextMaintenanceDate: zOptDate,
  maintenanceNotes: zOptText(2000),
  status: z.enum(["ACTIVE", "INACTIVE", "UNDER_REPAIR", "RETIRED"]).default("ACTIVE"),
  remarks: zOptText(2000),
});
const createInput = vehicleInput.extend({ initialOdometer: zNonNeg("Current odometer reading") });

const toData = (v: z.infer<typeof vehicleInput>) => ({
  ...v,
  propertyNumber: v.propertyNumber ? v.propertyNumber.toUpperCase() : null,
  registrationExpiry: v.registrationExpiry ? dateOnly(v.registrationExpiry) : null,
  lastMaintenanceDate: v.lastMaintenanceDate ? dateOnly(v.lastMaintenanceDate) : null,
  nextMaintenanceDate: v.nextMaintenanceDate ? dateOnly(v.nextMaintenanceDate) : null,
});

async function assertUnique(plate: string, property: string | null | undefined, exceptId?: number) {
  const fields: Record<string, string> = {};
  const p = await prisma.vehicle.findFirst({ where: { plateNumber: { equals: plate, mode: "insensitive" }, ...(exceptId ? { id: { not: exceptId } } : {}) } });
  if (p) fields.plateNumber = `Plate number ${plate} is already registered`;
  if (property) {
    const q = await prisma.vehicle.findFirst({ where: { propertyNumber: { equals: property, mode: "insensitive" }, ...(exceptId ? { id: { not: exceptId } } : {}) } });
    if (q) fields.propertyNumber = `Property / equipment number ${property} is already registered`;
  }
  if (Object.keys(fields).length) throw badRequest("Please correct the highlighted fields", { fields });
}

vehiclesRouter.get("/", requirePerm("vehicle.view"), async (req, res) => {
  const user = userOf(req);
  const q = parse(zListQuery.extend({ status: z.string().optional(), officeId: z.coerce.number().int().positive().optional(), fuelTypeId: z.coerce.number().int().positive().optional() }), req.query);
  const and: Prisma.VehicleWhereInput[] = [vehicleScope(user)];
  if (q.status && ["ACTIVE", "INACTIVE", "UNDER_REPAIR", "RETIRED"].includes(q.status)) and.push({ status: q.status as "ACTIVE" });
  if (q.officeId) and.push({ officeId: q.officeId });
  if (q.fuelTypeId) and.push({ fuelTypeId: q.fuelTypeId });
  if (q.q)
    and.push({
      OR: [
        { plateNumber: { contains: q.q, mode: "insensitive" } },
        { propertyNumber: { contains: q.q, mode: "insensitive" } },
        { description: { contains: q.q, mode: "insensitive" } },
        { custodianName: { contains: q.q, mode: "insensitive" } },
      ],
    });
  const where = { AND: and };
  const [items, total] = await Promise.all([
    prisma.vehicle.findMany({ where, include: { fuelType: true, office: true }, orderBy: { plateNumber: "asc" }, skip: (q.page - 1) * q.pageSize, take: q.pageSize }),
    prisma.vehicle.count({ where }),
  ]);
  res.json(paged(items, total, q.page, q.pageSize));
});

/** Compact list for selects (request form, filters). */
vehiclesRouter.get("/options", requirePerm("vehicle.view", "report.view", "transaction.view"), async (req, res) => {
  const user = userOf(req);
  const items = await prisma.vehicle.findMany({
    where: vehicleScope(user),
    select: { id: true, plateNumber: true, description: true, status: true, fuelTypeId: true, officeId: true, classification: true },
    orderBy: { plateNumber: "asc" },
  });
  res.json(items);
});

/** Vehicle details plus latest verified / estimated odometer, used by the request form. */
vehiclesRouter.get("/:id/summary", requirePerm("vehicle.view"), async (req, res) => {
  const user = userOf(req);
  const id = parse(zId, req.params.id);
  const v = await prisma.vehicle.findFirst({ where: { AND: [{ id }, vehicleScope(user)] }, include: { fuelType: true, office: true } });
  if (!v) throw notFound("Vehicle not found");
  res.json({ ...v, odometer: await odometerStatus(prisma, id) });
});

vehiclesRouter.get("/:id", requirePerm("vehicle.view"), async (req, res) => {
  const user = userOf(req);
  const id = parse(zId, req.params.id);
  const v = await prisma.vehicle.findFirst({ where: { AND: [{ id }, vehicleScope(user)] }, include: { fuelType: true, office: true, custodianUser: { select: { id: true, fullName: true } } } });
  if (!v) throw notFound("Vehicle not found");
  const today = manilaToday();
  const [stats] = await vehicleStats({ from: addDays(today, -365), to: today }, { vehicleId: id });
  const detailed = can(user, "transaction.view");
  const [transactions, odometerLogs, requests, totals] = await Promise.all([
    detailed
      ? prisma.fuelTransaction.findMany({ where: { vehicleId: id }, include: { fuelType: true, request: { select: { id: true, requestNumber: true } }, encodedBy: { select: { fullName: true } } }, orderBy: { transactionDate: "desc" }, take: 100 })
      : [],
    can(user, "odometer.view") ? prisma.odometerLog.findMany({ where: { vehicleId: id }, orderBy: [{ readingDate: "desc" }, { id: "desc" }], take: 100 }) : [],
    prisma.fuelRequest.findMany({ where: { AND: [{ vehicleId: id }, visibilityWhere(user)] }, include: { requester: { select: { fullName: true } } }, orderBy: { createdAt: "desc" }, take: 50 }),
    detailed ? prisma.fuelTransaction.aggregate({ where: { vehicleId: id, status: "ACTIVE" }, _sum: { litersIssued: true, totalCost: true }, _count: true }) : null,
  ]);
  res.json({
    ...v,
    stats: detailed ? stats : undefined,
    lifetime: totals ? { liters: totals._sum.litersIssued ?? 0, cost: totals._sum.totalCost ?? 0, transactions: totals._count } : undefined,
    odometer: await odometerStatus(prisma, id),
    transactions,
    odometerLogs,
    requests,
  });
});

vehiclesRouter.post("/", requirePerm("vehicle.manage"), async (req, res) => {
  const user = userOf(req);
  const input = parse(createInput, req.body);
  await assertUnique(input.plateNumber, input.propertyNumber);
  const { initialOdometer, ...rest } = input;
  const v = await prisma.$transaction(async (tx) => {
    const v = await tx.vehicle.create({ data: toData(rest) });
    // The registration reading is the verified starting point for estimates.
    await tx.odometerLog.create({
      data: {
        recordNumber: await nextNumber(tx, "OD"),
        vehicleId: v.id,
        source: "INITIAL_REGISTRATION",
        readingDate: new Date(),
        actualOdometer: initialOdometer,
        actualRecordedAt: new Date(),
        readingType: "ACTUAL",
        verificationStatus: "VERIFIED",
        verifiedById: user.id,
        verifiedAt: new Date(),
        encodedById: user.id,
        estimateStatus: "NOT_APPLICABLE",
        remarks: "Odometer reading at vehicle registration",
      },
    });
    await refreshVehicleOdometer(tx, v.id);
    await audit(tx, { userId: user.id, action: "VEHICLE_CREATED", module: "VEHICLE", recordId: v.plateNumber, after: { ...rest, initialOdometer }, ip: req.ip });
    return v;
  });
  res.status(201).json(v);
});

vehiclesRouter.put("/:id", requirePerm("vehicle.manage"), async (req, res) => {
  const user = userOf(req);
  const id = parse(zId, req.params.id);
  const input = parse(vehicleInput, req.body);
  const before = await prisma.vehicle.findUnique({ where: { id } });
  if (!before) throw notFound("Vehicle not found");
  await assertUnique(input.plateNumber, input.propertyNumber, id);
  const data = toData(input);
  const v = await prisma.vehicle.update({ where: { id }, data });
  const d = diff(before as unknown as Record<string, unknown>, data as Record<string, unknown>);
  if (d.changed) await audit(prisma, { userId: user.id, action: before.status !== v.status ? "VEHICLE_STATUS_CHANGED" : "VEHICLE_UPDATED", module: "VEHICLE", recordId: v.plateNumber, before: d.before, after: d.after, ip: req.ip });
  res.json(v);
});
