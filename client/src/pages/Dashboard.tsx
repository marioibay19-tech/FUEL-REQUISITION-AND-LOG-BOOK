import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, CheckCircle2, ClipboardList, Clock, Coins, Fuel, Gauge, Truck } from "lucide-react";
import { Link, useNavigate } from "react-router";
import { ChartCard, ColumnChart, RankChart, SERIES } from "../components/charts";
import { Badge, ButtonLink, Card, DataTable, EmptyState, ErrorState, FilterBar, FilterField, PageHeader, Spinner, StatusBadge, SummaryCard, REQUEST_STATUS } from "../components/ui";
import { api } from "../lib/api";
import { useAuth } from "../lib/auth";
import { dateOnly, dateTime, liters, manilaMonthStart, manilaToday, monthLabel, num, peso } from "../lib/format";
import { useFuelTypes, useListParams, useVehicleOptions } from "../lib/hooks";

interface Dashboard {
  period: { from: string; to: string };
  scope: "fleet" | "own";
  cards: { vehicles: number; requestsInPeriod: number; pending: number; approved: number; litersIssued: number; expenditure: number; transactions: number; needsVerification: number | null; highConsumption: number | null };
  charts: {
    monthly: ({ month: string; liters: number; cost: number } & Record<string, number | string>)[];
    fuelNames: string[];
    byVehicle: { plateNumber: string; liters: number; cost: number }[];
    byStatus: { status: string; label: string; count: number }[];
    efficiency: { plateNumber: string; efficiency: number; quality: string }[];
  };
  recent: { id: number; requestNumber: string; requestDate: string; plateNumber: string; requester: string; requestedLiters: number; status: string }[];
  pendingForMe: { id: number; requestNumber: string; submittedAt: string; plateNumber: string; requester: string; requestedLiters: number; flagged: boolean }[];
  alerts: { type: string; severity: string; plateNumber: string | null; message: string; link?: string }[];
  alertCount: number;
  verification: { vehicleId: number; plateNumber: string; pending: number; flagged: number; stale: boolean }[];
}

const compact = (v: number) => new Intl.NumberFormat("en-PH", { notation: "compact", maximumFractionDigits: 1 }).format(v);

export function SeverityIcon({ severity }: { severity: string }) {
  return severity === "critical" ? <AlertTriangle className="size-4 text-red-600" aria-label="Critical" /> : severity === "warning" ? <AlertTriangle className="size-4 text-amber-500" aria-label="Warning" /> : <AlertTriangle className="size-4 text-slate-400" aria-label="Information" />;
}

export default function DashboardPage() {
  const { user, can } = useAuth();
  const navigate = useNavigate();
  const defaults = { from: manilaMonthStart(), to: manilaToday(), vehicleId: "", fuelTypeId: "", status: "" };
  const { values, set, reset } = useListParams(defaults);
  const vehicles = useVehicleOptions();
  const fuelTypes = useFuelTypes();
  const q = useQuery({
    queryKey: ["dashboard", values.from, values.to, values.vehicleId, values.fuelTypeId, values.status],
    queryFn: () => api.get<Dashboard>("/dashboard", { from: values.from, to: values.to, vehicleId: values.vehicleId, fuelTypeId: values.fuelTypeId, status: values.status }),
  });
  const d = q.data;
  const fleet = d?.scope === "fleet";
  return (
    <div>
      <PageHeader
        title="Dashboard"
        subtitle={`Welcome, ${user?.fullName}. ${d ? (fleet ? "Fleet-wide figures" : "Figures for your own requests") : ""}`}
        actions={can("request.create") && <ButtonLink to="/requests/new" icon={<ClipboardList className="size-4" />}>New fuel request</ButtonLink>}
      />
      <div className="card mb-5 overflow-hidden">
        <FilterBar onReset={reset}>
          <FilterField label="From">
            <input type="date" className="input" value={values.from} max={values.to} onChange={(e) => set({ from: e.target.value })} />
          </FilterField>
          <FilterField label="To">
            <input type="date" className="input" value={values.to} min={values.from} onChange={(e) => set({ to: e.target.value })} />
          </FilterField>
          <FilterField label="Vehicle" className="min-w-[180px]">
            <select className="input" value={values.vehicleId} onChange={(e) => set({ vehicleId: e.target.value })}>
              <option value="">All vehicles</option>
              {vehicles.data?.map((v) => <option key={v.id} value={v.id}>{v.plateNumber} — {v.description}</option>)}
            </select>
          </FilterField>
          <FilterField label="Fuel type">
            <select className="input" value={values.fuelTypeId} onChange={(e) => set({ fuelTypeId: e.target.value })}>
              <option value="">All fuel types</option>
              {fuelTypes.data?.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
            </select>
          </FilterField>
          <FilterField label="Request status">
            <select className="input" value={values.status} onChange={(e) => set({ status: e.target.value })}>
              <option value="">All statuses</option>
              {Object.entries(REQUEST_STATUS).filter(([k]) => k !== "DRAFT").map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
            </select>
          </FilterField>
        </FilterBar>
      </div>
      {q.isLoading && <Spinner />}
      {q.error && <ErrorState error={q.error} />}
      {d && (
        <>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <SummaryCard label="Registered vehicles" value={num(d.cards.vehicles)} sub="Excluding retired units" icon={<Truck className="size-5" />} to={can("vehicle.view") ? "/vehicles" : undefined} />
            <SummaryCard label="Fuel requests (period)" value={num(d.cards.requestsInPeriod)} sub={`${dateOnly(d.period.from + "T00:00:00Z")} – ${dateOnly(d.period.to + "T00:00:00Z")}`} icon={<ClipboardList className="size-5" />} to={`/requests?from=${d.period.from}&to=${d.period.to}`} />
            <SummaryCard label="Pending approval" value={num(d.cards.pending)} sub="All open requests awaiting a decision" tone="amber" icon={<Clock className="size-5" />} to="/requests?status=PENDING_APPROVAL" />
            <SummaryCard label="Approved requests (period)" value={num(d.cards.approved)} sub="Approved, ready or issued" tone="green" icon={<CheckCircle2 className="size-5" />} />
            <SummaryCard label="Fuel issued (period)" value={liters(d.cards.litersIssued)} sub={`${num(d.cards.transactions)} actual transactions`} icon={<Fuel className="size-5" />} to={can("transaction.view") ? `/transactions?from=${d.period.from}&to=${d.period.to}` : undefined} />
            <SummaryCard label="Fuel expenditure (period)" value={peso(d.cards.expenditure)} sub="Actual cost of fuel issued" icon={<Coins className="size-5" />} />
            {d.cards.needsVerification !== null && <SummaryCard label="Vehicles needing odometer verification" value={num(d.cards.needsVerification)} sub="Pending / flagged records or stale readings" tone={d.cards.needsVerification ? "amber" : "slate"} icon={<Gauge className="size-5" />} to="/odometer?verificationStatus=PENDING" />}
            {d.cards.highConsumption !== null && <SummaryCard label="Vehicles with unusually high consumption" value={num(d.cards.highConsumption)} sub="Review recommended — not a conclusion" tone={d.cards.highConsumption ? "red" : "slate"} icon={<AlertTriangle className="size-5" />} to="/monitoring" />}
          </div>

          <div className="mt-5 grid gap-4 xl:grid-cols-2">
            <ChartCard
              title="Monthly fuel consumption"
              subtitle="Liters actually issued, 12 months to the end of the period"
              empty={!d.charts.monthly.some((m) => m.liters > 0)}
              table={{ columns: ["Month", ...d.charts.fuelNames, "Total (L)"], rows: d.charts.monthly.map((m) => [monthLabel(m.month), ...d.charts.fuelNames.map((n) => num(m[n] as number)), num(m.liters)]) }}
            >
              <ColumnChart data={d.charts.monthly} x="month" xFormat={monthLabel} stacked series={d.charts.fuelNames.map((n, i) => ({ key: n, name: n, color: SERIES[i] }))} format={(v) => `${compact(v)} L`} />
            </ChartCard>
            <ChartCard
              title="Monthly fuel expenditure"
              subtitle="Actual cost (PHP), 12 months to the end of the period"
              empty={!d.charts.monthly.some((m) => m.cost > 0)}
              table={{ columns: ["Month", "Expenditure"], rows: d.charts.monthly.map((m) => [monthLabel(m.month), peso(m.cost)]) }}
            >
              <ColumnChart data={d.charts.monthly} x="month" xFormat={monthLabel} series={[{ key: "cost", name: "Expenditure" }]} format={(v) => `₱${compact(v)}`} />
            </ChartCard>
            {fleet && (
              <ChartCard title="Fuel consumption by vehicle" subtitle="Top 10 by liters issued in the period" empty={!d.charts.byVehicle.length} table={{ columns: ["Vehicle", "Liters", "Cost"], rows: d.charts.byVehicle.map((v) => [v.plateNumber, num(v.liters), peso(v.cost)]) }}>
                <RankChart data={d.charts.byVehicle} y="plateNumber" value="liters" name="Liters issued" format={(v) => `${compact(v)} L`} />
              </ChartCard>
            )}
            <ChartCard title="Fuel requests by status" subtitle="Requests dated within the period" empty={!d.charts.byStatus.length} table={{ columns: ["Status", "Requests"], rows: d.charts.byStatus.map((s) => [s.label, s.count]) }}>
              <RankChart data={d.charts.byStatus} y="label" value="count" name="Requests" format={(v) => num(v, 0)} />
            </ChartCard>
            {fleet && (
              <ChartCard
                title="Fuel efficiency (km/L)"
                subtitle="Reference efficiency per vehicle from historical intervals"
                empty={!d.charts.efficiency.length}
                table={{ columns: ["Vehicle", "km/L", "Basis"], rows: d.charts.efficiency.map((e) => [e.plateNumber, num(e.efficiency), e.quality === "VERIFIED" ? "Verified" : "Estimated"]) }}
              >
                <RankChart
                  data={d.charts.efficiency}
                  y="plateNumber"
                  value="efficiency"
                  name="km/L"
                  format={(v) => num(v, 1)}
                  fillOf={(r) => (r.quality === "VERIFIED" ? SERIES[0] : "#9ec3ee")}
                  legend={[{ label: "Verified (full-tank intervals)", color: SERIES[0] }, { label: "Estimated", color: "#9ec3ee" }]}
                />
              </ChartCard>
            )}
          </div>

          <div className="mt-5 grid gap-4 xl:grid-cols-3">
            <Card title="Recent fuel requests" className="xl:col-span-2" bodyClass="p-0" actions={<Link to="/requests" className="text-xs font-medium text-navy-700 hover:underline">View all</Link>}>
              <DataTable
                rows={d.recent}
                rowKey={(r) => r.id}
                onRowClick={(r) => navigate(`/requests/${r.id}`)}
                empty="No requests yet."
                columns={[
                  { key: "no", header: "Request No.", cell: (r) => <span className="font-medium text-navy-800">{r.requestNumber}</span> },
                  { key: "date", header: "Date", cell: (r) => dateOnly(r.requestDate), hideOnMobile: true },
                  { key: "plate", header: "Plate No.", cell: (r) => r.plateNumber },
                  { key: "req", header: "Requester", cell: (r) => r.requester, hideOnMobile: true },
                  { key: "l", header: "Liters", align: "right", cell: (r) => num(r.requestedLiters) },
                  { key: "s", header: "Status", cell: (r) => <StatusBadge status={r.status} /> },
                ]}
              />
            </Card>
            <div className="space-y-4">
              {can("request.approve") && (
                <Card title="Pending approvals" subtitle={user?.roles.includes("ADMIN") ? "All pending requests" : "Assigned to you"} bodyClass="p-0">
                  {d.pendingForMe.length === 0 ? (
                    <EmptyState title="Nothing awaiting your decision." />
                  ) : (
                    <ul className="divide-y divide-slate-100">
                      {d.pendingForMe.map((r) => (
                        <li key={r.id}>
                          <Link to={`/requests/${r.id}`} className="flex items-center justify-between gap-2 px-4 py-2.5 hover:bg-slate-50">
                            <div>
                              <p className="text-sm font-medium text-navy-800">{r.requestNumber} {r.flagged && <Badge tone="red">Flagged</Badge>}</p>
                              <p className="text-xs text-slate-500">{r.plateNumber} · {r.requester} · {dateTime(r.submittedAt)}</p>
                            </div>
                            <span className="tabular text-sm text-slate-700">{liters(r.requestedLiters)}</span>
                          </Link>
                        </li>
                      ))}
                    </ul>
                  )}
                </Card>
              )}
              {fleet && (
                <Card title="Alerts" subtitle={`${d.alertCount} in the period`} bodyClass="p-0" actions={<Link to="/monitoring" className="text-xs font-medium text-navy-700 hover:underline">Monitoring</Link>}>
                  {d.alerts.length === 0 ? (
                    <EmptyState title="No alerts for the selected period." />
                  ) : (
                    <ul className="divide-y divide-slate-100">
                      {d.alerts.map((a, i) => (
                        <li key={i}>
                          <Link to={a.link ?? "/monitoring"} className="flex gap-2.5 px-4 py-2.5 hover:bg-slate-50">
                            <SeverityIcon severity={a.severity} />
                            <div className="min-w-0">
                              <p className="text-[13px] font-medium text-slate-800">{a.plateNumber}</p>
                              <p className="line-clamp-2 text-xs text-slate-600">{a.message}</p>
                            </div>
                          </Link>
                        </li>
                      ))}
                    </ul>
                  )}
                </Card>
              )}
              {fleet && d.verification.length > 0 && (
                <Card title="Odometer verification needed" bodyClass="p-0">
                  <ul className="divide-y divide-slate-100">
                    {d.verification.map((v) => (
                      <li key={v.vehicleId}>
                        <Link to={`/odometer?vehicleId=${v.vehicleId}`} className="flex items-center justify-between px-4 py-2 text-sm hover:bg-slate-50">
                          <span className="font-medium text-slate-800">{v.plateNumber}</span>
                          <span className="flex gap-1">
                            {v.pending > 0 && <Badge tone="amber">{v.pending} pending</Badge>}
                            {v.flagged > 0 && <Badge tone="red">{v.flagged} flagged</Badge>}
                            {v.stale && <Badge tone="slate">No recent verified reading</Badge>}
                          </span>
                        </Link>
                      </li>
                    ))}
                  </ul>
                </Card>
              )}
            </div>
          </div>
          <p className="mt-4 text-xs text-slate-400">All dates and times are shown in Asia/Manila time.</p>
        </>
      )}
    </div>
  );
}
