// Reference data every installation needs: roles, fuel types, default settings
// and the first administrator. Safe to run repeatedly (existing rows are kept).
import { prisma } from "../db.js";
import { audit } from "./audit.js";
import { hashPassword } from "./password.js";
import { SETTING_DEFS } from "./settings.js";

const ROLES = [
  { code: "ADMIN", name: "Administrator", description: "Full access to every module" },
  { code: "REQUESTER", name: "Requester", description: "Creates and tracks fuel requests" },
  { code: "APPROVER", name: "Approving Officer", description: "Approves, rejects or returns fuel requests" },
  { code: "CUSTODIAN", name: "Fuel Custodian / Encoder", description: "Records actual fuel issuance and odometer readings" },
] as const;

export async function seedBase() {
  for (const r of ROLES) await prisma.role.upsert({ where: { code: r.code }, update: { name: r.name, description: r.description }, create: r });
  for (const ft of [
    { code: "DIESEL", name: "Diesel", defaultPricePerLiter: 61.25 },
    { code: "GASOLINE", name: "Gasoline", defaultPricePerLiter: 65.8 },
    { code: "PREMIUM", name: "Premium Gasoline", defaultPricePerLiter: 70.15 },
  ])
    await prisma.fuelType.upsert({ where: { code: ft.code }, update: {}, create: ft });
  for (const [key, def] of Object.entries(SETTING_DEFS))
    await prisma.systemSetting.upsert({ where: { key }, update: {}, create: { key, value: def.default as never, description: def.label } });

  const username = (process.env.SEED_ADMIN_USERNAME ?? "admin").toLowerCase();
  const password = process.env.SEED_ADMIN_PASSWORD;
  if (!password || password.length < 10) throw new Error("Set SEED_ADMIN_PASSWORD (at least 10 characters) before seeding");
  const existing = await prisma.user.findUnique({ where: { username } });
  if (!existing) {
    const adminRole = await prisma.role.findUniqueOrThrow({ where: { code: "ADMIN" } });
    const u = await prisma.user.create({
      data: { username, fullName: "System Administrator", passwordHash: await hashPassword(password), mustChangePassword: process.env.SEED_DEMO_DATA !== "true", position: "System Administrator" },
    });
    await prisma.userRole.create({ data: { userId: u.id, roleId: adminRole.id } });
    await audit(prisma, { userId: null, action: "USER_CREATED", module: "USER", recordId: username, after: { roles: ["ADMIN"], source: "seed" } });
    console.log(`Created administrator account "${username}"`);
  }
}
