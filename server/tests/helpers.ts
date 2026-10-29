import request from "supertest";
import { createApp } from "../src/app.js";
import { prisma } from "../src/db.js";
import { hashPassword } from "../src/lib/password.js";
import { SETTING_DEFS } from "../src/lib/settings.js";

export const app = createApp();
export const PASSWORD = "TestPass2026";
let counter = 0;

/** Truncate every table except migrations, then load roles, settings and fuel types. */
export async function resetDb() {
  const tables = await prisma.$queryRaw<{ tablename: string }[]>`SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'`;
  // Triggers block deletes on history tables; TRUNCATE bypasses row triggers (test database only).
  await prisma.$executeRawUnsafe(`TRUNCATE ${tables.map((t) => `"${t.tablename}"`).join(", ")} RESTART IDENTITY CASCADE`);
  for (const code of ["ADMIN", "REQUESTER", "APPROVER", "CUSTODIAN"] as const) await prisma.role.create({ data: { code, name: code } });
  for (const [key, def] of Object.entries(SETTING_DEFS)) await prisma.systemSetting.create({ data: { key, value: def.default as never } });
  const diesel = await prisma.fuelType.create({ data: { code: "DIESEL", name: "Diesel", defaultPricePerLiter: 60 } });
  const gasoline = await prisma.fuelType.create({ data: { code: "GASOLINE", name: "Gasoline", defaultPricePerLiter: 65 } });
  const office = await prisma.office.create({ data: { code: "EMD", name: "Equipment Management Division" } });
  const other = await prisma.office.create({ data: { code: "PLAN", name: "Planning Division" } });
  return { diesel, gasoline, office, other };
}

export async function makeUser(roles: ("ADMIN" | "REQUESTER" | "APPROVER" | "CUSTODIAN")[], officeId: number | null, extra: { isActive?: boolean } = {}) {
  counter++;
  const u = await prisma.user.create({
    data: { username: `user${counter}`, fullName: `${roles.join("+")} User ${counter}`, passwordHash: await hashPassword(PASSWORD), officeId, isActive: extra.isActive ?? true },
  });
  for (const code of roles) {
    const role = await prisma.role.findUniqueOrThrow({ where: { code } });
    await prisma.userRole.create({ data: { userId: u.id, roleId: role.id } });
  }
  return u;
}

/** A logged-in supertest agent that sends the anti-forgery header. */
export async function login(username: string, password = PASSWORD) {
  const agent = request.agent(app);
  const res = await agent.post("/api/auth/login").set("X-Requested-With", "FuelTrack").send({ username, password });
  if (res.status !== 200) throw new Error(`login failed: ${res.status} ${JSON.stringify(res.body)}`);
  const h = { "X-Requested-With": "FuelTrack" };
  return {
    agent,
    get: (url: string) => agent.get(url),
    post: (url: string, body?: object) => agent.post(url).set(h).send(body ?? {}),
    put: (url: string, body?: object) => agent.put(url).set(h).send(body ?? {}),
  };
}

export type Client = Awaited<ReturnType<typeof login>>;

export async function registerVehicle(admin: Client, overrides: Record<string, unknown> = {}) {
  counter++;
  const res = await admin.post("/api/vehicles", {
    plateNumber: `TST ${1000 + counter}`,
    description: "Test pick-up",
    classification: "Service Vehicle",
    initialOdometer: 25000,
    tankCapacityLiters: 80,
    ...overrides,
  });
  if (res.status !== 201) throw new Error(`vehicle: ${res.status} ${JSON.stringify(res.body)}`);
  return res.body as { id: number; plateNumber: string };
}

export const isoHoursAgo = (hours: number) => new Date(Date.now() - hours * 3600_000).toISOString();

/** A Manila calendar date `days` from today. */
export function futureDate(days: number) {
  return new Date(Date.now() + 8 * 3600_000 + days * 86400_000).toISOString().slice(0, 10);
}
