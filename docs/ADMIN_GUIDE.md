# Administrator setup guide

## 1. First sign-in

`npm run db:seed` creates the administrator account from `SEED_ADMIN_USERNAME` / `SEED_ADMIN_PASSWORD`. In production (`SEED_DEMO_DATA=false`) the account must change its password at first sign-in.

## 2. Reference data (System Settings)

1. **Organization**: the agency, office and address printed on report headers.
2. **Fuel types** tab: add or edit fuel types and their default price per liter. The default price pre-fills the estimated price on new requests; actual prices are entered at issuance. Deactivate a fuel type instead of deleting it.
3. **Offices and divisions** tab: add each office and choose its **default approving officer**. Requests from that office go to that officer. Without one, the system assigns the active approving officer with the fewest pending requests (never the requester).

## 3. Users and roles (User Management)

| Role | Can |
|---|---|
| Administrator | Everything, including users, settings, vehicles, approval of any pending request, audit trail |
| Requester | Create, edit (draft / returned), submit and cancel own requests; see own office's vehicles |
| Approving Officer | Approve / reject / return requests assigned to them; verify odometer records and transactions; view monitoring and reports |
| Fuel Custodian / Encoder | Mark approved requests ready, record actual issuance and odometer readings, correct / cancel own transactions, reports |

- A user can hold several roles (e.g. Approving Officer + Requester). No one can approve their own request unless *Allow approving officers to approve their own requests* is switched on.
- A requester's **office** decides which vehicles they can request fuel for. A vehicle's *custodian user account* also gives that user access.
- New users and password resets get a temporary password and must change it at next sign-in. Resetting a password signs the user out everywhere.
- **Deactivate** users who leave; their history stays. After 5 wrong passwords an account locks for 15 minutes; administrators can unlock it.
- At least one active administrator must always remain.

## 4. Vehicles

Register each vehicle with its **current odometer reading**. That reading becomes the verified baseline for estimates. Plate numbers and property / equipment numbers must be unique. Set the tank capacity so oversized requests are flagged. Change the status (Active, Under Repair, Inactive, Retired) rather than deleting. Only *Active* vehicles can be requested.

## 5. Workflow rules (System Settings → Workflow)

| Setting | Effect |
|---|---|
| Allow a different fuel type (with reason) | Off: requests must use the vehicle's fuel type. On: allowed with a reason and flagged for review |
| Require a supporting document | Requests cannot be submitted without an attachment |
| Require a receipt number for issuance | Issuance cannot be saved without a receipt / document number |
| Flag requests for the same vehicle within (hours) | Duplicate screening window |
| Latest intended fueling date (days) | Upper limit on the intended fueling date |
| Verifier must differ from the encoder | Separation of duties for odometer records and transactions |

## 6. Odometer estimation and alerts

See [ODOMETER_CALCULATION.md](ODOMETER_CALCULATION.md). Recommended practice:

1. Ask custodians to fill tanks to full and record the odometer at every fueling (tick *Tank filled to full*).
2. Have approving officers verify readings promptly. Only verified readings feed the efficiency figures.
3. Keep the default **Rolling average** method with a **Full tank to full tank** basis. Use **Approved reference** when a vehicle's history is unreliable (for example after an engine overhaul), and approve a reference on the Vehicle → Efficiency tab.
4. After changing the method, use **Recalculate vehicle estimates** in an odometer record's panel to refresh pending records.

Alert thresholds (high consumption, change between intervals, duplicate transactions, frequent requests) are under **Alerts**. Consumption alerts need a minimum number of verified intervals, so new vehicles are not judged on thin data.

## 7. Corrections and cancellations

Fuel transactions are never deleted, and the database refuses deletes. Use:

- **Correct**: creates a new transaction that replaces the old one. The old record stays as *Superseded* with the reason.
- **Cancel / reverse**: marks the transaction *Cancelled*, with a reason. Issued liters on the request and the odometer estimates are recalculated.

Approval history and audit records cannot be updated or deleted, not even directly in the database (enforced by triggers).

## 8. Audit trail

**Audit Trail** lists sign-ins (including failures), request changes and decisions, issuance, odometer records, corrections and verifications, estimate recalculations, report exports, settings changes and user / role changes. Open an entry to see the values before and after the change. Export it from the Audit Trail page or the *Audit Trail Report*.

## 9. Demo data

`SEED_DEMO_DATA=true` loads sample offices, users (password `Fueltrack2026`), 12 vehicles and about six months of history with deliberate anomalies. **Never enable it on a production database.** Delete or deactivate the demo accounts if they were loaded by mistake.
