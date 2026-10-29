import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Calculator, CheckCircle2, Flag, Gauge, Pencil, Plus, RefreshCw, Search } from "lucide-react";
import { useEffect, useState } from "react";
import { Link } from "react-router";
import { ExportButtons } from "../components/ExportMenu";
import { Badge, Button, DataTable, DescList, ErrorState, FilterBar, FilterField, Modal, Notice, PageHeader, Pagination, ReadingTypeBadge, SelectInput, Spinner, TextArea, TextInput, VerificationBadge, useToast } from "../components/ui";
import { api, type Paged } from "../lib/api";
import { useAuth } from "../lib/auth";
import { dateManila, dateTime, fromManilaLocalInput, humanize, km, kmpl, liters, num, toManilaLocalInput } from "../lib/format";
import { errorMessage, fieldErrors, useListParams, useVehicleOptions } from "../lib/hooks";

interface Log {
  id: number; recordNumber: string; readingDate: string; source: string; isFullTank: boolean; fuelLiters: number;
  previousVerifiedOdometer: number | null; previousVerifiedAt: string | null; actualOdometer: number | null; originalActualOdometer: number | null; distanceTraveled: number | null;
  estimateStatus: string; estimateMethod: string | null; consumptionBasis: string | null; estimateLiters: number | null; efficiencyKmPerLiter: number | null; efficiencyQuality: string | null;
  referenceStart: string | null; referenceEnd: string | null; referenceLiters: number | null; referenceDistance: number | null; referenceIntervals: number | null;
  estimatedDistance: number | null; estimatedOdometer: number | null; estimateComputedAt: string | null; varianceKm: number | null; variancePct: number | null;
  readingType: string; verificationStatus: string; flags: string[]; isVoided: boolean; remarks: string | null; verifiedAt: string | null;
  vehicle: { id: number; plateNumber: string; description: string }; transaction: { id: number; transactionNumber: string; status: string } | null;
  encodedBy: { fullName: string }; verifiedBy: { fullName: string } | null;
}
interface LogDetail extends Log {
  steps: string[]; insufficientReason: string | null; stale: boolean; flagLabels: Record<string, string>;
  settings: { method: string; basis: string; rollingWindow: number; variancePctThreshold: number };
  reference: { id: number; source: string; notes: string | null; approvedBy: { fullName: string } } | null;
  actions: { recordActual: boolean; correctActual: boolean; verify: boolean; flag: boolean; recalculate: boolean };
}

const SERIOUS = ["ACTUAL_LOWER_THAN_PREVIOUS", "ESTIMATE_LOWER_THAN_PREVIOUS", "LARGE_VARIANCE"];
const METHOD_LABEL: Record<string, string> = { LAST_INTERVAL: "Most recent verified interval", ROLLING_AVERAGE: "Rolling average of verified intervals", APPROVED_REFERENCE: "Approved reference for the vehicle" };
const BASIS_LABEL: Record<string, string> = { FULL_TANK: "Full tank to full tank", ISSUANCE: "Issuance-based (estimate)" };

function Flags({ flags }: { flags: string[] }) {
  const shown = flags.filter((f) => SERIOUS.includes(f) || f === "INSUFFICIENT_DATA");
  if (!shown.length) return null;
  return (
    <span className="mt-1 flex flex-wrap gap-1">
      {shown.map((f) => (
        <Badge key={f} tone={f === "INSUFFICIENT_DATA" ? "slate" : "red"}>{f === "ACTUAL_LOWER_THAN_PREVIOUS" ? "Lower than previous" : f === "ESTIMATE_LOWER_THAN_PREVIOUS" ? "Estimate below previous" : f === "LARGE_VARIANCE" ? "Large variance" : "Insufficient data"}</Badge>
      ))}
    </span>
  );
}

export default function OdometerPage() {
  const { can } = useAuth();
  const defaults = { q: "", from: "", to: "", vehicleId: "", readingType: "", verificationStatus: "", flagged: "", record: "" };
  const { values, set, reset, page } = useListParams(defaults);
  const vehicles = useVehicleOptions();
  const [selected, setSelected] = useState<number | null>(null);
  const [manual, setManual] = useState(false);
  const q = useQuery({ queryKey: ["odometer", values, page], queryFn: () => api.get<Paged<Log>>("/odometer", { ...values, page, pageSize: 25 }), placeholderData: (p) => p });
  // Deep link: /odometer?record=OD-… opens that record's calculation panel.
  useEffect(() => {
    if (values.record && q.data?.items.length === 1) setSelected(q.data.items[0].id);
  }, [values.record, q.data]);

  return (
    <div>
      <PageHeader
        title="Odometer Log"
        subtitle="Actual readings and ratio-and-proportion estimates, kept separately"
        crumbs={[{ label: "Dashboard", to: "/" }, { label: "Odometer Log" }]}
        actions={
          <>
            {can("report.export") && <ExportButtons report="odometer-monitoring" params={{ from: values.from, to: values.to, vehicleId: values.vehicleId, readingType: values.readingType, status: values.verificationStatus }} formats={["csv", "xlsx"]} />}
            {can("odometer.record") && <Button icon={<Plus className="size-4" />} onClick={() => setManual(true)}>Record actual reading</Button>}
          </>
        }
      />
      <Notice tone="info" className="mb-4">
        <strong>Actual</strong> readings come from the vehicle's odometer. <em>≈ Estimated</em> readings are calculated from fuel issued × historical km/L and are never instrument readings; they never replace an actual reading.
      </Notice>
      <div className="card overflow-hidden">
        <FilterBar onReset={reset}>
          <FilterField label="Plate number / record" className="min-w-[200px] flex-1">
            <div className="relative">
              <Search className="pointer-events-none absolute top-2.5 left-2.5 size-4 text-slate-400" />
              <input className="input pl-8" placeholder="Search plate number, record or transaction" value={values.q} onChange={(e) => set({ q: e.target.value, record: "" })} />
            </div>
          </FilterField>
          <FilterField label="Vehicle">
            <select className="input" value={values.vehicleId} onChange={(e) => set({ vehicleId: e.target.value })}>
              <option value="">All vehicles</option>
              {vehicles.data?.map((v) => <option key={v.id} value={v.id}>{v.plateNumber}</option>)}
            </select>
          </FilterField>
          <FilterField label="From"><input type="date" className="input" value={values.from} onChange={(e) => set({ from: e.target.value })} /></FilterField>
          <FilterField label="To"><input type="date" className="input" value={values.to} onChange={(e) => set({ to: e.target.value })} /></FilterField>
          <FilterField label="Reading type">
            <select className="input" value={values.readingType} onChange={(e) => set({ readingType: e.target.value })}>
              <option value="">Actual and estimated</option>
              <option value="ACTUAL">Actual only</option>
              <option value="ESTIMATED">Estimated only</option>
            </select>
          </FilterField>
          <FilterField label="Verification">
            <select className="input" value={values.verificationStatus} onChange={(e) => set({ verificationStatus: e.target.value })}>
              <option value="">Any</option>
              <option value="PENDING">Pending</option>
              <option value="VERIFIED">Verified</option>
              <option value="FLAGGED">Flagged</option>
            </select>
          </FilterField>
          <FilterField label="Inconsistencies">
            <select className="input" value={values.flagged} onChange={(e) => set({ flagged: e.target.value })}>
              <option value="">Any</option>
              <option value="true">Only inconsistent</option>
            </select>
          </FilterField>
        </FilterBar>
        {values.record && <div className="border-b border-slate-100 px-4 py-2 text-sm">Showing record <strong>{values.record}</strong> · <button className="text-navy-700 hover:underline" onClick={() => set({ record: "" })}>show all</button></div>}
        {q.error ? (
          <div className="p-4"><ErrorState error={q.error} /></div>
        ) : (
          <DataTable
            rows={q.data?.items}
            loading={q.isLoading}
            rowKey={(l) => l.id}
            onRowClick={(l) => setSelected(l.id)}
            empty="No odometer records match the filters."
            columns={[
              { key: "d", header: "Date", cell: (l) => <>{dateTime(l.readingDate)}<span className="block text-xs text-slate-500">{l.recordNumber}</span></> },
              { key: "v", header: "Plate No.", cell: (l) => <><span className="font-medium">{l.vehicle.plateNumber}</span><span className="block text-xs text-slate-500">{l.transaction?.transactionNumber ?? humanize(l.source)}</span></> },
              { key: "p", header: "Previous (verified)", align: "right", cell: (l) => km(l.previousVerifiedOdometer) },
              { key: "a", header: "Actual", align: "right", cell: (l) => (l.actualOdometer !== null ? <span className="font-medium text-slate-900">{km(l.actualOdometer)}</span> : <span className="text-slate-400">—</span>) },
              { key: "f", header: "Fuel", align: "right", cell: (l) => (l.fuelLiters ? liters(l.fuelLiters) : "—"), hideOnMobile: true },
              { key: "ed", header: "Est. distance", align: "right", cell: (l) => (l.estimatedDistance !== null ? <span className="text-violet-700 italic">≈ {km(l.estimatedDistance)}</span> : "—"), hideOnMobile: true },
              { key: "eo", header: "Estimated odometer", align: "right", cell: (l) => (l.estimatedOdometer !== null ? <span className="text-violet-700 italic">≈ {km(l.estimatedOdometer)}</span> : l.estimateStatus === "INSUFFICIENT_DATA" ? <span className="text-xs text-slate-500">Insufficient data</span> : "—") },
              { key: "t", header: "Reading type", cell: (l) => <><ReadingTypeBadge type={l.readingType} /><Flags flags={l.flags} /></> },
              { key: "s", header: "Verification", cell: (l) => <VerificationBadge status={l.verificationStatus} /> },
              { key: "x", header: "Actions", cell: (l) => <Button size="sm" variant="secondary" icon={<Calculator className="size-3.5" />} onClick={(e) => { e.stopPropagation(); setSelected(l.id); }}>Details</Button> },
            ]}
          />
        )}
        {q.data && <Pagination page={q.data.page} pages={q.data.pages} total={q.data.total} pageSize={q.data.pageSize} onPage={(p) => set({ page: String(p) })} />}
      </div>
      {selected !== null && <DetailPanel id={selected} onClose={() => { setSelected(null); if (values.record) set({ record: "" }); }} />}
      <ManualReadingModal open={manual} onClose={() => setManual(false)} />
    </div>
  );
}

function DetailPanel({ id, onClose }: { id: number; onClose: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const q = useQuery({ queryKey: ["odometer-detail", id], queryFn: () => api.get<LogDetail>(`/odometer/${id}`) });
  const [mode, setMode] = useState<null | "actual" | "correct" | "verify" | "flag">(null);
  const [form, setForm] = useState({ actualOdometer: "", remarks: "", reason: "" });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const act = useMutation({
    mutationFn: ({ url, body }: { url: string; body?: unknown }) => api.post(url, body),
    onSuccess: (_d, v) => {
      const t = v.url.endsWith("/actual") ? "Actual reading recorded" : v.url.endsWith("/correct") ? "Actual reading corrected; original value preserved" : v.url.endsWith("/verify") ? "Record verified" : v.url.endsWith("/flag") ? "Record flagged" : "Estimates recalculated";
      toast({ tone: "success", title: t });
      setMode(null);
      setErrors({});
      for (const k of ["odometer", "odometer-detail", "dashboard", "vehicle", "transaction"]) qc.invalidateQueries({ queryKey: [k] });
    },
    onError: (e) => {
      setErrors(fieldErrors(e));
      if (!Object.keys(fieldErrors(e)).length) toast({ tone: "error", title: "Action failed", body: errorMessage(e) });
    },
  });
  const l = q.data;
  const start = (m: typeof mode) => {
    setErrors({});
    setForm({ actualOdometer: m === "correct" && l?.actualOdometer !== null ? String(l?.actualOdometer) : "", remarks: "", reason: "" });
    setMode(m);
  };
  return (
    <Modal open onClose={onClose} side size="lg" title={l ? `Odometer record ${l.recordNumber}` : "Odometer record"}>
      {q.isLoading && <Spinner />}
      {q.error && <ErrorState error={q.error} />}
      {l && (
        <div className="space-y-5">
          <div className="flex flex-wrap items-center gap-2">
            <ReadingTypeBadge type={l.readingType} />
            <VerificationBadge status={l.verificationStatus} />
            {l.isVoided && <Badge tone="red">Voided</Badge>}
            <span className="text-sm text-slate-600">
              <Link to={`/vehicles/${l.vehicle.id}`} className="font-medium text-navy-700 hover:underline">{l.vehicle.plateNumber}</Link> · {dateTime(l.readingDate)}
            </span>
          </div>
          {l.flags.filter((f) => SERIOUS.includes(f)).map((f) => <Notice key={f} tone="danger">{l.flagLabels[f] ?? f}</Notice>)}
          {l.stale && (
            <Notice tone="warning" title="Estimate may be out of date">
              Newer verified data changes this estimate. {l.actions.recalculate && <button className="font-medium underline" onClick={() => act.mutate({ url: `/odometer/vehicle/${l.vehicle.id}/recalculate` })}>Recalculate now</button>}
            </Notice>
          )}

          <section>
            <h3 className="mb-2 text-sm font-semibold text-slate-800">Readings</h3>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <Stat label="Previous verified" value={km(l.previousVerifiedOdometer)} sub={l.previousVerifiedAt ? dateManila(l.previousVerifiedAt) : "None"} />
              <Stat label="Actual reading" value={km(l.actualOdometer)} sub={l.originalActualOdometer !== null ? `Originally ${km(l.originalActualOdometer)}` : l.actualOdometer === null ? "Not recorded" : "Instrument reading"} strong />
              <Stat label="Estimated reading" value={l.estimatedOdometer !== null ? `≈ ${km(l.estimatedOdometer)}` : "—"} sub={l.estimateStatus === "INSUFFICIENT_DATA" ? "Insufficient Data for Estimate" : "Calculated, not measured"} estimate />
              <Stat label="Difference (actual − est.)" value={l.varianceKm !== null ? km(l.varianceKm) : "—"} sub={l.variancePct !== null ? `${num(l.variancePct)}% of est. distance` : l.varianceKm !== null ? "% not applicable" : "Needs both readings"} />
            </div>
            {l.distanceTraveled !== null && <p className="mt-2 text-xs text-slate-500">Actual distance since previous verified reading: {km(l.distanceTraveled)}</p>}
          </section>

          <section className="rounded-lg border border-violet-200 bg-violet-50/40 p-4">
            <h3 className="mb-1 flex items-center gap-2 text-sm font-semibold text-slate-800"><Calculator className="size-4" /> Ratio-and-proportion calculation</h3>
            {l.estimateStatus === "NOT_APPLICABLE" ? (
              <p className="text-sm text-slate-600">No estimate applies to {l.source === "INITIAL_REGISTRATION" ? "the registration baseline reading" : "a reading taken without fueling"}.</p>
            ) : l.estimateStatus === "INSUFFICIENT_DATA" ? (
              <>
                <p className="text-sm font-medium text-slate-800">Insufficient Data for Estimate</p>
                <p className="mt-1 text-sm text-slate-600">{l.insufficientReason}. Estimates need at least one verified interval (two consecutive verified actual readings with fuel in between) and a verified previous reading.</p>
              </>
            ) : (
              <>
                <DescList
                  cols={2}
                  items={[
                    { label: "Method", value: METHOD_LABEL[l.estimateMethod ?? ""] ?? l.estimateMethod },
                    { label: "Consumption basis", value: BASIS_LABEL[l.consumptionBasis ?? ""] ?? l.consumptionBasis },
                    { label: "Reference period", value: l.referenceStart ? `${dateManila(l.referenceStart)} – ${dateManila(l.referenceEnd)}${l.referenceIntervals && l.referenceIntervals > 1 ? ` (${l.referenceIntervals} intervals)` : ""}` : l.reference ? "Approved reference" : "—", full: true },
                    { label: "Reference fuel quantity", value: liters(l.referenceLiters) },
                    { label: "Reference distance", value: km(l.referenceDistance) },
                    { label: "Resulting efficiency", value: <>{kmpl(l.efficiencyKmPerLiter)} <Badge tone={l.efficiencyQuality === "VERIFIED" ? "green" : "violet"}>{l.efficiencyQuality === "VERIFIED" ? "Verified" : l.efficiencyQuality === "MANUAL" ? "Manual reference" : "Estimated"}</Badge></> },
                    { label: "Fuel for this interval", value: liters(l.estimateLiters) },
                  ]}
                />
                <ol className="mt-3 space-y-1 rounded-md bg-white px-3 py-2.5 font-mono text-[12.5px] text-slate-800 ring-1 ring-violet-100">
                  {l.steps.map((s, i) => <li key={i}>{s}</li>)}
                </ol>
                <p className="mt-2 text-xs text-slate-500">Computed {dateTime(l.estimateComputedAt)}. The estimate is stored separately and never overwrites an actual reading.{l.reference?.approvedBy ? ` Reference approved by ${l.reference.approvedBy.fullName}.` : ""}</p>
              </>
            )}
          </section>

          <section>
            <DescList
              cols={2}
              items={[
                { label: "Fuel transaction", value: l.transaction ? <Link to={`/transactions/${l.transaction.id}`} className="text-navy-700 hover:underline">{l.transaction.transactionNumber}</Link> : humanize(l.source) },
                { label: "Fuel quantity", value: <>{liters(l.fuelLiters)} {l.isFullTank && <Badge tone="slate">Full tank</Badge>}</> },
                { label: "Encoded by", value: l.encodedBy.fullName },
                { label: "Verified by", value: l.verifiedBy ? `${l.verifiedBy.fullName} · ${dateTime(l.verifiedAt)}` : "—" },
                { label: "Remarks", value: l.remarks, full: true },
              ]}
            />
          </section>

          {!l.isVoided && (
            <div className="flex flex-wrap gap-2 border-t border-slate-100 pt-4">
              {l.actions.recordActual && <Button icon={<Gauge className="size-4" />} onClick={() => start("actual")}>Record actual reading</Button>}
              {l.actions.correctActual && <Button variant="secondary" icon={<Pencil className="size-4" />} onClick={() => start("correct")}>Correct actual reading</Button>}
              {l.actions.verify && <Button variant="success" icon={<CheckCircle2 className="size-4" />} onClick={() => start("verify")}>{l.readingType === "ACTUAL" ? "Verify reading" : "Verify estimate"}</Button>}
              {l.actions.flag && <Button variant="secondary" icon={<Flag className="size-4" />} onClick={() => start("flag")}>Flag</Button>}
              {l.actions.recalculate && <Button variant="ghost" icon={<RefreshCw className="size-4" />} loading={act.isPending && !mode} onClick={() => act.mutate({ url: `/odometer/vehicle/${l.vehicle.id}/recalculate` })}>Recalculate vehicle estimates</Button>}
            </div>
          )}

          {mode && (
            <div className="rounded-lg border border-slate-200 bg-slate-50 p-4">
              {(mode === "actual" || mode === "correct") && (
                <TextInput label={mode === "actual" ? "Actual odometer reading (km)" : "Corrected actual reading (km)"} type="number" step="0.1" min="0" required value={form.actualOdometer} onChange={(e) => setForm({ ...form, actualOdometer: e.target.value })} error={errors.actualOdometer}
                  hint={mode === "actual" && l.estimatedOdometer !== null ? `The estimate (≈ ${km(l.estimatedOdometer)}) is kept for comparison.` : mode === "correct" ? "The first recorded value is preserved and the change is audited. The record will need verification again." : undefined} />
              )}
              {mode === "correct" && <TextArea wrapperClass="mt-3" label="Reason for correction" required rows={2} value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })} error={errors.reason} />}
              {(mode === "actual" || mode === "verify" || mode === "flag") && (
                <TextArea wrapperClass="mt-3" label={mode === "flag" ? "Why is this record flagged?" : "Remarks"} required={mode === "flag" || (mode === "verify" && (l.readingType === "ESTIMATED" || l.flags.some((f) => SERIOUS.includes(f))))} rows={2} value={form.remarks} onChange={(e) => setForm({ ...form, remarks: e.target.value })} error={errors.remarks}
                  hint={mode === "verify" ? (l.readingType === "ESTIMATED" ? "Verifying an estimate records that it was reviewed; it remains an estimate and is not used as a verified reading." : "A verified actual reading becomes the base for later estimates.") : undefined} />
              )}
              <div className="mt-3 flex justify-end gap-2">
                <Button variant="secondary" onClick={() => setMode(null)}>Cancel</Button>
                <Button
                  variant={mode === "flag" ? "danger" : mode === "verify" ? "success" : "primary"}
                  loading={act.isPending}
                  onClick={() =>
                    act.mutate(
                      mode === "actual"
                        ? { url: `/odometer/${l.id}/actual`, body: { actualOdometer: form.actualOdometer, remarks: form.remarks } }
                        : mode === "correct"
                          ? { url: `/odometer/${l.id}/correct`, body: { actualOdometer: form.actualOdometer, reason: form.reason } }
                          : { url: `/odometer/${l.id}/${mode}`, body: { remarks: form.remarks } },
                    )
                  }
                >
                  {mode === "actual" ? "Save reading" : mode === "correct" ? "Save correction" : mode === "verify" ? "Verify" : "Flag record"}
                </Button>
              </div>
            </div>
          )}
        </div>
      )}
    </Modal>
  );
}

function Stat({ label, value, sub, strong, estimate }: { label: string; value: string; sub?: string; strong?: boolean; estimate?: boolean }) {
  return (
    <div className={`rounded-md px-3 py-2 ${estimate ? "border border-dashed border-violet-300 bg-violet-50/50" : "bg-slate-50"}`}>
      <p className="text-xs text-slate-500">{label}</p>
      <p className={`tabular text-sm ${strong ? "font-semibold text-slate-900" : estimate ? "font-semibold text-violet-800 italic" : "font-medium text-slate-800"}`}>{value}</p>
      {sub && <p className="text-[11px] text-slate-500">{sub}</p>}
    </div>
  );
}

function ManualReadingModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const vehicles = useVehicleOptions(open);
  const qc = useQueryClient();
  const toast = useToast();
  const [form, setForm] = useState({ vehicleId: "", readingDate: toManilaLocalInput(new Date()), actualOdometer: "", remarks: "" });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const m = useMutation({
    mutationFn: () => api.post<{ recordNumber: string; flags: string[] }>("/odometer", { ...form, readingDate: fromManilaLocalInput(form.readingDate) }),
    onSuccess: (r) => {
      toast({ tone: r.flags.some((f) => SERIOUS.includes(f)) ? "error" : "success", title: `Reading ${r.recordNumber} recorded`, body: r.flags.includes("ACTUAL_LOWER_THAN_PREVIOUS") ? "Flagged: lower than the previous verified reading." : "Awaiting verification." });
      qc.invalidateQueries({ queryKey: ["odometer"] });
      setForm({ vehicleId: "", readingDate: toManilaLocalInput(new Date()), actualOdometer: "", remarks: "" });
      onClose();
    },
    onError: (e) => {
      setErrors(fieldErrors(e));
      if (!Object.keys(fieldErrors(e)).length) toast({ tone: "error", title: "Could not record reading", body: errorMessage(e) });
    },
  });
  return (
    <Modal open={open} onClose={onClose} title="Record actual odometer reading" footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button loading={m.isPending} onClick={() => m.mutate()}>Save reading</Button></>}>
      <p className="mb-3 text-sm text-slate-600">For readings taken outside a fueling event (inspection, trip ticket, PMS). Readings taken at fueling are entered with the fuel transaction.</p>
      <div className="grid gap-3 sm:grid-cols-2">
        <SelectInput label="Vehicle" required wrapperClass="sm:col-span-2" placeholder="Select a vehicle" value={form.vehicleId} onChange={(e) => setForm({ ...form, vehicleId: e.target.value })} error={errors.vehicleId} options={(vehicles.data ?? []).map((v) => ({ value: v.id, label: `${v.plateNumber} — ${v.description}` }))} />
        <TextInput label="Date and time of reading" type="datetime-local" required value={form.readingDate} onChange={(e) => setForm({ ...form, readingDate: e.target.value })} error={errors.readingDate} />
        <TextInput label="Actual odometer reading (km)" type="number" step="0.1" min="0" required value={form.actualOdometer} onChange={(e) => setForm({ ...form, actualOdometer: e.target.value })} error={errors.actualOdometer} />
        <TextArea label="Remarks" wrapperClass="sm:col-span-2" rows={2} value={form.remarks} onChange={(e) => setForm({ ...form, remarks: e.target.value })} />
      </div>
    </Modal>
  );
}
