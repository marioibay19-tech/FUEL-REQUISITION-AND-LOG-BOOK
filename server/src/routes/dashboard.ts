import { Router } from "express";
import { z } from "zod";
import { prisma, type Prisma, type RequestStatus } from "../db.js";
import { manilaMonthKey, manilaMonthStart, manilaToday } from "../lib/time.js";
import { parse, zDate } from "../lib/validate.js";
import { can, requirePerm, userOf } from "../middleware/auth.js";
import { computeAlerts, periodRange, vehicleStats, vehiclesNeedingVerification } from "../services/analytics.js";
import { APPROVED_FAMILY, STATUS_LABELS, visibilityWhere } from "../services/requests.js";

export const dashboardRouter = Router();

const q = z.object({
  from: zDate.optional(),
  to: zDate.optional(),
  vehicleId: z.coerce.number().int().positive().optional(),
  fuelTypeId: z.coerce.number().int().positive().optional(),
  status: z.string().max(40).optional(),
});

dashboardRouter.get("/", requirePerm("dashboard.view"), async (req, res) => {
  const user = userOf(req);
  const f = parse(q, req.query);
  const from = f.from ?? manilaMonthStart();
  const to = f.to ?? manilaToday();
  const range = periodRange({ from, to });
  const fleetWide = can(user, "transaction.view");
  const status = f.status && f.status in STATUS_LABELS ? (f.status as RequestStatus) : undefined;

  const reqBase: Prisma.FuelRequestWhereInput = {
    AND: [
      visibilityWhere(user),
      { status: { not: "DRAFT" } },
      f.vehicleId ? { vehicleId: f.vehicleId } : {},
      f.fuelTypeId ? { fuelTypeId: f.fuelTypeId } : {},
    ],
  };
  const inPeriod: Prisma.FuelRequestWhereInput = { AND: [reqBase, { requestDate: { gte: new Date(`${from}T00:00:00Z`), lte: new Date(`${to}T00:00:00Z`) } }, status ? { status } : {}] };
  const txBase: Prisma.FuelTransactionWhereInput = {
    status: "ACTIVE",
    ...(f.vehicleId ? { vehicleId: f.vehicleId } : {}),
    ...(f.fuelTypeId ? { fuelTypeId: f.fuelTypeId } : {}),
    ...(status ? { request: { status } } : {}),
    ...(fleetWide ? {} : { request: { requesterId: user.id, ...(status ? { status } : {}) } }),
  };

  // 12 months ending at the end of the selected period.
  const end = new Date(`${to}T00:00:00Z`);
  const months: string[] = [];
  for (let i = 11; i >= 0; i--) months.push(new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth() - i, 1)).toISOString().slice(0, 7));
  const chartStart = `${months[0]}-01`;

  const [vehicleCount, requestsInPeriod, pending, approved, txAgg, byStatus, chartTx, recent, pendingForMe] = await Promise.all([
    prisma.vehicle.count({ where: { status: { not: "RETIRED" }, ...(f.vehicleId ? { id: f.vehicleId } : {}), ...(f.fuelTypeId ? { fuelTypeId: f.fuelTypeId } : {}) } }),
    prisma.fuelRequest.count({ where: inPeriod }),
    prisma.fuelRequest.count({ where: { AND: [reqBase, { status: "PENDING_APPROVAL" }] } }),
    prisma.fuelRequest.count({ where: { AND: [inPeriod, { status: { in: APPROVED_FAMILY } }] } }),
    prisma.fuelTransaction.aggregate({ where: { ...txBase, transactionDate: range }, _sum: { litersIssued: true, totalCost: true }, _count: true }),
    prisma.fuelRequest.groupBy({ by: ["status"], where: inPeriod, _count: true }),
    prisma.fuelTransaction.findMany({ where: { ...txBase, transactionDate: periodRange({ from: chartStart, to }) }, select: { transactionDate: true, litersIssued: true, totalCost: true, vehicleId: true, fuelType: { select: { name: true } } } }),
    prisma.fuelRequest.findMany({
      where: reqBase,
      include: { vehicle: { select: { plateNumber: true } }, requester: { select: { fullName: true } } },
      orderBy: [{ updatedAt: "desc" }],
      take: 10,
    }),
    can(user, "request.approve")
      ? prisma.fuelRequest.findMany({
          where: { status: "PENDING_APPROVAL", ...(user.roles.includes("ADMIN") ? {} : { assignedApproverId: user.id }) },
          include: { vehicle: { select: { plateNumber: true } }, requester: { select: { fullName: true } } },
          orderBy: { submittedAt: "asc" },
          take: 8,
        })
      : [],
  ]);

  const fuelNames = [...new Set(chartTx.map((t) => t.fuelType.name))].sort();
  const monthly = months.map((m) => {
    const row: Record<string, number | string> = { month: m, liters: 0, cost: 0 };
    for (const n of fuelNames) row[n] = 0;
    for (const t of chartTx)
      if (manilaMonthKey(t.transactionDate) === m) {
        row.liters = Math.round((Number(row.liters) + Number(t.litersIssued)) * 100) / 100;
        row.cost = Math.round((Number(row.cost) + Number(t.totalCost)) * 100) / 100;
        row[t.fuelType.name] = Math.round((Number(row[t.fuelType.name]) + Number(t.litersIssued)) * 100) / 100;
      }
    return row;
  });

  let byVehicle: { plateNumber: string; liters: number; cost: number }[] = [];
  let efficiency: { plateNumber: string; efficiency: number; quality: string }[] = [];
  let alerts: Awaited<ReturnType<typeof computeAlerts>> = [];
  let verification: Awaited<ReturnType<typeof vehiclesNeedingVerification>> = [];
  if (fleetWide || can(user, "monitoring.view")) {
    const stats = await vehicleStats({ from, to }, { vehicleId: f.vehicleId, fuelTypeId: f.fuelTypeId });
    byVehicle = stats.filter((s) => s.totalIssued > 0).sort((a, b) => b.totalIssued - a.totalIssued).slice(0, 10).map((s) => ({ plateNumber: s.plateNumber, liters: s.totalIssued, cost: s.totalExpenditure }));
    efficiency = stats
      .filter((s) => s.historicalEfficiency !== null)
      .sort((a, b) => (b.historicalEfficiency ?? 0) - (a.historicalEfficiency ?? 0))
      .slice(0, 12)
      .map((s) => ({ plateNumber: s.plateNumber, efficiency: s.historicalEfficiency!, quality: s.historicalEfficiencyQuality ?? "ESTIMATED" }));
    alerts = await computeAlerts({ from, to }, { vehicleId: f.vehicleId });
    verification = await vehiclesNeedingVerification(undefined, { vehicleId: f.vehicleId });
  }
  const highConsumptionVehicles = new Set(alerts.filter((a) => a.type === "HIGH_CONSUMPTION").map((a) => a.vehicleId)).size;

  res.json({
    period: { from, to },
    scope: fleetWide ? "fleet" : "own",
    cards: {
      vehicles: vehicleCount,
      requestsInPeriod,
      pending,
      approved,
      litersIssued: Number(txAgg._sum.litersIssued ?? 0),
      expenditure: Number(txAgg._sum.totalCost ?? 0),
      transactions: txAgg._count,
      needsVerification: fleetWide || can(user, "monitoring.view") ? verification.length : null,
      highConsumption: fleetWide || can(user, "monitoring.view") ? highConsumptionVehicles : null,
    },
    charts: {
      monthly,
      fuelNames,
      byVehicle,
      byStatus: byStatus.map((s) => ({ status: s.status, label: STATUS_LABELS[s.status], count: s._count })),
      efficiency,
    },
    recent: recent.map((r) => ({ id: r.id, requestNumber: r.requestNumber, requestDate: r.requestDate, plateNumber: r.vehicle.plateNumber, requester: r.requester.fullName, requestedLiters: r.requestedLiters, status: r.status })),
    pendingForMe: pendingForMe.map((r) => ({ id: r.id, requestNumber: r.requestNumber, submittedAt: r.submittedAt, plateNumber: r.vehicle.plateNumber, requester: r.requester.fullName, requestedLiters: r.requestedLiters, flagged: r.flaggedForReview })),
    alerts: alerts.slice(0, 8),
    alertCount: alerts.length,
    verification: verification.slice(0, 8),
  });
});
