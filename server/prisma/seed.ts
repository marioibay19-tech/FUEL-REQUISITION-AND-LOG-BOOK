// Seed: roles, initial administrator, fuel types and default settings.
// With SEED_DEMO_DATA=true (and an empty fleet) it also loads sample offices,
// users, vehicles and ~6 months of fuel history so every screen has real data.
import "dotenv/config";
import { prisma, type RequestStatus } from "../src/db.js";
import { audit } from "../src/lib/audit.js";
import { computeCost } from "../src/lib/calc.js";
import { nextNumber } from "../src/lib/numbering.js";
import { hashPassword } from "../src/lib/password.js";
import { seedBase } from "../src/lib/seed-base.js";
import { addDays, dateOnly, manilaToday } from "../src/lib/time.js";
import { applyComputed, refreshVehicleOdometer } from "../src/services/odometer.js";

// Deterministic pseudo-random numbers so the demo data is the same on every machine.
let seed = 20261029;
const rand = () => ((seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296);
const between = (a: number, b: number) => a + (b - a) * rand();
const r2 = (n: number) => Math.round(n * 100) / 100;
const r1 = (n: number) => Math.round(n * 10) / 10;

interface VehicleSpec {
  plate: string;
  property: string;
  description: string;
  make: string;
  model: string;
  year: number;
  classification: string;
  fuel: "DIESEL" | "GASOLINE";
  office: string;
  custodian: string;
  tank: number;
  odometer: number;
  efficiency: number; // true km/L used to simulate history
  weeklyKm: [number, number];
  status?: "ACTIVE" | "UNDER_REPAIR" | "RETIRED";
  anomaly?: "HIGH_CONSUMPTION" | "LOWER_READING" | "MISSING_READINGS";
}

const VEHICLES: VehicleSpec[] = [
  { plate: "SAB 1234", property: "EMD-SV-001", description: "Toyota Hilux 2.4 4x4 pick-up", make: "Toyota", model: "Hilux", year: 2021, classification: "Service Vehicle", fuel: "DIESEL", office: "EMD", custodian: "Ramon Villanueva", tank: 80, odometer: 48210, efficiency: 9.4, weeklyKm: [260, 420] },
  { plate: "SAC 5678", property: "EMD-SV-002", description: "Mitsubishi L300 FB van", make: "Mitsubishi", model: "L300", year: 2019, classification: "Service Vehicle", fuel: "DIESEL", office: "ADMIN", custodian: "Arnel Domingo", tank: 55, odometer: 91240, efficiency: 8.6, weeklyKm: [180, 320] },
  { plate: "SAE 3456", property: "EMD-SV-003", description: "Nissan Navara 4x2 pick-up", make: "Nissan", model: "Navara", year: 2020, classification: "Service Vehicle", fuel: "DIESEL", office: "PLAN", custodian: "Jerome Castillo", tank: 80, odometer: 66320, efficiency: 10.1, weeklyKm: [200, 380], anomaly: "LOWER_READING" },
  { plate: "SAD 9012", property: "EMD-SV-004", description: "Toyota Vios 1.3 sedan", make: "Toyota", model: "Vios", year: 2022, classification: "Service Vehicle", fuel: "GASOLINE", office: "ADMIN", custodian: "Liza Fernandez", tank: 42, odometer: 23150, efficiency: 13.2, weeklyKm: [150, 300] },
  { plate: "SKL 2210", property: "EMD-DT-010", description: "Isuzu Giga 10-wheeler dump truck", make: "Isuzu", model: "Giga CYZ", year: 2018, classification: "Dump Truck", fuel: "DIESEL", office: "CONS", custodian: "Danilo Ramos", tank: 200, odometer: 132400, efficiency: 2.9, weeklyKm: [120, 260] },
  { plate: "SKL 2211", property: "EMD-DT-011", description: "Isuzu Forward 6-wheeler dump truck", make: "Isuzu", model: "Forward", year: 2019, classification: "Dump Truck", fuel: "DIESEL", office: "MAINT", custodian: "Efren Mercado", tank: 150, odometer: 98760, efficiency: 3.5, weeklyKm: [120, 240] },
  { plate: "SKL 2212", property: "EMD-DT-012", description: "Hino 500 6-wheeler dump truck", make: "Hino", model: "500 FG", year: 2020, classification: "Dump Truck", fuel: "DIESEL", office: "CONS", custodian: "Noel Pascual", tank: 150, odometer: 77810, efficiency: 3.3, weeklyKm: [120, 240] },
  { plate: "SKM 7788", property: "EMD-BT-020", description: "Mitsubishi Fuso boom truck", make: "Mitsubishi Fuso", model: "Fighter", year: 2017, classification: "Boom Truck", fuel: "DIESEL", office: "MAINT", custodian: "Rodel Aquino", tank: 200, odometer: 104550, efficiency: 3.1, weeklyKm: [80, 180] },
  { plate: "SKN 3344", property: "EMD-WT-030", description: "Hino water truck (10,000 L)", make: "Hino", model: "FM", year: 2016, classification: "Water Truck", fuel: "DIESEL", office: "CONS", custodian: "Mario Tolentino", tank: 200, odometer: 151020, efficiency: 3.0, weeklyKm: [100, 200], anomaly: "HIGH_CONSUMPTION" },
  { plate: "MC 4521", property: "EMD-MC-040", description: "Honda XRM 125 motorcycle", make: "Honda", model: "XRM 125", year: 2023, classification: "Motorcycle", fuel: "GASOLINE", office: "QA", custodian: "Paolo Navarro", tank: 4.2, odometer: 8420, efficiency: 42, weeklyKm: [90, 160], anomaly: "MISSING_READINGS" },
  { plate: "SAF 1122", property: "EMD-SV-005", description: "Toyota Hiace commuter van", make: "Toyota", model: "Hiace", year: 2017, classification: "Service Vehicle", fuel: "DIESEL", office: "EMD", custodian: "Ramon Villanueva", tank: 70, odometer: 143980, efficiency: 8.1, weeklyKm: [180, 320], status: "UNDER_REPAIR" },
  { plate: "SAH 0099", property: "EMD-SV-099", description: "Mitsubishi Adventure (for disposal)", make: "Mitsubishi", model: "Adventure", year: 2009, classification: "Service Vehicle", fuel: "DIESEL", office: "EMD", custodian: "—", tank: 55, odometer: 288400, efficiency: 8.0, weeklyKm: [0, 0], status: "RETIRED" },
];

async function seedDemo() {
  if ((await prisma.vehicle.count()) > 0) {
    console.log("Vehicles already exist; skipping demo data.");
    return;
  }
  console.log("Loading demo data…");
  const role = async (code: string) => (await prisma.role.findUniqueOrThrow({ where: { code: code as never } })).id;
  const offices = Object.fromEntries(
    await Promise.all(
      [
        ["EMD", "Equipment Management Division"],
        ["MAINT", "Maintenance Section"],
        ["CONS", "Construction Division"],
        ["PLAN", "Planning and Design Division"],
        ["ADMIN", "Administrative Division"],
        ["QA", "Quality Assurance and Hydrology Division"],
      ].map(async ([code, name]) => [code, await prisma.office.create({ data: { code, name } })]),
    ),
  );
  const demoPw = await hashPassword("Fueltrack2026");
  const mkUser = async (username: string, fullName: string, position: string, office: string, roles: string[], email?: string) => {
    const u = await prisma.user.create({ data: { username, fullName, position, officeId: offices[office].id, passwordHash: demoPw, email: email ?? `${username}@example.gov.ph` } });
    for (const r of roles) await prisma.userRole.create({ data: { userId: u.id, roleId: await role(r) } });
    return u;
  };
  const approver = await mkUser("rlomague", "Rachelle G. Lomague", "Chief, Equipment Management Division", "EMD", ["APPROVER"]);
  const approver2 = await mkUser("emanalo", "Eduardo P. Manalo", "Chief, Construction Division", "CONS", ["APPROVER", "REQUESTER"]);
  const custodian = await mkUser("lcollado", "Leila L. Collado", "Fuel Custodian, SPMS", "ADMIN", ["CUSTODIAN"]);
  const custodian2 = await mkUser("bsoriano", "Benjie T. Soriano", "Fuel Encoder", "EMD", ["CUSTODIAN", "REQUESTER"]);
  const req1 = await mkUser("jdelacruz", "Juan M. Dela Cruz", "Engineer II", "MAINT", ["REQUESTER"]);
  const req2 = await mkUser("mreyes", "Maria Theresa S. Reyes", "Engineer III", "CONS", ["REQUESTER"]);
  const req3 = await mkUser("pnavarro", "Paolo R. Navarro", "Engineering Assistant", "QA", ["REQUESTER"]);
  const req4 = await mkUser("jcastillo", "Jerome A. Castillo", "Engineer I", "PLAN", ["REQUESTER"]);
  const req5 = await mkUser("lfernandez", "Liza B. Fernandez", "Administrative Officer IV", "ADMIN", ["REQUESTER"]);
  const req6 = await mkUser("rvillanueva", "Ramon D. Villanueva", "Mechanic III", "EMD", ["REQUESTER"]);
  const former = await prisma.user.create({ data: { username: "former.staff", fullName: "Former Staff Member", position: "Driver", officeId: offices.EMD.id, passwordHash: demoPw, isActive: false } });
  await prisma.userRole.create({ data: { userId: former.id, roleId: await role("REQUESTER") } });
  await prisma.office.update({ where: { id: offices.EMD.id }, data: { defaultApproverId: approver.id } });
  await prisma.office.update({ where: { id: offices.CONS.id }, data: { defaultApproverId: approver2.id } });
  const requesterFor: Record<string, number> = { EMD: req6.id, MAINT: req1.id, CONS: req2.id, PLAN: req4.id, ADMIN: req5.id, QA: req3.id };
  const approverFor = (office: string, requesterId: number) => (office === "CONS" && requesterId !== approver2.id ? approver2.id : approver.id);
  const fuel = Object.fromEntries((await prisma.fuelType.findMany()).map((f) => [f.code, f]));

  const today = manilaToday();
  const startDay = addDays(today, -182);
  const priceOn = (code: string, day: string) => {
    const t = (Date.parse(day) - Date.parse(startDay)) / (182 * 86400_000);
    return r2((code === "DIESEL" ? 57.4 : 62.1) + t * 4.2 + Math.sin(t * 9) * 0.9);
  };
  const at = (day: string) => new Date(Date.parse(`${day}T00:00:00+08:00`) + Math.floor(between(7.5, 16)) * 3600_000 + Math.floor(between(0, 59)) * 60_000);
  const stations = ["Petron Bauang", "Shell San Fernando", "Caltex Sevilla", "Phoenix Carlatan", "Petron Agoo"];

  for (const spec of VEHICLES) {
    const v = await prisma.vehicle.create({
      data: {
        plateNumber: spec.plate,
        propertyNumber: spec.property,
        description: spec.description,
        make: spec.make,
        model: spec.model,
        year: spec.year,
        classification: spec.classification,
        fuelTypeId: fuel[spec.fuel].id,
        officeId: offices[spec.office].id,
        custodianName: spec.custodian,
        tankCapacityLiters: spec.tank,
        registrationExpiry: dateOnly(addDays(today, Math.floor(between(-20, 300)))),
        lastMaintenanceDate: dateOnly(addDays(today, -Math.floor(between(10, 80)))),
        nextMaintenanceDate: dateOnly(addDays(today, Math.floor(between(5, 90)))),
        maintenanceNotes: spec.status === "UNDER_REPAIR" ? "Transmission overhaul at the EMD motorpool." : "Preventive maintenance on schedule.",
        status: spec.status ?? "ACTIVE",
        remarks: spec.status === "RETIRED" ? "Recommended for disposal (IIRUP prepared)." : null,
      },
    });
    let odo = spec.odometer;
    const logIds: number[] = [];
    await prisma.odometerLog.create({
      data: {
        recordNumber: await nextNumber(prisma, "OD"),
        vehicleId: v.id,
        source: "INITIAL_REGISTRATION",
        readingDate: at(startDay),
        isFullTank: true,
        actualOdometer: odo,
        actualRecordedAt: at(startDay),
        readingType: "ACTUAL",
        verificationStatus: "VERIFIED",
        encodedById: custodian.id,
        verifiedById: approver.id,
        verifiedAt: at(startDay),
        estimateStatus: "NOT_APPLICABLE",
        remarks: "Baseline reading at system start (full tank)",
      },
    });
    if (spec.status === "RETIRED") {
      await refreshVehicleOdometer(prisma, v.id);
      continue;
    }
    const lastDay = spec.status === "UNDER_REPAIR" ? addDays(today, -40) : addDays(today, -1);
    let day = addDays(startDay, Math.floor(between(3, 7)));
    let n = 0;
    while (day <= lastDay) {
      n++;
      const isRecent = day > addDays(today, -6);
      const km = between(spec.weeklyKm[0], spec.weeklyKm[1]);
      let eff = spec.efficiency * between(0.92, 1.08);
      if (spec.anomaly === "HIGH_CONSUMPTION" && day > addDays(today, -24)) eff = spec.efficiency * 0.62;
      const liters = Math.min(spec.tank, r2(km / eff));
      const distance = r1(liters * eff);
      odo = r1(odo + distance);
      const price = priceOn(spec.fuel, day);
      const office = spec.office;
      const requesterId = requesterFor[office];
      const txAt = at(day);
      const reqDay = addDays(day, -Math.floor(between(0, 2)));
      const requested = r2(Math.min(spec.tank, Math.ceil(liters / 5) * 5));
      const r = await prisma.fuelRequest.create({
        data: {
          requestNumber: await nextNumber(prisma, "FR"),
          requestDate: dateOnly(reqDay),
          requesterId,
          officeId: offices[office].id,
          purpose: ["Road inspection along Bauang–Naguilian Road", "Hauling of aggregates for slope protection", "Transport of personnel to project site", "Delivery of materials to Agoo sub-office", "Monitoring of flood control project", "Water delivery for road maintenance"][Math.floor(between(0, 6))],
          destination: ["San Fernando City", "Bauang", "Naguilian", "Agoo", "Bacnotan", "Rosario"][Math.floor(between(0, 6))],
          travelDate: dateOnly(day),
          vehicleId: v.id,
          fuelTypeId: v.fuelTypeId,
          requestedLiters: requested,
          approvedLiters: liters,
          issuedLiters: liters,
          estimatedPricePerLiter: price,
          estimatedTotalCost: computeCost(requested, price),
          intendedFuelingDate: dateOnly(day),
          reason: "Regular operations",
          status: "FULLY_ISSUED",
          assignedApproverId: approverFor(office, requesterId),
          submittedAt: new Date(Date.parse(`${reqDay}T08:30:00+08:00`)),
          decidedAt: new Date(Date.parse(`${reqDay}T10:15:00+08:00`)),
          createdAt: new Date(Date.parse(`${reqDay}T08:20:00+08:00`)),
        },
      });
      await prisma.fuelRequestItem.create({ data: { requestId: r.id, fuelTypeId: v.fuelTypeId, liters: requested, pricePerLiter: price, lineTotal: r.estimatedTotalCost } });
      const appr = r.assignedApproverId!;
      await prisma.fuelApproval.createMany({
        data: [
          { requestId: r.id, action: "SUBMIT", previousStatus: "DRAFT", newStatus: "PENDING_APPROVAL", actedById: requesterId, createdAt: r.submittedAt! },
          { requestId: r.id, action: "APPROVE", previousStatus: "PENDING_APPROVAL", newStatus: "APPROVED", actedById: appr, approvedLiters: liters, remarks: liters < requested ? "Approved for the computed refill quantity" : null, createdAt: r.decidedAt! },
          { requestId: r.id, action: "ISSUE", previousStatus: "APPROVED", newStatus: "FULLY_ISSUED", actedById: custodian.id, remarks: `Issued ${liters} of ${liters} L`, createdAt: txAt },
        ],
      });
      // Odometer recording pattern, including deliberate gaps and anomalies for the demo.
      let actual: number | null = odo;
      if (spec.anomaly === "MISSING_READINGS" && n % 3 === 0) actual = null;
      else if (rand() < 0.07) actual = null;
      const lastOne = addDays(day, 7) > lastDay;
      if (spec.anomaly === "LOWER_READING" && lastOne) actual = r1(odo - distance - 140); // typo-like entry lower than previous
      const t = await prisma.fuelTransaction.create({
        data: {
          transactionNumber: await nextNumber(prisma, "FT"),
          requestId: r.id,
          transactionDate: txAt,
          vehicleId: v.id,
          fuelTypeId: v.fuelTypeId,
          requestedLiters: requested,
          approvedLiters: liters,
          litersIssued: liters,
          pricePerLiter: price,
          totalCost: computeCost(liters, price),
          odometerReading: actual,
          isFullTank: true,
          station: stations[Math.floor(between(0, stations.length))],
          receiptNumber: rand() < 0.93 ? `OR-${Math.floor(between(100000, 999999))}` : null,
          encodedById: rand() < 0.7 ? custodian.id : custodian2.id,
          verifiedById: isRecent ? null : approver.id,
          verifiedAt: isRecent ? null : new Date(txAt.getTime() + 86400_000),
          createdAt: txAt,
        },
      });
      const verified = actual !== null && !isRecent && !(spec.anomaly === "LOWER_READING" && lastOne);
      const log = await prisma.odometerLog.create({
        data: {
          recordNumber: await nextNumber(prisma, "OD"),
          vehicleId: v.id,
          transactionId: t.id,
          source: "FUEL_TRANSACTION",
          readingDate: txAt,
          isFullTank: true,
          fuelLiters: liters,
          actualOdometer: actual,
          actualRecordedAt: actual === null ? null : txAt,
          readingType: actual === null ? "ESTIMATED" : "ACTUAL",
          verificationStatus: verified ? "VERIFIED" : "PENDING",
          encodedById: t.encodedById,
          verifiedById: verified ? approver.id : null,
          verifiedAt: verified ? new Date(txAt.getTime() + 86400_000) : null,
          createdAt: txAt,
        },
      });
      logIds.push(log.id);
      day = addDays(day, Math.floor(between(5, 10)));
    }
    for (const id of logIds) await applyComputed(prisma, id);
    await refreshVehicleOdometer(prisma, v.id);
  }

  // Open requests in every workflow state.
  const veh = Object.fromEntries((await prisma.vehicle.findMany()).map((v) => [v.plateNumber, v]));
  const open: { plate: string; requester: number; status: RequestStatus; liters: number; purpose: string; reason?: string; issued?: number }[] = [
    { plate: "SAB 1234", requester: req6.id, status: "PENDING_APPROVAL", liters: 60, purpose: "Inspection of Naguilian Road slope protection works" },
    { plate: "SKL 2210", requester: req2.id, status: "PENDING_APPROVAL", liters: 180, purpose: "Hauling of boulders for Aringay river control" },
    { plate: "SKL 2210", requester: req2.id, status: "PENDING_APPROVAL", liters: 180, purpose: "Hauling of boulders for Aringay river control (re-filed)" },
    { plate: "SAD 9012", requester: req5.id, status: "APPROVED", liters: 35, purpose: "Delivery of documents to the Central Office liaison" },
    { plate: "SKL 2211", requester: req1.id, status: "READY_FOR_ISSUANCE", liters: 120, purpose: "Pothole patching along Manila North Road" },
    { plate: "SKM 7788", requester: req1.id, status: "PARTIALLY_ISSUED", liters: 150, purpose: "Installation of streetlight posts, Bauang", issued: 80 },
    { plate: "SAE 3456", requester: req4.id, status: "RETURNED", liters: 70, purpose: "Survey of proposed bypass road alignment", reason: "Attach the approved travel order and state the destination." },
    { plate: "SAC 5678", requester: req5.id, status: "REJECTED", liters: 55, purpose: "Personal errand", reason: "Purpose is not official business." },
    { plate: "MC 4521", requester: req3.id, status: "DRAFT", liters: 4, purpose: "Water level monitoring, Bauang River" },
    { plate: "SKL 2212", requester: req2.id, status: "CANCELLED", liters: 140, purpose: "Hauling of filling materials", reason: "Activity rescheduled." },
  ];
  for (const o of open) {
    const v = veh[o.plate];
    const price = Number(fuel[v.fuelTypeId === fuel.DIESEL.id ? "DIESEL" : "GASOLINE"].defaultPricePerLiter);
    const submitted = o.status !== "DRAFT";
    const decided = !["DRAFT", "PENDING_APPROVAL", "CANCELLED"].includes(o.status);
    const approverId = approverFor(v.officeId === offices.CONS.id ? "CONS" : "EMD", o.requester);
    const submittedAt = new Date(Date.now() - between(2, 20) * 3600_000);
    const dup = o.plate === "SKL 2210";
    const r = await prisma.fuelRequest.create({
      data: {
        requestNumber: await nextNumber(prisma, "FR"),
        requestDate: dateOnly(today),
        requesterId: o.requester,
        officeId: v.officeId,
        purpose: o.purpose,
        destination: "La Union",
        travelDate: dateOnly(addDays(today, 2)),
        vehicleId: v.id,
        fuelTypeId: v.fuelTypeId,
        requestedLiters: o.liters,
        approvedLiters: decided && o.status !== "REJECTED" && o.status !== "RETURNED" ? o.liters : null,
        issuedLiters: o.issued ?? 0,
        estimatedPricePerLiter: price,
        estimatedTotalCost: computeCost(o.liters, price),
        intendedFuelingDate: dateOnly(addDays(today, 1)),
        reason: "Scheduled field activity",
        odometerAtRequest: v.currentOdometer,
        status: o.status,
        assignedApproverId: submitted ? approverId : null,
        submittedAt: submitted ? submittedAt : null,
        decidedAt: decided ? new Date(submittedAt.getTime() + 3600_000) : null,
        flaggedForReview: dup && o.purpose.includes("re-filed"),
        flagReasons: dup && o.purpose.includes("re-filed") ? ["Another open request for this vehicle was submitted within 24 hours"] : [],
      },
    });
    await prisma.fuelRequestItem.create({ data: { requestId: r.id, fuelTypeId: v.fuelTypeId, liters: o.liters, pricePerLiter: price, lineTotal: r.estimatedTotalCost } });
    const hist: { action: string; previousStatus: RequestStatus | null; newStatus: RequestStatus; actedById: number; reason?: string; createdAt: Date }[] = [];
    if (submitted) hist.push({ action: "SUBMIT", previousStatus: "DRAFT", newStatus: "PENDING_APPROVAL", actedById: o.requester, createdAt: submittedAt });
    const later = new Date(submittedAt.getTime() + 3600_000);
    if (o.status === "CANCELLED") hist.push({ action: "CANCEL", previousStatus: "PENDING_APPROVAL", newStatus: "CANCELLED", actedById: o.requester, reason: o.reason, createdAt: later });
    if (o.status === "REJECTED") hist.push({ action: "REJECT", previousStatus: "PENDING_APPROVAL", newStatus: "REJECTED", actedById: approverId, reason: o.reason, createdAt: later });
    if (o.status === "RETURNED") hist.push({ action: "RETURN", previousStatus: "PENDING_APPROVAL", newStatus: "RETURNED", actedById: approverId, reason: o.reason, createdAt: later });
    if (["APPROVED", "READY_FOR_ISSUANCE", "PARTIALLY_ISSUED"].includes(o.status)) hist.push({ action: "APPROVE", previousStatus: "PENDING_APPROVAL", newStatus: "APPROVED", actedById: approverId, createdAt: later });
    if (o.status === "READY_FOR_ISSUANCE") hist.push({ action: "READY", previousStatus: "APPROVED", newStatus: "READY_FOR_ISSUANCE", actedById: custodian.id, createdAt: new Date(later.getTime() + 600_000) });
    for (const h of hist) await prisma.fuelApproval.create({ data: { requestId: r.id, ...h } });
    if (o.status === "PARTIALLY_ISSUED" && o.issued) {
      const txAt = new Date(later.getTime() + 1800_000);
      const t = await prisma.fuelTransaction.create({
        data: {
          transactionNumber: await nextNumber(prisma, "FT"),
          requestId: r.id,
          transactionDate: txAt,
          vehicleId: v.id,
          fuelTypeId: v.fuelTypeId,
          requestedLiters: o.liters,
          approvedLiters: o.liters,
          litersIssued: o.issued,
          pricePerLiter: price,
          totalCost: computeCost(o.issued, price),
          odometerReading: null,
          isFullTank: false,
          station: "Petron Bauang",
          receiptNumber: null,
          remarks: "Station supply limited; balance to follow",
          encodedById: custodian.id,
        },
      });
      await prisma.fuelApproval.create({ data: { requestId: r.id, action: "ISSUE", previousStatus: "APPROVED", newStatus: "PARTIALLY_ISSUED", actedById: custodian.id, remarks: `Issued ${o.issued} of ${o.liters} L`, createdAt: txAt } });
      const log = await prisma.odometerLog.create({
        data: { recordNumber: await nextNumber(prisma, "OD"), vehicleId: v.id, transactionId: t.id, source: "FUEL_TRANSACTION", readingDate: txAt, isFullTank: false, fuelLiters: o.issued, readingType: "ESTIMATED", encodedById: custodian.id },
      });
      await applyComputed(prisma, log.id);
    }
    if (o.status === "PENDING_APPROVAL")
      await prisma.notification.create({ data: { userId: approverId, type: "PENDING_APPROVAL", title: `Request ${r.requestNumber} awaits approval`, message: `${o.liters} L for ${o.plate}.`, link: `/requests/${r.id}` } });
    if (o.status === "RETURNED")
      await prisma.notification.create({ data: { userId: o.requester, type: "REQUEST_RETURNED", title: `Request ${r.requestNumber} returned for revision`, message: o.reason ?? "", link: `/requests/${r.id}` } });
  }
  void approver2;
  await audit(prisma, { userId: null, action: "DEMO_DATA_LOADED", module: "SYSTEM", recordId: "seed", after: { vehicles: VEHICLES.length } });
  console.log("Demo data loaded. Demo accounts use the password Fueltrack2026 (change or delete them before production use).");
}

async function main() {
  await seedBase();
  if (process.env.SEED_DEMO_DATA === "true") await seedDemo();
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
