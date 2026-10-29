// Role → permission map. Permissions are checked on every API route (see
// middleware/auth.ts); the client only uses them to decide what to show.
export const ROLE_CODES = ["ADMIN", "REQUESTER", "APPROVER", "CUSTODIAN"] as const;
export type Role = (typeof ROLE_CODES)[number];

export const PERMISSIONS = [
  "dashboard.view",
  "request.create",
  "request.view_own",
  "request.view_assigned",
  "request.view_issuable",
  "request.view_all",
  "request.approve",
  "request.cancel_any",
  "transaction.view",
  "transaction.create",
  "transaction.correct",
  "transaction.verify",
  "odometer.view",
  "odometer.record",
  "odometer.verify",
  "efficiency.approve",
  "vehicle.view",
  "vehicle.manage",
  "monitoring.view",
  "report.view",
  "report.export",
  "user.manage",
  "settings.manage",
  "audit.view",
] as const;
export type Permission = (typeof PERMISSIONS)[number];

export const ROLE_PERMISSIONS: Record<Role, Permission[]> = {
  ADMIN: [...PERMISSIONS],
  REQUESTER: ["dashboard.view", "request.create", "request.view_own", "vehicle.view"],
  APPROVER: [
    "dashboard.view",
    "request.view_own",
    "request.view_assigned",
    "request.approve",
    "vehicle.view",
    "odometer.view",
    "odometer.verify",
    "transaction.view",
    "transaction.verify",
    "monitoring.view",
    "report.view",
    "report.export",
  ],
  CUSTODIAN: [
    "dashboard.view",
    "request.view_own",
    "request.view_issuable",
    "transaction.view",
    "transaction.create",
    "transaction.correct",
    "odometer.view",
    "odometer.record",
    "vehicle.view",
    "monitoring.view",
    "report.view",
    "report.export",
  ],
};

export const ROLE_LABELS: Record<Role, string> = {
  ADMIN: "Administrator",
  REQUESTER: "Requester",
  APPROVER: "Approving Officer",
  CUSTODIAN: "Fuel Custodian / Encoder",
};

export function permissionsFor(roles: readonly string[]): Permission[] {
  const set = new Set<Permission>();
  for (const r of roles) for (const p of ROLE_PERMISSIONS[r as Role] ?? []) set.add(p);
  return [...set];
}
