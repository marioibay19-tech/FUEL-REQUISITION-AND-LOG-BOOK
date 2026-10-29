import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router";
import { ChartCard, ColumnChart, SERIES } from "../components/charts";
import { ExportButtons } from "../components/ExportMenu";
import { Badge, Card, DataTable, EmptyState, ErrorState, FilterBar, FilterField, Notice, PageHeader, Spinner, Tabs } from "../components/ui";
import { api } from "../lib/api";
import { useAuth } from "../lib/auth";
import { addDays, dateManila, km, kmpl, liters, manilaToday, num, peso } from "../lib/format";
import { useFuelTypes, useListParams, useOffices } from "../lib/hooks";
import { SeverityIcon } from "./Dashboard";

interface Row {
  vehicleId: number; plateNumber: string; description: string; classification: string; fuelType: string; office: string | null; status: string;
  totalRequested: number; totalApproved: number; totalIssued: number; totalExpenditure: number; transactions: number;
  latestActual: { odometer: number; at: string; verificationStatus: string } | null; latestEstimated: { odometer: number; at: string } | null;
  verifiedDistance: number; estimatedDistance: number; periodEfficiency: number | null; periodEfficiencyQuality: string | null;
  historicalEfficiency: number | null; historicalEfficiencyQuality: string | null; costPerKm: number | null; intervals: number;
}
interface Alert { type: string; severity: string; vehicleId: number | null; plateNumber: string | null; message: string; reference?: string; link?: string; dataQuality?: string; at?: string }

export default function MonitoringPage() {
  const { can } = useAuth();
  const defaults = { from: addDays(manilaToday(), -90), to: manilaToday(), officeId: "", fuelTypeId: "", tab: "vehicles", compare: "" };
  const { values, set, reset } = useListParams(defaults);
  const offices = useOffices();
  const fuelTypes = useFuelTypes();
  const params = { from: values.from, to: values.to, officeId: values.officeId, fuelTypeId: values.fuelTypeId };
  const stats = useQuery({ queryKey: ["monitoring", params], queryFn: () => api.get<{ rows: Row[] }>("/monitoring/vehicles", params) });
  const alerts = useQuery({ queryKey: ["alerts", values.from, values.to], queryFn: () => api.get<{ alerts: Alert[]; labels: Record<string, string>; thresholds: Record<string, number> }>("/monitoring/alerts", { from: values.from, to: values.to }) });
  const compare = values.compare ? values.compare.split(",").map(Number) : [];
  const toggle = (id: number) => set({ compare: (compare.includes(id) ? compare.filter((x) => x !== id) : [...compare, id].slice(-6)).join(",") });
  const rows = stats.data?.rows.filter((r) => r.status !== "RETIRED") ?? [];
  const chosen = rows.filter((r) => compare.includes(r.vehicleId));
  const th = alerts.data?.thresholds ?? {};
  return (
    <div>
      <PageHeader
        title="Fuel Consumption Monitoring"
        subtitle="Consumption, distance and efficiency per vehicle for the reporting period"
        crumbs={[{ label: "Dashboard", to: "/" }, { label: "Consumption Monitoring" }]}
        actions={can("report.export") && <ExportButtons report="vehicle-efficiency" params={params} />}
      />
      <div className="card mb-4 overflow-hidden">
        <FilterBar onReset={reset}>
          <FilterField label="From"><input type="date" className="input" value={values.from} max={values.to} onChange={(e) => set({ from: e.target.value })} /></FilterField>
          <FilterField label="To"><input type="date" className="input" value={values.to} min={values.from} onChange={(e) => set({ to: e.target.value })} /></FilterField>
          <FilterField label="Office">
            <select className="input" value={values.officeId} onChange={(e) => set({ officeId: e.target.value })}>
              <option value="">All offices</option>
              {offices.data?.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
            </select>
          </FilterField>
          <FilterField label="Fuel type">
            <select className="input" value={values.fuelTypeId} onChange={(e) => set({ fuelTypeId: e.target.value })}>
              <option value="">All</option>
              {fuelTypes.data?.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
            </select>
          </FilterField>
        </FilterBar>
        <div className="px-4 pt-2">
          <Tabs tabs={[{ key: "vehicles", label: "Per-vehicle statistics" }, { key: "alerts", label: `Alerts${alerts.data ? ` (${alerts.data.alerts.length})` : ""}` }]} active={values.tab} onChange={(k) => set({ tab: k })} />
        </div>
        {values.tab === "vehicles" && (
          <>
            {stats.isLoading && <Spinner />}
            {stats.error && <div className="p-4"><ErrorState error={stats.error} /></div>}
            {stats.data && (
              <DataTable
                rows={rows}
                rowKey={(r) => r.vehicleId}
                empty="No vehicles for the selected filters."
                columns={[
                  { key: "c", header: "Compare", cell: (r) => <input type="checkbox" aria-label={`Compare ${r.plateNumber}`} className="size-4 rounded border-slate-300" checked={compare.includes(r.vehicleId)} onChange={() => toggle(r.vehicleId)} /> },
                  { key: "v", header: "Vehicle", cell: (r) => <><Link to={`/vehicles/${r.vehicleId}`} className="font-medium text-navy-700 hover:underline">{r.plateNumber}</Link><span className="block text-xs text-slate-500">{r.classification} · {r.fuelType}</span></> },
                  { key: "rq", header: "Requested", align: "right", cell: (r) => liters(r.totalRequested), hideOnMobile: true },
                  { key: "ap", header: "Approved", align: "right", cell: (r) => liters(r.totalApproved), hideOnMobile: true },
                  { key: "is", header: "Issued", align: "right", cell: (r) => <span className="font-medium">{liters(r.totalIssued)}</span> },
                  { key: "ex", header: "Expenditure", align: "right", cell: (r) => peso(r.totalExpenditure) },
                  { key: "la", header: "Latest actual", align: "right", cell: (r) => (r.latestActual ? <>{km(r.latestActual.odometer)}<span className="block text-xs text-slate-500">{dateManila(r.latestActual.at)} · {r.latestActual.verificationStatus.toLowerCase()}</span></> : "—"), hideOnMobile: true },
                  { key: "le", header: "Latest estimate", align: "right", cell: (r) => (r.latestEstimated ? <span className="text-violet-700 italic">≈ {km(r.latestEstimated.odometer)}</span> : "—"), hideOnMobile: true },
                  { key: "vd", header: "Verified distance", align: "right", cell: (r) => km(r.verifiedDistance) },
                  { key: "ed", header: "Est. distance", align: "right", cell: (r) => (r.estimatedDistance ? <span className="text-violet-700 italic">≈ {km(r.estimatedDistance)}</span> : "—"), hideOnMobile: true },
                  { key: "ef", header: "Historical km/L", align: "right", cell: (r) => (r.historicalEfficiency !== null ? <>{kmpl(r.historicalEfficiency)}<span className="block"><Badge tone={r.historicalEfficiencyQuality === "VERIFIED" ? "green" : "violet"}>{r.historicalEfficiencyQuality === "VERIFIED" ? "Verified" : "Estimated"}</Badge></span></> : <span className="text-xs text-slate-500">Insufficient data</span>) },
                  { key: "cpk", header: "Cost / km", align: "right", cell: (r) => (r.costPerKm !== null ? peso(r.costPerKm) : <span className="text-xs text-slate-500">Insufficient data</span>) },
                ]}
                footer={
                  rows.length ? (
                    <tr>
                      <td className="td" colSpan={2}>Fleet total</td>
                      <td className="td tabular hidden text-right md:table-cell">{liters(rows.reduce((s, r) => s + r.totalRequested, 0))}</td>
                      <td className="td tabular hidden text-right md:table-cell">{liters(rows.reduce((s, r) => s + r.totalApproved, 0))}</td>
                      <td className="td tabular text-right">{liters(rows.reduce((s, r) => s + r.totalIssued, 0))}</td>
                      <td className="td tabular text-right">{peso(rows.reduce((s, r) => s + r.totalExpenditure, 0))}</td>
                      <td className="td hidden md:table-cell" colSpan={2} />
                      <td className="td tabular text-right">{km(rows.reduce((s, r) => s + r.verifiedDistance, 0))}</td>
                      <td className="td" colSpan={3} />
                    </tr>
                  ) : undefined
                }
              />
            )}
          </>
        )}
        {values.tab === "alerts" && (
          <div className="p-4">
            <Notice tone="info" className="mb-4">
              Alerts point to records worth reviewing; they are not conclusions. Consumption alerts need at least {th["alerts.minIntervals"] ?? 3} verified intervals and compare a vehicle with its own baseline (more than {th["alerts.highConsumptionPct"]}% worse) and with the median of its classification (more than {th["alerts.classDeviationPct"]}% worse), so route, load and operating conditions should be considered. {can("settings.manage") && <Link to="/settings" className="font-medium underline">Change thresholds</Link>}
            </Notice>
            {alerts.isLoading && <Spinner />}
            {alerts.data && alerts.data.alerts.length === 0 && <EmptyState title="No alerts for this period." />}
            {alerts.data && alerts.data.alerts.length > 0 && (
              <ul className="divide-y divide-slate-100 rounded-md border border-slate-200">
                {alerts.data.alerts.map((a, i) => (
                  <li key={i} className="flex gap-3 px-4 py-3">
                    <SeverityIcon severity={a.severity} />
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium text-slate-800">
                        {alerts.data!.labels[a.type] ?? a.type} {a.plateNumber && <span className="text-slate-500">· {a.plateNumber}</span>}{" "}
                        <Badge tone={a.severity === "critical" ? "red" : a.severity === "warning" ? "amber" : "slate"}>{a.severity === "critical" ? "Critical" : a.severity === "warning" ? "Warning" : "Review"}</Badge>
                      </p>
                      <p className="text-sm text-slate-600">{a.message}</p>
                      <p className="mt-0.5 text-xs text-slate-400">{a.at ? dateManila(a.at) : ""} {a.reference ?? ""}</p>
                    </div>
                    {a.link && <Link to={a.link} className="self-center text-xs font-medium whitespace-nowrap text-navy-700 hover:underline">Open record</Link>}
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </div>
      {values.tab === "vehicles" && (
        <div className="grid gap-4 lg:grid-cols-2">
          {chosen.length === 0 ? (
            <Card title="Compare vehicles" className="lg:col-span-2"><p className="text-sm text-slate-500">Tick up to six vehicles in the table to compare their consumption and efficiency for the period.</p></Card>
          ) : (
            <>
              <ChartCard title="Fuel issued in the period" subtitle="Selected vehicles" table={{ columns: ["Vehicle", "Liters", "Expenditure"], rows: chosen.map((r) => [r.plateNumber, num(r.totalIssued), peso(r.totalExpenditure)]) }}>
                <ColumnChart data={chosen} x="plateNumber" series={[{ key: "totalIssued", name: "Liters issued", color: SERIES[0] }]} format={(v) => `${num(v, 0)} L`} />
              </ChartCard>
              <ChartCard title="Historical efficiency" subtitle="km/L from verified intervals (one scale)" table={{ columns: ["Vehicle", "km/L", "Basis"], rows: chosen.map((r) => [r.plateNumber, r.historicalEfficiency === null ? "Insufficient data" : num(r.historicalEfficiency), r.historicalEfficiencyQuality ?? "—"]) }}>
                <ColumnChart data={chosen.map((r) => ({ ...r, eff: r.historicalEfficiency ?? 0 }))} x="plateNumber" series={[{ key: "eff", name: "km/L", color: SERIES[0] }]} format={(v) => num(v, 1)} />
              </ChartCard>
            </>
          )}
        </div>
      )}
    </div>
  );
}
