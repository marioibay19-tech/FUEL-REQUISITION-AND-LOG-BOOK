import { useQuery } from "@tanstack/react-query";
import clsx from "clsx";
import { FileBarChart, Printer } from "lucide-react";
import { ExportButtons } from "../components/ExportMenu";
import { Button, EmptyState, ErrorState, FilterField, PageHeader, REQUEST_STATUS, Spinner } from "../components/ui";
import { api } from "../lib/api";
import { useAuth } from "../lib/auth";
import { dateManila, dateOnly, dateTime, manilaMonthStart, manilaToday } from "../lib/format";
import { useFuelTypes, useListParams, useOffices, usePeople, useVehicleOptions } from "../lib/hooks";

interface ReportDef { key: string; title: string; group: string; filters: string[] }
interface Column { key: string; label: string; type?: string }
interface Report { key: string; title: string; periodLabel: string; generatedAt: string; generatedBy: string; columns: Column[]; rows: Record<string, unknown>[]; totals?: Record<string, unknown>; notes?: string[]; header: { agency: string; office: string; address?: string } }

const NUMERIC = ["money", "liters", "km", "kmpl", "pct", "number"];
function cell(v: unknown, type?: string): string {
  if (v === null || v === undefined || v === "") return "";
  const n = Number(v);
  switch (type) {
    case "money": return n.toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    case "liters": return n.toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    case "km": return n.toLocaleString("en-PH", { maximumFractionDigits: 1 });
    case "kmpl": return n.toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    case "pct": return `${n.toLocaleString("en-PH", { maximumFractionDigits: 2 })}%`;
    case "number": return n.toLocaleString("en-PH");
    case "date": return dateOnly(v as string);
    case "datetime": return dateTime(v as string);
    default: return String(v);
  }
}

export default function ReportsPage() {
  const { can } = useAuth();
  const defaults = { report: "request-summary", from: manilaMonthStart(), to: manilaToday(), vehicleId: "", fuelTypeId: "", officeId: "", requesterId: "", encodedById: "", status: "", readingType: "" };
  const { values, set, reset } = useListParams(defaults);
  const defs = useQuery({ queryKey: ["report-defs"], queryFn: () => api.get<ReportDef[]>("/reports") });
  const vehicles = useVehicleOptions();
  const fuelTypes = useFuelTypes();
  const offices = useOffices();
  const people = usePeople();
  const def = defs.data?.find((d) => d.key === values.report);
  const has = (f: string) => !!def?.filters.includes(f);
  const params = {
    from: values.from,
    to: values.to,
    vehicleId: has("vehicle") ? values.vehicleId : undefined,
    fuelTypeId: has("fuelType") ? values.fuelTypeId : undefined,
    officeId: has("office") ? values.officeId : undefined,
    requesterId: has("requester") ? values.requesterId : undefined,
    encodedById: has("encoder") ? values.encodedById : undefined,
    status: has("requestStatus") || has("txStatus") || has("verification") ? values.status : undefined,
    readingType: has("readingType") ? values.readingType : undefined,
  };
  const q = useQuery({ queryKey: ["report", values.report, params], queryFn: () => api.get<Report>(`/reports/${values.report}`, params), enabled: !!def });
  const groups = [...new Set(defs.data?.map((d) => d.group) ?? [])];
  const r = q.data;
  return (
    <div>
      <PageHeader title="Reports" subtitle="Generated from live records. Actual and estimated values are always labelled." crumbs={[{ label: "Dashboard", to: "/" }, { label: "Reports" }]} />
      <div className="grid gap-4 lg:grid-cols-[260px_1fr]">
        <nav className="no-print card h-fit p-2" aria-label="Reports">
          {groups.map((g) => (
            <div key={g} className="mb-2">
              <p className="px-2 pt-2 pb-1 text-[11px] font-semibold tracking-wider text-slate-400 uppercase">{g}</p>
              {defs.data!.filter((d) => d.group === g).map((d) => (
                <button key={d.key} onClick={() => set({ report: d.key, status: "" })} className={clsx("flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[13px]", values.report === d.key ? "bg-navy-50 font-medium text-navy-800" : "text-slate-600 hover:bg-slate-50")}>
                  <FileBarChart className="size-3.5 shrink-0" /> {d.title}
                </button>
              ))}
            </div>
          ))}
        </nav>
        <div className="min-w-0 space-y-4">
          <div className="no-print card p-4">
            <div className="flex flex-wrap items-end gap-3">
              <FilterField label="Start date"><input type="date" className="input" value={values.from} max={values.to} onChange={(e) => set({ from: e.target.value })} /></FilterField>
              <FilterField label="End date"><input type="date" className="input" value={values.to} min={values.from} onChange={(e) => set({ to: e.target.value })} /></FilterField>
              {has("vehicle") && (
                <FilterField label="Vehicle"><select className="input" value={values.vehicleId} onChange={(e) => set({ vehicleId: e.target.value })}><option value="">All vehicles</option>{vehicles.data?.map((v) => <option key={v.id} value={v.id}>{v.plateNumber}</option>)}</select></FilterField>
              )}
              {has("fuelType") && (
                <FilterField label="Fuel type"><select className="input" value={values.fuelTypeId} onChange={(e) => set({ fuelTypeId: e.target.value })}><option value="">All</option>{fuelTypes.data?.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}</select></FilterField>
              )}
              {has("office") && (
                <FilterField label="Office / division"><select className="input" value={values.officeId} onChange={(e) => set({ officeId: e.target.value })}><option value="">All offices</option>{offices.data?.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}</select></FilterField>
              )}
              {has("requester") && (
                <FilterField label={values.report === "audit-trail" ? "User" : "Requester"}><select className="input" value={values.requesterId} onChange={(e) => set({ requesterId: e.target.value })}><option value="">Anyone</option>{people.data?.filter((p) => values.report === "audit-trail" || p.roles.includes("REQUESTER")).map((p) => <option key={p.id} value={p.id}>{p.fullName}</option>)}</select></FilterField>
              )}
              {has("encoder") && (
                <FilterField label="Encoded by"><select className="input" value={values.encodedById} onChange={(e) => set({ encodedById: e.target.value })}><option value="">Anyone</option>{people.data?.filter((p) => p.roles.includes("CUSTODIAN") || p.roles.includes("ADMIN")).map((p) => <option key={p.id} value={p.id}>{p.fullName}</option>)}</select></FilterField>
              )}
              {has("requestStatus") && (
                <FilterField label="Request status"><select className="input" value={values.status} onChange={(e) => set({ status: e.target.value })}><option value="">All (excluding drafts)</option>{Object.entries(REQUEST_STATUS).filter(([k]) => k !== "DRAFT").map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}</select></FilterField>
              )}
              {has("txStatus") && (
                <FilterField label="Transaction status"><select className="input" value={values.status} onChange={(e) => set({ status: e.target.value })}><option value="">Active</option><option value="SUPERSEDED">Superseded</option><option value="VOIDED">Cancelled</option></select></FilterField>
              )}
              {has("verification") && (
                <FilterField label="Verification"><select className="input" value={values.status} onChange={(e) => set({ status: e.target.value })}><option value="">Any</option><option value="PENDING">Pending</option><option value="VERIFIED">Verified</option><option value="FLAGGED">Flagged</option></select></FilterField>
              )}
              {has("readingType") && (
                <FilterField label="Odometer reading"><select className="input" value={values.readingType} onChange={(e) => set({ readingType: e.target.value })}><option value="">Actual and estimated</option><option value="ACTUAL">Actual</option><option value="ESTIMATED">Estimated</option></select></FilterField>
              )}
              <Button variant="ghost" size="sm" onClick={() => reset()}>Reset</Button>
            </div>
            <div className="mt-3 flex flex-wrap items-center justify-end gap-2 border-t border-slate-100 pt-3">
              <Button variant="secondary" size="sm" icon={<Printer className="size-3.5" />} onClick={() => window.print()} disabled={!r}>Print</Button>
              {can("report.export") && <ExportButtons report={values.report} params={params} />}
            </div>
          </div>

          {defs.error && <ErrorState error={defs.error} />}
          {q.isLoading && <Spinner label="Generating report…" />}
          {q.error && <ErrorState error={q.error} />}
          {r && (
            <article className="card print-full overflow-hidden">
              <header className="border-b border-slate-200 px-5 py-4 text-center">
                <p className="text-xs font-semibold tracking-wide text-navy-800 uppercase">{r.header.agency}</p>
                <p className="text-xs text-slate-600">{r.header.office}</p>
                {r.header.address && <p className="text-[11px] text-slate-500">{r.header.address}</p>}
                <h2 className="mt-2 text-lg font-semibold text-slate-900">{r.title}</h2>
                <p className="text-xs text-slate-500">Reporting period: {r.periodLabel} · Generated {dateTime(r.generatedAt)} by {r.generatedBy} · {r.rows.length} record(s)</p>
              </header>
              <div className="overflow-x-auto">
                {r.rows.length === 0 ? (
                  <EmptyState title="No records for the selected filters." />
                ) : (
                  <table className="min-w-full divide-y divide-slate-200 text-sm">
                    <thead className="bg-slate-50">
                      <tr>{r.columns.map((c) => <th key={c.key} className={clsx("th", NUMERIC.includes(c.type ?? "") && "text-right")}>{c.label}</th>)}</tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {r.rows.map((row, i) => (
                        <tr key={i} className="hover:bg-slate-50/60">
                          {r.columns.map((c) => {
                            const v = row[c.key];
                            const isEst = (c.key === "odometerType" || c.key === "readingType") && v === "Estimated";
                            return <td key={c.key} className={clsx("td py-2", !NUMERIC.includes(c.type ?? "") && !["date", "datetime"].includes(c.type ?? "") && "wrap", NUMERIC.includes(c.type ?? "") && "tabular text-right", isEst && "text-violet-700 italic")}>{isEst ? "≈ Estimated" : cell(v, c.type)}</td>;
                          })}
                        </tr>
                      ))}
                    </tbody>
                    {r.totals && (
                      <tfoot className="bg-slate-100 font-semibold">
                        <tr>{r.columns.map((c) => <td key={c.key} className={clsx("td py-2", NUMERIC.includes(c.type ?? "") && "tabular text-right")}>{cell(r.totals![c.key], c.type)}</td>)}</tr>
                      </tfoot>
                    )}
                  </table>
                )}
              </div>
              {r.notes && r.notes.length > 0 && (
                <footer className="space-y-1 border-t border-slate-200 px-5 py-3 text-xs text-slate-500 italic">
                  {r.notes.map((n) => <p key={n}>{n}</p>)}
                  <p className="not-italic">Printed from FUELTRACK · {dateManila(new Date())}</p>
                </footer>
              )}
            </article>
          )}
        </div>
      </div>
    </div>
  );
}
