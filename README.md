# FUELTRACK — Fuel Request and Odometer Monitoring System

**Fuel Management, Vehicle Utilization, and Consumption Monitoring** for a government office fleet.

FUELTRACK covers fuel use end to end: staff request fuel, approving officers decide, and custodians record the fuel actually dispensed. Each issuance updates an odometer log. Where no reading was taken, the log estimates the odometer by ratio and proportion from verified history, always kept separate from actual readings. Dashboards, consumption alerts, reports and a tamper-proof audit trail sit on top of the same records.

## Features

| Module | Highlights |
|---|---|
| Authentication | Session sign-in (bcrypt, PostgreSQL session store), lockout after 5 failures, forced password change, role-based access enforced by the API |
| Dashboard | 8 live summary cards, filters (date range, vehicle, fuel type, status), monthly consumption / expenditure, consumption by vehicle, requests by status, efficiency (km/L), recent requests, pending approvals, alerts |
| Fuel requests | Sectioned form with automatic vehicle details, latest verified odometer and warnings, live cost (liters × price), draft / submit / clear / cancel, confirmation summary, attachments, duplicate-safe submission and screening |
| Approval workflow | Draft → Pending Approval → Approved / Rejected / Returned → Ready for Issuance → Partially / Fully Issued, or Cancelled; approver assignment per office; history with previous/new status, actor, time, remarks and reasons; no self-approval |
| Fuel transaction log | Actual issuance separate from requested and approved quantities, cost computed server-side, receipts, verification, correction by supersession, cancellation with reason, no deletes, export |
| Odometer log | Actual vs estimated readings, step-by-step calculation panel, record / correct actual (original preserved), verify / flag, manual readings, flags for decreasing or inconsistent readings, km and % differences |
| Vehicles | Registry with unique plate and property numbers; detail page with fuel history, odometer history, requests, verified intervals, approved efficiency references, maintenance |
| Consumption monitoring | Requested / approved / issued / cost, latest actual and estimated odometer, verified and estimated distance, historical km/L, cost per km, vehicle comparison, configurable alerts |
| Reports | 14 reports with filters, preview, print layout, CSV / Excel / PDF export |
| Administration | Users and multiple roles, offices with default approvers, fuel types, configurable rules and thresholds, audit trail with before/after values, in-app notifications |

## Technology

- **API**: Node.js, Express 5, TypeScript, Prisma 7 with PostgreSQL, Zod validation, Helmet, rate limiting, ExcelJS and PDFKit.
- **Web**: React 19, TypeScript, Vite, Tailwind CSS 4, TanStack Query, React Router, React Hook Form and Zod, Recharts.
- **Tests**: Vitest and Supertest against a real PostgreSQL test database.

```
server/   API, Prisma schema and migrations, seed, tests
client/   web application
docs/     calculation method, admin guide, deployment
```

## Go live

The easiest way to put FUELTRACK online, with no programming, is the step-by-step guide **[docs/GO_LIVE.md](docs/GO_LIVE.md)**. It uses the included `render.yaml` and a one-click *Deploy to Render* button.

## Quick start (developers)

```bash
npm install
cp .env.example server/.env        # set DATABASE_URL, TEST_DATABASE_URL, SESSION_SECRET, SEED_ADMIN_PASSWORD
npm run db:deploy && npm run db:seed
npm run dev                        # http://localhost:5173
npm test
```

Full instructions: [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md).

### Demo accounts (`SEED_DEMO_DATA=true` only)

| Username | Role | Password |
|---|---|---|
| `admin` | Administrator | value of `SEED_ADMIN_PASSWORD` |
| `rlomague` | Approving Officer (EMD and default) | `Fueltrack2026` |
| `emanalo` | Approving Officer + Requester (Construction) | `Fueltrack2026` |
| `lcollado` | Fuel Custodian / Encoder | `Fueltrack2026` |
| `bsoriano` | Fuel Custodian + Requester | `Fueltrack2026` |
| `jdelacruz`, `mreyes`, `pnavarro`, `jcastillo`, `lfernandez`, `rvillanueva` | Requesters in different offices | `Fueltrack2026` |

The demo data is fictional sample data: offices, 12 vehicles and about six months of fuel history. It includes an actual reading lower than the previous one, a vehicle with high consumption, missing readings, a duplicate-looking request, and requests in every workflow state.

## Documentation

- [Odometer calculation method](docs/ODOMETER_CALCULATION.md): ratio and proportion, reference intervals, consumption basis, rules and limitations
- [Administrator guide](docs/ADMIN_GUIDE.md): roles, offices, vehicles, settings, corrections, audit
- [Go live without programming (Render)](docs/GO_LIVE.md)
- [Installation and deployment](docs/DEPLOYMENT.md): environment, production, Docker, backups and restore, security checklist

## Automated tests

`npm test` runs 52 tests:

- **Calculations**: cost; the 40 L / 320 km / 25 L specification case giving 8 km/L, 200 km and 25,520 km labelled as an estimate; insufficient data; zero-quantity refusal; interval attribution; rolling average; decreasing-reading and variance checks.
- **API**: login, lockout, inactive accounts; unauthorized and cross-role access; CSRF header; request submission and validation; duplicate prevention and flagging; approve / reject / return / resubmit; no self-approval; partial and full issuance with limits; correction by supersession; actual vs estimated comparison; correction of actual readings preserving the original; large-variance alerts; historical efficiency; report filtering and CSV / Excel / PDF export; document upload validation and storage; audit creation and immutability; dashboard figures from the database.

## Known limitations

- Odometer estimation assumes kilometres. Equipment tracked by hour meters is not modelled.
- Notifications are in-app only (no email or SMS).
- The web client has no automated UI tests. It was checked manually in a headless browser (desktop and mobile) through the request → approval → issuance → odometer flow.
- Requests carry one fuel type per vehicle. The `fuel_request_items` table is in place for multi-item requests, but the form does not offer them.
- The Docker files were not built in the development environment.
- Before production use: configure it for the office, run user acceptance testing, and get an independent security review.
