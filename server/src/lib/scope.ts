import type { Prisma } from "../db.js";
import { can, type AuthUser } from "../middleware/auth.js";

/** Requesters see the vehicles of their own office (or assigned to them); other roles see the fleet. */
export function vehicleScope(user: AuthUser): Prisma.VehicleWhereInput {
  if (can(user, "vehicle.manage") || can(user, "transaction.view") || can(user, "request.view_all") || can(user, "request.view_assigned")) return {};
  if (!user.officeId) return {};
  return { OR: [{ officeId: user.officeId }, { custodianUserId: user.id }] };
}
