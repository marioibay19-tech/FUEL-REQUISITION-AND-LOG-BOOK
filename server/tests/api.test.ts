import request from "supertest";
import { beforeAll, describe, expect, it } from "vitest";
import { prisma } from "../src/db.js";
import { app, futureDate, isoHoursAgo, login, makeUser, registerVehicle, resetDb, type Client } from "./helpers.js";

let fx: Awaited<ReturnType<typeof resetDb>>;
let admin: Client, requester: Client, requester2: Client, approver: Client, custodian: Client;
let ids: Record<string, number>;
let vehicle: { id: number; plateNumber: string };

const draft = (overrides: Record<string, unknown> = {}) => ({
  purpose: "Inspection of road project",
  destination: "San Fernando City",
  travelDate: futureDate(1),
  vehicleId: vehicle.id,
  fuelTypeId: fx.diesel.id,
  requestedLiters: 40,
  estimatedPricePerLiter: 61.5,
  intendedFuelingDate: futureDate(1),
  reason: "Scheduled field work",
  ...overrides,
});

async function submitted(client: Client, overrides: Record<string, unknown> = {}) {
  const c = await client.post("/api/requests", draft(overrides));
  expect(c.status).toBe(201);
  const s = await client.post(`/api/requests/${c.body.id}/submit`);
  expect(s.status).toBe(200);
  return s.body;
}

beforeAll(async () => {
  fx = await resetDb();
  const a = await makeUser(["ADMIN"], fx.office.id);
  const r = await makeUser(["REQUESTER"], fx.office.id);
  const r2 = await makeUser(["REQUESTER"], fx.other.id);
  const ap = await makeUser(["APPROVER"], fx.office.id);
  const c = await makeUser(["CUSTODIAN"], fx.office.id);
  ids = { admin: a.id, requester: r.id, requester2: r2.id, approver: ap.id, custodian: c.id };
  await prisma.office.update({ where: { id: fx.office.id }, data: { defaultApproverId: ap.id } });
  [admin, requester, requester2, approver, custodian] = await Promise.all([a, r, r2, ap, c].map((u) => login(u.username)));
  vehicle = await registerVehicle(admin, { fuelTypeId: fx.diesel.id, officeId: fx.office.id });
});

describe("authentication", () => {
  it("logs in with valid credentials and returns roles and permissions", async () => {
    const res = await request(app).post("/api/auth/login").set("X-Requested-With", "FuelTrack").send({ username: "user2", password: "TestPass2026" });
    expect(res.status).toBe(200);
    expect(res.body.user.roles).toEqual(["REQUESTER"]);
    expect(res.body.user.permissions).toContain("request.create");
    expect(res.headers["set-cookie"]?.[0]).toMatch(/fueltrack\.sid=.*HttpOnly.*SameSite=Strict/i);
  });

  it("rejects a wrong password with a generic message and records it", async () => {
    const res = await request(app).post("/api/auth/login").set("X-Requested-With", "FuelTrack").send({ username: "user2", password: "wrong-password1" });
    expect(res.status).toBe(401);
    expect(res.body.error).toBe("Invalid username or password");
    expect(await prisma.auditLog.count({ where: { action: "LOGIN_FAILED" } })).toBeGreaterThan(0);
  });

  it("locks the account after five failed attempts", async () => {
    const u = await makeUser(["REQUESTER"], fx.office.id);
    for (let i = 0; i < 5; i++) await request(app).post("/api/auth/login").set("X-Requested-With", "FuelTrack").send({ username: u.username, password: "nope-nope-1" });
    const res = await request(app).post("/api/auth/login").set("X-Requested-With", "FuelTrack").send({ username: u.username, password: "TestPass2026" });
    expect(res.status).toBe(423);
  });

  it("refuses deactivated accounts", async () => {
    const u = await makeUser(["REQUESTER"], fx.office.id, { isActive: false });
    const res = await request(app).post("/api/auth/login").set("X-Requested-With", "FuelTrack").send({ username: u.username, password: "TestPass2026" });
    expect(res.status).toBe(403);
  });

  it("records login events in the audit trail", async () => {
    expect(await prisma.auditLog.count({ where: { action: "LOGIN", userId: ids.requester } })).toBeGreaterThan(0);
  });
});

describe("unauthorized access and role-based permissions", () => {
  it("rejects anonymous access to protected routes", async () => {
    expect((await request(app).get("/api/dashboard")).status).toBe(401);
    expect((await request(app).get("/api/requests")).status).toBe(401);
  });

  it("blocks state-changing requests without the anti-forgery header", async () => {
    const res = await requester.agent.post("/api/requests").send(draft());
    expect(res.status).toBe(403);
  });

  it("enforces permissions on the backend", async () => {
    expect((await requester.get("/api/users")).status).toBe(403);
    expect((await requester.get("/api/audit")).status).toBe(403);
    expect((await requester.get("/api/transactions")).status).toBe(403);
    expect((await requester.post("/api/transactions", { vehicleId: vehicle.id, litersIssued: 10, pricePerLiter: 60, transactionDate: isoHoursAgo(1), remarks: "x" })).status).toBe(403);
    expect((await approver.post("/api/transactions", { vehicleId: vehicle.id, litersIssued: 10, pricePerLiter: 60, transactionDate: isoHoursAgo(1), remarks: "x" })).status).toBe(403);
    expect((await custodian.post("/api/requests/1/decision", { action: "APPROVE" })).status).toBe(403);
    expect((await custodian.put("/api/settings", { values: {} })).status).toBe(403);
    expect((await requester.post("/api/vehicles", { plateNumber: "X" })).status).toBe(403);
  });

  it("hides other people's requests", async () => {
    const r = await submitted(requester);
    expect((await requester2.get(`/api/requests/${r.id}`)).status).toBe(404);
    const list = await requester2.get("/api/requests");
    expect(list.body.items.find((x: { id: number }) => x.id === r.id)).toBeUndefined();
    // and a requester cannot request fuel for another office's vehicle
    const res = await requester2.post("/api/requests", draft());
    expect(res.status).toBe(400);
    expect(res.body.details.fields.vehicleId).toBeDefined();
  });
});

describe("fuel request submission", () => {
  it("creates a draft, computes the estimated cost and submits it for approval", async () => {
    const c = await requester.post("/api/requests", draft({ requestedLiters: 37.5, estimatedPricePerLiter: 61.37 }));
    expect(c.status).toBe(201);
    expect(c.body.status).toBe("DRAFT");
    expect(c.body.requestNumber).toMatch(/^FR-\d{4}-\d{6}$/);
    expect(c.body.estimatedTotalCost).toBe(2301.38); // 37.5 × 61.37 = 2301.375 → 2301.38
    const s = await requester.post(`/api/requests/${c.body.id}/submit`);
    expect(s.status).toBe(200);
    expect(s.body.status).toBe("PENDING_APPROVAL");
    expect(s.body.assignedApproverId).toBe(ids.approver);
    expect(s.body.submittedAt).toBeTruthy();
    const history = await prisma.fuelApproval.findMany({ where: { requestId: c.body.id } });
    expect(history).toMatchObject([{ action: "SUBMIT", previousStatus: "DRAFT", newStatus: "PENDING_APPROVAL", actedById: ids.requester }]);
    expect(await prisma.notification.count({ where: { userId: ids.approver, type: "PENDING_APPROVAL" } })).toBeGreaterThan(0);
    expect(await prisma.notification.count({ where: { userId: ids.requester, type: "REQUEST_SUBMITTED" } })).toBeGreaterThan(0);
    expect(await prisma.auditLog.count({ where: { action: "REQUEST_SUBMITTED", recordId: c.body.requestNumber } })).toBe(1);
  });

  it("rejects zero, negative and non-numeric fuel quantities", async () => {
    for (const requestedLiters of [0, -5, "abc", ""]) {
      const res = await requester.post("/api/requests", draft({ requestedLiters }));
      expect(res.status).toBe(400);
      expect(res.body.details.fields.requestedLiters).toBeDefined();
    }
  });

  it("validates dates, vehicle status and fuel type on submission", async () => {
    const past = await requester.post("/api/requests", draft({ intendedFuelingDate: "2020-01-01" }));
    const res = await requester.post(`/api/requests/${past.body.id}/submit`);
    expect(res.status).toBe(400);
    expect(res.body.details.fields.intendedFuelingDate).toMatch(/past/);

    const wrongFuel = await requester.post("/api/requests", draft({ fuelTypeId: fx.gasoline.id }));
    const r2 = await requester.post(`/api/requests/${wrongFuel.body.id}/submit`);
    expect(r2.status).toBe(400);
    expect(r2.body.details.fields.overrideReason).toBeDefined();

    const repair = await registerVehicle(admin, { fuelTypeId: fx.diesel.id, officeId: fx.office.id, status: "UNDER_REPAIR" });
    const d = await requester.post("/api/requests", draft({ vehicleId: repair.id }));
    const r3 = await requester.post(`/api/requests/${d.body.id}/submit`);
    expect(r3.status).toBe(400);
    expect(r3.body.details.fields.vehicleId).toMatch(/not active/);
  });

  it("prevents duplicate submissions and flags suspicious ones", async () => {
    const token = "form-token-123456";
    const a = await requester.post("/api/requests", draft({ clientToken: token }));
    const b = await requester.post("/api/requests", draft({ clientToken: token }));
    expect(a.status).toBe(201);
    expect(b.status).toBe(200);
    expect(b.body.id).toBe(a.body.id);
    expect(b.body.duplicate).toBe(true);
    const s1 = await requester.post(`/api/requests/${a.body.id}/submit`);
    const s2 = await requester.post(`/api/requests/${a.body.id}/submit`);
    expect(s1.status).toBe(200);
    expect(s2.status).toBe(409);
    expect(s1.body.flaggedForReview).toBe(true); // another open request for the same vehicle exists
    expect(s1.body.flagReasons.join(" ")).toMatch(/Possible duplicate|Another open request/);
  });
});

describe("approval workflow", () => {
  it("approves a request with an approved quantity and records the history", async () => {
    const r = await submitted(requester, { requestedLiters: 50 });
    const res = await approver.post(`/api/requests/${r.id}/decision`, { action: "APPROVE", approvedLiters: 45, remarks: "Reduced to 45 L" });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ status: "APPROVED", approvedLiters: 45 });
    const h = await prisma.fuelApproval.findFirst({ where: { requestId: r.id, action: "APPROVE" } });
    expect(h).toMatchObject({ previousStatus: "PENDING_APPROVAL", newStatus: "APPROVED", actedById: ids.approver, remarks: "Reduced to 45 L" });
    expect(await prisma.fuelTransaction.count({ where: { requestId: r.id } })).toBe(0); // approval is not issuance
    const again = await approver.post(`/api/requests/${r.id}/decision`, { action: "REJECT", reason: "x" });
    expect(again.status).toBe(409);
  });

  it("refuses approved liters above the requested liters", async () => {
    const r = await submitted(requester, { requestedLiters: 20 });
    const res = await approver.post(`/api/requests/${r.id}/decision`, { action: "APPROVE", approvedLiters: 25 });
    expect(res.status).toBe(400);
  });

  it("requires a reason to reject and notifies the requester", async () => {
    const r = await submitted(requester);
    expect((await approver.post(`/api/requests/${r.id}/decision`, { action: "REJECT" })).status).toBe(400);
    const res = await approver.post(`/api/requests/${r.id}/decision`, { action: "REJECT", reason: "Not official business" });
    expect(res.body.status).toBe("REJECTED");
    const h = await prisma.fuelApproval.findFirst({ where: { requestId: r.id, action: "REJECT" } });
    expect(h?.reason).toBe("Not official business");
    expect(await prisma.notification.count({ where: { userId: ids.requester, type: "REQUEST_REJECTED" } })).toBe(1);
  });

  it("returns a request for revision, lets the requester correct and resubmit it", async () => {
    const r = await submitted(requester);
    const ret = await approver.post(`/api/requests/${r.id}/decision`, { action: "RETURN", reason: "State the destination" });
    expect(ret.body.status).toBe("RETURNED");
    const upd = await requester.put(`/api/requests/${r.id}`, draft({ destination: "Agoo, La Union" }));
    expect(upd.status).toBe(200);
    const re = await requester.post(`/api/requests/${r.id}/submit`);
    expect(re.body.status).toBe("PENDING_APPROVAL");
    expect(await prisma.fuelApproval.count({ where: { requestId: r.id, action: "RESUBMIT" } })).toBe(1);
  });

  it("does not let users approve their own requests", async () => {
    const dual = await makeUser(["APPROVER", "REQUESTER"], fx.office.id);
    const c = await login(dual.username);
    const r = await submitted(c);
    expect(r.assignedApproverId).toBe(ids.approver); // the office's default approving officer
    const res = await c.post(`/api/requests/${r.id}/decision`, { action: "APPROVE" });
    expect(res.status).toBe(403);
  });
});

describe("fuel issuance", () => {
  it("records actual issuance, calculates the cost and updates the request status", async () => {
    const r = await submitted(requester, { requestedLiters: 50 });
    await approver.post(`/api/requests/${r.id}/decision`, { action: "APPROVE", approvedLiters: 50 });
    const first = await custodian.post("/api/transactions", { requestId: r.id, transactionDate: new Date().toISOString(), litersIssued: 30, pricePerLiter: 61.37, odometerReading: 25100, receiptNumber: "OR-1" });
    expect(first.status).toBe(201);
    expect(first.body.transactionNumber).toMatch(/^FT-\d{4}-\d{6}$/);
    expect(first.body).toMatchObject({ litersIssued: 30, requestedLiters: 50, approvedLiters: 50, totalCost: 1841.1 });
    let req = await prisma.fuelRequest.findUniqueOrThrow({ where: { id: r.id } });
    expect(req.status).toBe("PARTIALLY_ISSUED");
    const tooMuch = await custodian.post("/api/transactions", { requestId: r.id, transactionDate: new Date().toISOString(), litersIssued: 25, pricePerLiter: 61.37 });
    expect(tooMuch.status).toBe(400);
    expect(tooMuch.body.details.fields.litersIssued).toMatch(/20 L/);
    const second = await custodian.post("/api/transactions", { requestId: r.id, transactionDate: new Date().toISOString(), litersIssued: 20, pricePerLiter: 61.37 });
    expect(second.status).toBe(201);
    req = await prisma.fuelRequest.findUniqueOrThrow({ where: { id: r.id } });
    expect(req.status).toBe("FULLY_ISSUED");
    expect(Number(req.issuedLiters)).toBe(50);
    expect(await prisma.odometerLog.count({ where: { transactionId: { in: [first.body.id, second.body.id] } } })).toBe(2);
    expect(await prisma.notification.count({ where: { userId: ids.requester, type: "FUEL_ISSUED" } })).toBe(2);
  });

  it("cannot issue against a request that is not approved", async () => {
    const r = await submitted(requester);
    const res = await custodian.post("/api/transactions", { requestId: r.id, transactionDate: new Date().toISOString(), litersIssued: 10, pricePerLiter: 60 });
    expect(res.status).toBe(409);
  });

  it("corrects a transaction by superseding it, preserving the original record", async () => {
    const t = await custodian.post("/api/transactions", { vehicleId: vehicle.id, transactionDate: isoHoursAgo(2), litersIssued: 15, pricePerLiter: 60, remarks: "Emergency fuelling" });
    const fix = await custodian.post(`/api/transactions/${t.body.id}/correct`, { transactionDate: isoHoursAgo(2), litersIssued: 16, pricePerLiter: 60, reason: "Pump reading misread" });
    expect(fix.status).toBe(201);
    expect(fix.body.correctsId).toBe(t.body.id);
    expect(fix.body.totalCost).toBe(960);
    const orig = await prisma.fuelTransaction.findUniqueOrThrow({ where: { id: t.body.id } });
    expect(orig.status).toBe("SUPERSEDED");
    expect(Number(orig.litersIssued)).toBe(15);
    expect(await prisma.auditLog.count({ where: { action: "TRANSACTION_CORRECTED", reason: "Pump reading misread" } })).toBe(1);
    await expect(prisma.fuelTransaction.delete({ where: { id: t.body.id } })).rejects.toThrow(/cannot be deleted/);
  });
});

describe("odometer estimation (ratio and proportion)", () => {
  // Reference: 25,000 → 25,320 km on 40 L (full tank to full tank) = 8 km/L.
  let v: { id: number };
  let verifier: Client;
  beforeAll(async () => {
    verifier = approver;
    v = await registerVehicle(admin, { fuelTypeId: fx.diesel.id, officeId: fx.office.id, initialOdometer: 25000 });
    await prisma.odometerLog.updateMany({ where: { vehicleId: v.id }, data: { readingDate: new Date(Date.now() - 10 * 86400_000), isFullTank: true } });
  });

  it("reports insufficient data when there is no historical reference interval", async () => {
    const t = await custodian.post("/api/transactions", { vehicleId: v.id, transactionDate: isoHoursAgo(24 * 5), litersIssued: 40, pricePerLiter: 60, odometerReading: 25320, isFullTank: true, remarks: "Reference fill" });
    expect(t.status).toBe(201);
    const log = await prisma.odometerLog.findUniqueOrThrow({ where: { transactionId: t.body.id } });
    expect(log.estimateStatus).toBe("INSUFFICIENT_DATA");
    expect(log.estimatedOdometer).toBeNull();
    expect(log.readingType).toBe("ACTUAL");
    expect(Number(log.distanceTraveled)).toBe(320);
    const detail = await custodian.get(`/api/odometer/${log.id}`);
    expect(detail.body.insufficientReason).toMatch(/reference/i);
    // the encoder cannot verify their own record; the approving officer can
    expect((await custodian.post(`/api/odometer/${log.id}/verify`, {})).status).toBe(403);
    const ver = await verifier.post(`/api/odometer/${log.id}/verify`, {});
    expect(ver.status).toBe(200);
    expect(ver.body.verificationStatus).toBe("VERIFIED");
  });

  it("estimates 25 L → 200 km → 25,520 km and labels it as an estimate", async () => {
    const t = await custodian.post("/api/transactions", { vehicleId: v.id, transactionDate: isoHoursAgo(24 * 2), litersIssued: 25, pricePerLiter: 60, isFullTank: true, remarks: "No odometer available" });
    const log = await prisma.odometerLog.findUniqueOrThrow({ where: { transactionId: t.body.id } });
    expect(log.readingType).toBe("ESTIMATED");
    expect(log.actualOdometer).toBeNull();
    expect(log.estimateStatus).toBe("COMPUTED");
    expect(Number(log.efficiencyKmPerLiter)).toBe(8);
    expect(Number(log.referenceLiters)).toBe(40);
    expect(Number(log.referenceDistance)).toBe(320);
    expect(Number(log.previousVerifiedOdometer)).toBe(25320);
    expect(Number(log.estimatedDistance)).toBe(200);
    expect(Number(log.estimatedOdometer)).toBe(25520);
    expect(log.flags).toContain("NO_ACTUAL_READING");
    const detail = await custodian.get(`/api/odometer/${log.id}`);
    expect(detail.body.steps).toContain("x = (25 × 320) ÷ 40 = 200 km");
    expect(detail.body.steps).toContain("Estimated odometer = 25,320 + 200 = 25,520 km");
    // the vehicle's current odometer stays at the last VERIFIED actual reading
    expect(Number((await prisma.vehicle.findUniqueOrThrow({ where: { id: v.id } })).currentOdometer)).toBe(25320);
  });

  it("compares a later actual reading with the estimate without overwriting it", async () => {
    const log = await prisma.odometerLog.findFirstOrThrow({ where: { vehicleId: v.id, readingType: "ESTIMATED" } });
    const res = await custodian.post(`/api/odometer/${log.id}/actual`, { actualOdometer: 25540 });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ readingType: "ACTUAL", actualOdometer: 25540, estimatedOdometer: 25520, varianceKm: 20, variancePct: 10 });
    expect(res.body.flags).not.toContain("LARGE_VARIANCE");
    const again = await custodian.post(`/api/odometer/${log.id}/actual`, { actualOdometer: 25541 });
    expect(again.status).toBe(409); // corrections need the controlled correction action
  });

  it("flags an actual reading lower than the previous verified reading", async () => {
    const t = await custodian.post("/api/transactions", { vehicleId: v.id, transactionDate: isoHoursAgo(1), litersIssued: 30, pricePerLiter: 60, odometerReading: 25100, isFullTank: true, remarks: "Typo test" });
    const log = await prisma.odometerLog.findUniqueOrThrow({ where: { transactionId: t.body.id } });
    expect(log.flags).toContain("ACTUAL_LOWER_THAN_PREVIOUS");
    expect(log.verificationStatus).toBe("FLAGGED");
    const res = await verifier.post(`/api/odometer/${log.id}/verify`, {});
    expect(res.status).toBe(400); // remarks are required to accept a flagged reading
  });

  it("corrects an actual reading while preserving the original value", async () => {
    const log = await prisma.odometerLog.findFirstOrThrow({ where: { vehicleId: v.id, flags: { has: "ACTUAL_LOWER_THAN_PREVIOUS" } } });
    const res = await custodian.post(`/api/odometer/${log.id}/correct`, { actualOdometer: 25780, reason: "Digits transposed" });
    expect(res.status).toBe(200);
    expect(res.body.actualOdometer).toBe(25780);
    expect(res.body.originalActualOdometer).toBe(25100);
    expect(res.body.flags).not.toContain("ACTUAL_LOWER_THAN_PREVIOUS");
    expect(await prisma.auditLog.count({ where: { action: "ODOMETER_ACTUAL_CORRECTED", reason: "Digits transposed" } })).toBe(1);
  });

  it("flags a large difference between actual and estimated readings", async () => {
    const w = await registerVehicle(admin, { fuelTypeId: fx.diesel.id, officeId: fx.office.id, initialOdometer: 10000 });
    await prisma.odometerLog.updateMany({ where: { vehicleId: w.id }, data: { readingDate: new Date(Date.now() - 10 * 86400_000), isFullTank: true } });
    const a = await custodian.post("/api/transactions", { vehicleId: w.id, transactionDate: isoHoursAgo(72), litersIssued: 40, pricePerLiter: 60, odometerReading: 10320, isFullTank: true, remarks: "ref" });
    await verifier.post(`/api/odometer/${(await prisma.odometerLog.findUniqueOrThrow({ where: { transactionId: a.body.id } })).id}/verify`, {});
    const b = await custodian.post("/api/transactions", { vehicleId: w.id, transactionDate: isoHoursAgo(2), litersIssued: 25, pricePerLiter: 60, odometerReading: 10420, isFullTank: true, remarks: "short trip" });
    const log = await prisma.odometerLog.findUniqueOrThrow({ where: { transactionId: b.body.id } });
    expect(Number(log.estimatedOdometer)).toBe(10520);
    expect(Number(log.varianceKm)).toBe(-100);
    expect(Number(log.variancePct)).toBe(-50);
    expect(log.flags).toContain("LARGE_VARIANCE");
    expect(await prisma.notification.count({ where: { type: "ABNORMAL_CONSUMPTION" } })).toBeGreaterThan(0);
  });

  it("computes historical efficiency from verified intervals for monitoring", async () => {
    const res = await admin.get(`/api/monitoring/vehicles?vehicleId=${v.id}&from=${futureDate(-30)}&to=${futureDate(0)}`);
    expect(res.status).toBe(200);
    const row = res.body.rows[0];
    expect(row.historicalEfficiency).toBe(8);
    expect(row.historicalEfficiencyQuality).toBe("VERIFIED");
    expect(row.verifiedDistance).toBe(320);
  });
});

describe("reports and exports", () => {
  it("filters report rows by vehicle and exports CSV, Excel and PDF", async () => {
    const other = await registerVehicle(admin, { fuelTypeId: fx.diesel.id, officeId: fx.office.id });
    await custodian.post("/api/transactions", { vehicleId: other.id, transactionDate: isoHoursAgo(1), litersIssued: 12, pricePerLiter: 60, remarks: "Other vehicle" });
    const all = await admin.get(`/api/reports/issuance?from=${futureDate(-30)}&to=${futureDate(0)}`);
    expect(all.status).toBe(200);
    const filtered = await admin.get(`/api/reports/issuance?from=${futureDate(-30)}&to=${futureDate(0)}&vehicleId=${other.id}`);
    expect(filtered.body.rows).toHaveLength(1);
    expect(filtered.body.rows[0]).toMatchObject({ plateNumber: other.plateNumber, litersIssued: 12, totalCost: 720 });
    expect(filtered.body.totals.litersIssued).toBe(12);
    expect(all.body.rows.length).toBeGreaterThan(1);

    const csv = await admin.get(`/api/reports/issuance?vehicleId=${other.id}&format=csv`);
    expect(csv.status).toBe(200);
    expect(csv.headers["content-type"]).toMatch(/text\/csv/);
    expect(csv.text).toContain("Fuel Issuance Transaction Report");
    expect(csv.text).toContain(other.plateNumber);

    const xlsx = await admin.get(`/api/reports/vehicle-efficiency?format=xlsx`).buffer(true).parse((res, cb) => {
      const chunks: Buffer[] = [];
      res.on("data", (c: Buffer) => chunks.push(c));
      res.on("end", () => cb(null, Buffer.concat(chunks)));
    });
    expect(xlsx.status).toBe(200);
    expect((xlsx.body as Buffer).subarray(0, 2).toString()).toBe("PK");
    const pdf = await admin.get(`/api/reports/actual-vs-estimated?format=pdf`).buffer(true).parse((res, cb) => {
      const chunks: Buffer[] = [];
      res.on("data", (c: Buffer) => chunks.push(c));
      res.on("end", () => cb(null, Buffer.concat(chunks)));
    });
    expect((pdf.body as Buffer).subarray(0, 5).toString()).toBe("%PDF-");
    expect(await prisma.auditLog.count({ where: { action: "REPORT_EXPORTED" } })).toBe(3);
  });

  it("distinguishes actual from estimated odometer values in reports", async () => {
    const res = await admin.get(`/api/reports/odometer-monitoring?from=${futureDate(-30)}&to=${futureDate(0)}&readingType=ESTIMATED`);
    expect(res.body.rows.length).toBeGreaterThan(0);
    expect(res.body.rows.every((r: { readingType: string }) => r.readingType === "Estimated")).toBe(true);
  });

  it("restricts the audit trail report and exports", async () => {
    expect((await custodian.get("/api/reports/audit-trail")).status).toBe(403);
    expect((await requester.get("/api/reports/issuance")).status).toBe(403);
  });
});

describe("audit trail", () => {
  it("records key actions with before and after values", async () => {
    const actions = (await prisma.auditLog.findMany({ select: { action: true } })).map((a) => a.action);
    for (const a of ["LOGIN", "VEHICLE_CREATED", "REQUEST_CREATED", "REQUEST_SUBMITTED", "REQUEST_APPROVED", "REQUEST_REJECTED", "FUEL_ISSUED", "ODOMETER_RECORD_CREATED", "ODOMETER_ESTIMATE_CALCULATED", "ODOMETER_READING_VERIFIED", "ODOMETER_ACTUAL_RECORDED", "TRANSACTION_CORRECTED", "REPORT_EXPORTED"])
      expect(actions).toContain(a);
    const approved = await prisma.auditLog.findFirstOrThrow({ where: { action: "REQUEST_APPROVED" } });
    expect(approved.before).toMatchObject({ status: "PENDING_APPROVAL" });
    expect(approved.after).toMatchObject({ status: "APPROVED" });
  });

  it("cannot be modified or deleted, even directly in the database", async () => {
    const row = await prisma.auditLog.findFirstOrThrow();
    await expect(prisma.auditLog.update({ where: { id: row.id }, data: { action: "TAMPERED" } })).rejects.toThrow(/cannot be updated/);
    await expect(prisma.auditLog.delete({ where: { id: row.id } })).rejects.toThrow(/cannot be deleted/);
  });

  it("records user and permission changes", async () => {
    const u = await makeUser(["REQUESTER"], fx.office.id);
    const res = await admin.put(`/api/users/${u.id}`, { username: u.username, fullName: u.fullName, officeId: fx.office.id, roles: ["REQUESTER", "CUSTODIAN"], isActive: true });
    expect(res.status).toBe(200);
    expect(res.body.roles.sort()).toEqual(["CUSTODIAN", "REQUESTER"]);
    const log = await prisma.auditLog.findFirstOrThrow({ where: { action: "USER_ROLES_CHANGED", recordId: u.username } });
    expect(log.after).toMatchObject({ roles: ["REQUESTER", "CUSTODIAN"] });
  });
});

describe("dashboard", () => {
  it("returns database-driven figures", async () => {
    const res = await admin.get("/api/dashboard");
    expect(res.status).toBe(200);
    const issued = await prisma.fuelTransaction.aggregate({ where: { status: "ACTIVE" }, _sum: { litersIssued: true } });
    expect(res.body.cards.litersIssued).toBeCloseTo(Number(issued._sum.litersIssued), 2);
    expect(res.body.cards.vehicles).toBe(await prisma.vehicle.count({ where: { status: { not: "RETIRED" } } }));
    expect(res.body.charts.monthly).toHaveLength(12);
  });
});
