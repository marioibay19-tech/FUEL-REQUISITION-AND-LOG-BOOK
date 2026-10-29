import { z } from "zod";
import { prisma, type Prisma, type RequestStatus } from "../db.js";
import { forbidden } from "../lib/errors.js";
import type { Column, ReportData } from "../lib/export.js";
import { getSettings } from "../lib/settings.js";
import { formatDateOnly, manilaMonthKey, manilaMonthStart, manilaToday } from "../lib/time.js";
import { zDate } from "../lib/validate.js";
import { can, type AuthUser } from "../middleware/auth.js";
import { periodRange, vehicleStats } from "./analytics.js";
import { APPROVED_FAMILY, STATUS_LABELS } from "./requests.js";

export const reportFilters = z.object({
  from: zDate.optional(),
  to: zDate.optional(),
  vehicleId: z.coerce.number().int().positive().optional(),
  fuelTypeId: z.coerce.number().int().positive().optional(),
  officeId: z.coerce.number().int().positive().optional(),
  requesterId: z.coerce.number().int().positive().optional(),
  status: z.string().max(40).optional(),
  readingType: z.enum(["ACTUAL", "ESTIMATED"]).optional(),
});
export type ReportFilters = z.infer<typeof reportFilters>;

export const REPORTS: { key: string; title: string; group: string; filters: string[]; permission?: "audit.view" }[] = [
  { key: "request-summary", title: "Fuel Request Summary", group: "Requests", filters: ["vehicle", "fuelType", "office", "requester", "requestStatus"] },
  { key: "approved-requests", title: "Approved Fuel Requests", group: "Requests", filters: ["vehicle", "fuelType", "office", "requester"] },
  { key: "rejected-cancelled", title: "Rejected and Cancelled Requests", group: "Requests", filters: ["vehicle", "fuelType", "office", "requester"] },
  { key: "pending-requests", title: "Pending Fuel Requests", group: "Requests", filters: ["vehicle", "fuelType", "office", "requester"] },
  { key: "issuance", title: "Fuel Issuance Transaction Report", group: "Issuance", filters: ["vehicle", "fuelType", "office", "txStatus"] },
  { key: "monthly-consumption", title: "Monthly Fuel Consumption Report", group: "Issuance", filters: ["vehicle", "fuelType", "office"] },
  { key: "monthly-expenditure", title: "Monthly Fuel Expenditure Report", group: "Issuance", filters: ["vehicle", "fuelType", "office"] },
  { key: "by-fuel-type", title: "Fuel Transactions by Fuel Type", group: "Issuance", filters: ["vehicle", "office"] },
  { key: "by-office", title: "Fuel Consumption by Office or Division", group: "Issuance", filters: ["vehicle", "fuelType"] },
  { key: "vehicle-consumption", title: "Vehicle Fuel Consumption Report", group: "Vehicles", filters: ["vehicle", "fuelType", "office"] },
  { key: "vehicle-efficiency", title: "Vehicle Fuel Efficiency Report", group: "Vehicles", filters: ["vehicle", "fuelType", "office"] },
  { key: "odometer-monitoring", title: "Odometer Monitoring Report", group: "Odometer", filters: ["vehicle", "office", "readingType", "verification"] },
  { key: "actual-vs-estimated", title: "Actual versus Estimated Odometer Report", group: "Odometer", filters: ["vehicle", "office"] },
  { key: "audit-trail", title: "Audit Trail Report", group: "Administration", filters: ["requester"], permission: "audit.view" },
];

const n = (v: unknown) => (v === null || v === undefined ? null : Number(v));
const sumOf = (rows: Record<string, unknown>[], key: string) => Math.round(rows.reduce((s, r) => s + (Number(r[key]) || 0), 0) * 100) / 100;

function requestWhere(f: ReportFilters, statuses?: RequestStatus[]): Prisma.FuelRequestWhereInput {
  const st = statuses ?? (f.status && f.status in STATUS_LABELS ? [f.status as RequestStatus] : undefined);
  return {
    requestDate: { gte: new Date(`${f.from}T00:00:00Z`), lte: new Date(`${f.to}T00:00:00Z`) },
    status: st ? { in: st } : { not: "DRAFT" },
    ...(f.vehicleId ? { vehicleId: f.vehicleId } : {}),
    ...(f.fuelTypeId ? { fuelTypeId: f.fuelTypeId } : {}),
    ...(f.officeId ? { officeId: f.officeId } : {}),
    ...(f.requesterId ? { requesterId: f.requesterId } : {}),
  };
}

function txWhere(f: ReportFilters): Prisma.FuelTransactionWhereInput {
  return {
    transactionDate: periodRange({ from: f.from!, to: f.to! }),
    status: f.status && ["ACTIVE", "SUPERSEDED", "VOIDED"].includes(f.status) ? (f.status as "ACTIVE") : "ACTIVE",
    ...(f.vehicleId ? { vehicleId: f.vehicleId } : {}),
    ...(f.fuelTypeId ? { fuelTypeId: f.fuelTypeId } : {}),
    ...(f.officeId ? { vehicle: { officeId: f.officeId } } : {}),
  };
}

const requestColumns: Column[] = [
  { key: "requestNumber", label: "Request No." },
  { key: "requestDate", label: "Request Date", type: "date" },
  { key: "requester", label: "Requester" },
  { key: "office", label: "Office / Division" },
  { key: "plateNumber", label: "Plate No." },
  { key: "fuelType", label: "Fuel Type" },
  { key: "purpose", label: "Purpose" },
  { key: "requestedLiters", label: "Requested (L)", type: "liters" },
  { key: "approvedLiters", label: "Approved (L)", type: "liters" },
  { key: "issuedLiters", label: "Issued (L)", type: "liters" },
  { key: "estimatedTotalCost", label: "Est. Cost (PHP)", type: "money" },
  { key: "status", label: "Status" },
];

async function requestRows(where: Prisma.FuelRequestWhereInput, extra?: "decision" | "pending") {
  const rows = await prisma.fuelRequest.findMany({
    where,
    include: {
      requester: true,
      office: true,
      vehicle: true,
      fuelType: true,
      assignedApprover: true,
      approvals: { orderBy: { createdAt: "desc" }, take: 1, include: { actedBy: true } },
    },
    orderBy: [{ requestDate: "asc" }, { id: "asc" }],
  });
  return rows.map((r) => ({
    requestNumber: r.requestNumber,
    requestDate: r.requestDate,
    requester: r.requester.fullName,
    office: r.office?.name ?? "",
    plateNumber: r.vehicle.plateNumber,
    fuelType: r.fuelType.name,
    purpose: r.purpose,
    requestedLiters: n(r.requestedLiters),
    approvedLiters: n(r.approvedLiters),
    issuedLiters: n(r.issuedLiters),
    estimatedTotalCost: n(r.estimatedTotalCost),
    status: STATUS_LABELS[r.status],
    decidedBy: extra === "decision" ? (r.approvals[0]?.actedBy.fullName ?? "") : undefined,
    decisionReason: extra === "decision" ? (r.approvals[0]?.reason ?? r.approvals[0]?.remarks ?? "") : undefined,
    assignedTo: extra === "pending" ? (r.assignedApprover?.fullName ?? "Unassigned") : undefined,
    daysPending: extra === "pending" && r.submittedAt ? Math.floor((Date.now() - r.submittedAt.getTime()) / 86400_000) : undefined,
    flagged: extra === "pending" ? (r.flaggedForReview ? "Yes" : "") : undefined,
  }));
}

function monthKeys(from: string, to: string) {
  const keys: string[] = [];
  let [y, m] = from.slice(0, 7).split("-").map(Number);
  const [ty, tm] = to.slice(0, 7).split("-").map(Number);
  while (y < ty || (y === ty && m <= tm)) {
    keys.push(`${y}-${String(m).padStart(2, "0")}`);
    m++;
    if (m > 12) {
      m = 1;
      y++;
    }
  }
  return keys;
}
const monthLabel = (k: string) => new Date(`${k}-01T00:00:00Z`).toLocaleString("en-US", { month: "long", year: "numeric", timeZone: "UTC" });

export async function buildReport(user: AuthUser, key: string, filtersIn: ReportFilters): Promise<ReportData> {
  const def = REPORTS.find((r) => r.key === key);
  if (!def) throw forbidden("Unknown report");
  if (def.permission && !can(user, def.permission)) throw forbidden("You do not have access to this report");
  const f: ReportFilters = { ...filtersIn, from: filtersIn.from ?? manilaMonthStart(), to: filtersIn.to ?? manilaToday() };
  if (f.from! > f.to!) [f.from, f.to] = [f.to, f.from];
  const settings = await getSettings(prisma);
  const base = {
    key,
    title: def.title,
    periodLabel: `${formatDateOnly(new Date(`${f.from}T00:00:00Z`))} – ${formatDateOnly(new Date(`${f.to}T00:00:00Z`))}`,
    generatedAt: new Date(),
    generatedBy: user.fullName,
    header: { agency: settings["org.agency"], office: settings["org.office"], address: settings["org.address"] },
  };
  const notes: string[] = [];
  let columns: Column[] = [];
  let rows: Record<string, unknown>[] = [];
  let totals: Record<string, unknown> | undefined;

  switch (key) {
    case "request-summary":
    case "approved-requests":
    case "rejected-cancelled":
    case "pending-requests": {
      const statuses: Record<string, RequestStatus[] | undefined> = {
        "request-summary": undefined,
        "approved-requests": APPROVED_FAMILY,
        "rejected-cancelled": ["REJECTED", "CANCELLED"],
        "pending-requests": ["PENDING_APPROVAL"],
      };
      const extra = key === "rejected-cancelled" ? "decision" : key === "pending-requests" ? "pending" : undefined;
      rows = await requestRows(requestWhere(f, statuses[key]), extra);
      columns = [...requestColumns];
      if (extra === "decision") columns.push({ key: "decidedBy", label: "Acted By" }, { key: "decisionReason", label: "Reason" });
      if (extra === "pending") {
        columns = columns.filter((c) => !["approvedLiters", "issuedLiters", "status"].includes(c.key));
        columns.push({ key: "assignedTo", label: "Assigned To" }, { key: "daysPending", label: "Days Pending", type: "number" }, { key: "flagged", label: "Flagged" });
      }
      totals = { requestNumber: `Total (${rows.length})`, requestedLiters: sumOf(rows, "requestedLiters"), approvedLiters: sumOf(rows, "approvedLiters"), issuedLiters: sumOf(rows, "issuedLiters"), estimatedTotalCost: sumOf(rows, "estimatedTotalCost") };
      notes.push("Requested and approved quantities are not fuel consumed. Issued liters come from recorded fuel transactions only.");
      break;
    }
    case "issuance": {
      const txs = await prisma.fuelTransaction.findMany({
        where: txWhere(f),
        include: { vehicle: true, fuelType: true, request: true, encodedBy: true, verifiedBy: true, odometerLog: true },
        orderBy: [{ transactionDate: "asc" }, { id: "asc" }],
      });
      columns = [
        { key: "transactionNumber", label: "Transaction ID" },
        { key: "transactionDate", label: "Date", type: "datetime" },
        { key: "requestNumber", label: "Request No." },
        { key: "plateNumber", label: "Plate No." },
        { key: "fuelType", label: "Fuel Type" },
        { key: "requestedLiters", label: "Requested (L)", type: "liters" },
        { key: "approvedLiters", label: "Approved (L)", type: "liters" },
        { key: "litersIssued", label: "Issued (L)", type: "liters" },
        { key: "pricePerLiter", label: "Price/L (PHP)", type: "money" },
        { key: "totalCost", label: "Total (PHP)", type: "money" },
        { key: "odometer", label: "Odometer (km)", type: "km" },
        { key: "odometerType", label: "Reading" },
        { key: "receiptNumber", label: "Receipt No." },
        { key: "encodedBy", label: "Encoded By" },
        { key: "verifiedBy", label: "Verified By" },
      ];
      rows = txs.map((t) => ({
        transactionNumber: t.transactionNumber,
        transactionDate: t.transactionDate,
        requestNumber: t.request?.requestNumber ?? "Direct issuance",
        plateNumber: t.vehicle.plateNumber,
        fuelType: t.fuelType.name,
        requestedLiters: n(t.requestedLiters),
        approvedLiters: n(t.approvedLiters),
        litersIssued: n(t.litersIssued),
        pricePerLiter: n(t.pricePerLiter),
        totalCost: n(t.totalCost),
        odometer: t.odometerLog?.actualOdometer != null ? n(t.odometerLog.actualOdometer) : n(t.odometerLog?.estimatedOdometer),
        odometerType: t.odometerLog?.actualOdometer != null ? "Actual" : t.odometerLog?.estimatedOdometer != null ? "Estimated" : "None",
        receiptNumber: t.receiptNumber ?? "",
        encodedBy: t.encodedBy.fullName,
        verifiedBy: t.verifiedBy?.fullName ?? "",
      }));
      totals = { transactionNumber: `Total (${rows.length})`, litersIssued: sumOf(rows, "litersIssued"), totalCost: sumOf(rows, "totalCost") };
      notes.push("Odometer values marked 'Estimated' are calculated by ratio and proportion and are not instrument readings.");
      break;
    }
    case "monthly-consumption":
    case "monthly-expenditure": {
      const txs = await prisma.fuelTransaction.findMany({ where: txWhere(f), include: { fuelType: true } });
      const types = [...new Set(txs.map((t) => t.fuelType.name))].sort();
      const field = key === "monthly-consumption" ? "litersIssued" : "totalCost";
      const type = key === "monthly-consumption" ? "liters" : "money";
      columns = [{ key: "month", label: "Month" }, { key: "transactions", label: "Transactions", type: "number" }, ...types.map((t) => ({ key: `ft:${t}`, label: `${t} (${type === "liters" ? "L" : "PHP"})`, type: type as "liters" })), { key: "total", label: type === "liters" ? "Total (L)" : "Total (PHP)", type: type as "liters" }];
      if (key === "monthly-expenditure") columns.splice(2, 0, { key: "liters", label: "Liters", type: "liters" });
      rows = monthKeys(f.from!, f.to!).map((mk) => {
        const inMonth = txs.filter((t) => manilaMonthKey(t.transactionDate) === mk);
        const row: Record<string, unknown> = { month: monthLabel(mk), transactions: inMonth.length, total: sumOf(inMonth as never, field), liters: sumOf(inMonth as never, "litersIssued") };
        for (const t of types) row[`ft:${t}`] = sumOf(inMonth.filter((x) => x.fuelType.name === t) as never, field);
        return row;
      });
      totals = Object.fromEntries(columns.map((c) => [c.key, c.key === "month" ? "Total" : sumOf(rows, c.key)]));
      if (key === "monthly-expenditure") rows.forEach((r) => (r.avgPrice = Number(r.liters) > 0 ? Math.round((Number(r.total) / Number(r.liters)) * 100) / 100 : null));
      if (key === "monthly-expenditure") columns.push({ key: "avgPrice", label: "Avg. Price/L (PHP)", type: "money" });
      notes.push("Based on actual fuel issued (active transactions). Corrected and cancelled transactions are excluded.");
      break;
    }
    case "by-fuel-type":
    case "by-office": {
      const txs = await prisma.fuelTransaction.findMany({ where: txWhere(f), include: { fuelType: true, vehicle: { include: { office: true } }, request: { include: { office: true } } } });
      const groupOf = (t: (typeof txs)[number]) => (key === "by-fuel-type" ? t.fuelType.name : (t.request?.office?.name ?? t.vehicle.office?.name ?? "Unassigned"));
      const groups = [...new Set(txs.map(groupOf))].sort();
      columns = [
        { key: "group", label: key === "by-fuel-type" ? "Fuel Type" : "Office / Division" },
        { key: "transactions", label: "Transactions", type: "number" },
        { key: "vehicles", label: "Vehicles", type: "number" },
        { key: "liters", label: "Liters Issued", type: "liters" },
        { key: "cost", label: "Total Cost (PHP)", type: "money" },
        { key: "avgPrice", label: "Avg. Price/L (PHP)", type: "money" },
        { key: "share", label: "Share of Liters", type: "pct" },
      ];
      const allLiters = txs.reduce((s, t) => s + Number(t.litersIssued), 0);
      rows = groups.map((g) => {
        const gx = txs.filter((t) => groupOf(t) === g);
        const liters = gx.reduce((s, t) => s + Number(t.litersIssued), 0);
        const cost = gx.reduce((s, t) => s + Number(t.totalCost), 0);
        return { group: g, transactions: gx.length, vehicles: new Set(gx.map((t) => t.vehicleId)).size, liters: Math.round(liters * 100) / 100, cost: Math.round(cost * 100) / 100, avgPrice: liters ? Math.round((cost / liters) * 100) / 100 : null, share: allLiters ? Math.round((liters / allLiters) * 10000) / 100 : null };
      });
      totals = { group: "Total", transactions: sumOf(rows, "transactions"), liters: sumOf(rows, "liters"), cost: sumOf(rows, "cost") };
      if (key === "by-office") notes.push("Office is the requesting office for request-based issuance, otherwise the vehicle's assigned office.");
      break;
    }
    case "vehicle-consumption":
    case "vehicle-efficiency": {
      const stats = await vehicleStats({ from: f.from!, to: f.to! }, { vehicleId: f.vehicleId, fuelTypeId: f.fuelTypeId, officeId: f.officeId });
      if (key === "vehicle-consumption") {
        columns = [
          { key: "plateNumber", label: "Plate No." },
          { key: "description", label: "Description" },
          { key: "office", label: "Office" },
          { key: "fuelType", label: "Fuel" },
          { key: "totalRequested", label: "Requested (L)", type: "liters" },
          { key: "totalApproved", label: "Approved (L)", type: "liters" },
          { key: "totalIssued", label: "Issued (L)", type: "liters" },
          { key: "totalExpenditure", label: "Expenditure (PHP)", type: "money" },
          { key: "verifiedDistance", label: "Verified Distance (km)", type: "km" },
          { key: "estimatedDistance", label: "Estimated Distance (km)", type: "km" },
          { key: "costPerKm", label: "Cost/km (PHP)", type: "money" },
        ];
        rows = stats.filter((s) => s.totalRequested || s.totalIssued || s.verifiedDistance || f.vehicleId).map((s) => ({ ...s, office: s.office ?? "" }));
        totals = { plateNumber: `Total (${rows.length})`, totalRequested: sumOf(rows, "totalRequested"), totalApproved: sumOf(rows, "totalApproved"), totalIssued: sumOf(rows, "totalIssued"), totalExpenditure: sumOf(rows, "totalExpenditure"), verifiedDistance: sumOf(rows, "verifiedDistance"), estimatedDistance: sumOf(rows, "estimatedDistance") };
        notes.push("Verified distance is measured between verified actual odometer readings. Estimated distance is calculated for fueling events without an actual reading.");
      } else {
        columns = [
          { key: "plateNumber", label: "Plate No." },
          { key: "classification", label: "Classification" },
          { key: "fuelType", label: "Fuel" },
          { key: "verifiedDistance", label: "Period Distance (km)", type: "km" },
          { key: "periodEfficiency", label: "Period km/L", type: "kmpl" },
          { key: "periodEfficiencyQuality", label: "Period Basis" },
          { key: "historicalEfficiency", label: "Reference km/L", type: "kmpl" },
          { key: "historicalEfficiencyQuality", label: "Reference Basis" },
          { key: "refPeriod", label: "Reference Period" },
          { key: "refLiters", label: "Ref. Liters", type: "liters" },
          { key: "refDistance", label: "Ref. Distance (km)", type: "km" },
          { key: "costPerKm", label: "Cost/km (PHP)", type: "money" },
        ];
        rows = stats.map((s) => ({
          ...s,
          periodEfficiency: s.periodEfficiency,
          periodEfficiencyQuality: s.periodEfficiencyQuality ?? "Insufficient data",
          historicalEfficiencyQuality: s.historicalEfficiencyQuality ?? "Insufficient data",
          refPeriod: s.reference?.periodStart ? `${formatDateOnly(s.reference.periodStart)} – ${formatDateOnly(s.reference.periodEnd)}` : "",
          refLiters: s.reference?.liters ?? null,
          refDistance: s.reference?.distanceKm ?? null,
        }));
        notes.push(`Reference method: ${settings["odometer.estimateMethod"].replaceAll("_", " ").toLowerCase()}, consumption basis: ${settings["odometer.consumptionBasis"].replaceAll("_", " ").toLowerCase()}.`);
        notes.push("VERIFIED efficiency uses full-tank-to-full-tank intervals between verified readings. ESTIMATED efficiency relies on approximate fuel attribution and should be read as an estimate.");
      }
      break;
    }
    case "odometer-monitoring":
    case "actual-vs-estimated": {
      const where: Prisma.OdometerLogWhereInput = {
        isVoided: false,
        readingDate: periodRange({ from: f.from!, to: f.to! }),
        ...(f.vehicleId ? { vehicleId: f.vehicleId } : {}),
        ...(f.officeId ? { vehicle: { officeId: f.officeId } } : {}),
        ...(key === "odometer-monitoring" && f.readingType ? { readingType: f.readingType } : {}),
        ...(key === "odometer-monitoring" && f.status && ["PENDING", "VERIFIED", "FLAGGED"].includes(f.status) ? { verificationStatus: f.status as "PENDING" } : {}),
        ...(key === "actual-vs-estimated" ? { actualOdometer: { not: null }, estimatedOdometer: { not: null } } : {}),
      };
      const logs = await prisma.odometerLog.findMany({ where, include: { vehicle: true, transaction: true, encodedBy: true, verifiedBy: true }, orderBy: [{ readingDate: "asc" }, { id: "asc" }] });
      if (key === "odometer-monitoring") {
        columns = [
          { key: "recordNumber", label: "Record ID" },
          { key: "readingDate", label: "Date", type: "datetime" },
          { key: "plateNumber", label: "Plate No." },
          { key: "transaction", label: "Transaction" },
          { key: "previous", label: "Prev. Verified (km)", type: "km" },
          { key: "actual", label: "Actual (km)", type: "km" },
          { key: "liters", label: "Fuel (L)", type: "liters" },
          { key: "efficiency", label: "Ref. km/L", type: "kmpl" },
          { key: "estDistance", label: "Est. Distance (km)", type: "km" },
          { key: "estimated", label: "Estimated (km)", type: "km" },
          { key: "readingType", label: "Reading Type" },
          { key: "verification", label: "Verification" },
          { key: "flags", label: "Flags" },
        ];
      } else {
        columns = [
          { key: "recordNumber", label: "Record ID" },
          { key: "readingDate", label: "Date", type: "datetime" },
          { key: "plateNumber", label: "Plate No." },
          { key: "previous", label: "Prev. Verified (km)", type: "km" },
          { key: "estDistance", label: "Est. Distance (km)", type: "km" },
          { key: "estimated", label: "Estimated (km)", type: "km" },
          { key: "actual", label: "Actual (km)", type: "km" },
          { key: "actualDistance", label: "Actual Distance (km)", type: "km" },
          { key: "varianceKm", label: "Difference (km)", type: "km" },
          { key: "variancePct", label: "Difference (%)", type: "pct" },
          { key: "verification", label: "Verification" },
          { key: "flags", label: "Flags" },
        ];
      }
      rows = logs.map((l) => ({
        recordNumber: l.recordNumber,
        readingDate: l.readingDate,
        plateNumber: l.vehicle.plateNumber,
        transaction: l.transaction?.transactionNumber ?? (l.source === "MANUAL_READING" ? "Manual reading" : "Initial reading"),
        previous: n(l.previousVerifiedOdometer),
        actual: n(l.actualOdometer),
        actualDistance: n(l.distanceTraveled),
        liters: n(l.fuelLiters),
        efficiency: n(l.efficiencyKmPerLiter),
        estDistance: n(l.estimatedDistance),
        estimated: n(l.estimatedOdometer),
        varianceKm: n(l.varianceKm),
        variancePct: n(l.variancePct),
        readingType: l.readingType === "ACTUAL" ? "Actual" : "Estimated",
        verification: l.verificationStatus,
        flags: l.flags.filter((x) => x !== "NO_ACTUAL_READING").join(", ").toLowerCase().replaceAll("_", " "),
      }));
      if (key === "actual-vs-estimated") {
        const abs = rows.map((r) => Math.abs(Number(r.varianceKm) || 0));
        totals = { recordNumber: `Records: ${rows.length}`, varianceKm: rows.length ? Math.round((abs.reduce((a, b) => a + b, 0) / rows.length) * 10) / 10 : null, plateNumber: "Mean absolute difference →" };
        notes.push("Difference = actual − estimated. Percentage is relative to the estimated distance and only shown when that distance is greater than zero.");
      }
      notes.push("Estimated readings are calculated (ratio and proportion) and are not instrument readings. Actual readings are never replaced by estimates.");
      break;
    }
    case "audit-trail": {
      const logs = await prisma.auditLog.findMany({
        where: { createdAt: periodRange({ from: f.from!, to: f.to! }), ...(f.requesterId ? { userId: f.requesterId } : {}) },
        include: { user: true },
        orderBy: { createdAt: "asc" },
        take: 5000,
      });
      columns = [
        { key: "createdAt", label: "Timestamp", type: "datetime" },
        { key: "user", label: "User" },
        { key: "action", label: "Action" },
        { key: "module", label: "Module" },
        { key: "recordId", label: "Record" },
        { key: "reason", label: "Reason / Remarks" },
        { key: "ipAddress", label: "IP Address" },
      ];
      rows = logs.map((l) => ({ createdAt: l.createdAt, user: l.user?.fullName ?? "(system / unknown)", action: l.action, module: l.module, recordId: l.recordId ?? "", reason: l.reason ?? "", ipAddress: l.ipAddress ?? "" }));
      if (logs.length === 5000) notes.push("Limited to the first 5,000 records; narrow the period for a complete listing.");
      break;
    }
  }
  return { ...base, columns, rows, totals, notes };
}
