import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, Pencil } from "lucide-react";
import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { VehicleFormModal } from "../components/VehicleForm";
import { Badge, Button, Card, DataTable, DescList, ErrorState, Modal, Notice, PageHeader, ReadingTypeBadge, Spinner, StatusBadge, Tabs, TextArea, TextInput, TxStatusBadge, VerificationBadge, useToast } from "../components/ui";
import { api } from "../lib/api";
import { useAuth } from "../lib/auth";
import { dateManila, dateOnly, dateTime, km, kmpl, liters, peso } from "../lib/format";
import { errorMessage, fieldErrors } from "../lib/hooks";
import { VehicleStatusBadge } from "./Vehicles";

interface Interval { startAt: string; endAt: string; startOdometer: number; endOdometer: number; distanceKm: number; liters: number; cost: number; quality: string; efficiency: number }
interface Reference { id: number; source: string; periodStart: string | null; periodEnd: string | null; referenceLiters: number; referenceDistance: number; efficiencyKmPerLiter: number; quality: string; notes: string | null; isActive: boolean; approvedAt: string; approvedBy: { fullName: string } }

export default function VehicleDetailPage() {
  const { id } = useParams();
  const { can } = useAuth();
  const navigate = useNavigate();
  const [tab, setTab] = useState("overview");
  const [edit, setEdit] = useState(false);
  const q = useQuery({ queryKey: ["vehicle", id], queryFn: () => api.get<Record<string, never> & VehicleDetail>(`/vehicles/${id}`) });
  if (q.isLoading) return <Spinner />;
  if (q.error) return <ErrorState error={q.error} />;
  const v = q.data!;
  const s = v.stats;
  const tabs = [
    { key: "overview", label: "Overview" },
    ...(can("transaction.view") ? [{ key: "fuel", label: `Fuel history (${v.transactions.length})` }] : []),
    ...(can("odometer.view") ? [{ key: "odometer", label: `Odometer history (${v.odometerLogs.length})` }] : []),
    { key: "requests", label: `Requests (${v.requests.length})` },
    ...(can("odometer.view") ? [{ key: "efficiency", label: "Efficiency" }] : []),
    { key: "maintenance", label: "Maintenance" },
  ];
  return (
    <div>
      <PageHeader
        title={`${v.plateNumber} — ${v.description}`}
        subtitle={<span className="flex items-center gap-2"><VehicleStatusBadge status={v.status} />{v.classification} · {v.fuelType.name} · {v.office?.name ?? "No office"}</span>}
        crumbs={[{ label: "Dashboard", to: "/" }, { label: "Vehicles", to: "/vehicles" }, { label: v.plateNumber }]}
        actions={can("vehicle.manage") && <Button variant="secondary" icon={<Pencil className="size-4" />} onClick={() => setEdit(true)}>Edit vehicle</Button>}
      />
      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-5">
        <Mini label="Verified odometer" value={km(v.currentOdometer)} sub={dateManila(v.currentOdometerAt)} />
        <Mini label="Latest estimate" value={v.odometer.latestEstimate ? `≈ ${km(v.odometer.latestEstimate.odometer)}` : "—"} sub="Calculated, not measured" estimate />
        {v.lifetime && <Mini label="Total fuel issued (all time)" value={liters(v.lifetime.liters)} sub={`${v.lifetime.transactions} transactions`} />}
        {v.lifetime && <Mini label="Total fuel expenditure" value={peso(v.lifetime.cost)} />}
        {s && <Mini label="Reference efficiency" value={kmpl(s.historicalEfficiency)} sub={s.historicalEfficiencyQuality ? (s.historicalEfficiencyQuality === "VERIFIED" ? "Verified data" : "Estimated") : "Insufficient data"} />}
      </div>
      {(v.odometer.pendingCount > 0 || v.odometer.flaggedCount > 0) && <Notice tone="warning" className="mb-4">{v.odometer.pendingCount} pending and {v.odometer.flaggedCount} flagged odometer record(s) need verification. <Link className="underline" to={`/odometer?vehicleId=${v.id}`}>Review in the odometer log</Link></Notice>}
      <div className="card">
        <div className="px-4 pt-2"><Tabs tabs={tabs} active={tab} onChange={setTab} /></div>
        <div className="p-4">
          {tab === "overview" && (
            <div className="grid gap-6 lg:grid-cols-2">
              <DescList
                cols={2}
                items={[
                  { label: "Vehicle ID", value: v.id },
                  { label: "Plate number", value: v.plateNumber },
                  { label: "Property / equipment no.", value: v.propertyNumber },
                  { label: "Classification", value: v.classification },
                  { label: "Make / model", value: [v.make, v.model].filter(Boolean).join(" ") || null },
                  { label: "Year", value: v.year },
                  { label: "Fuel type", value: v.fuelType.name },
                  { label: "Tank capacity", value: liters(v.tankCapacityLiters) },
                  { label: "Assigned office", value: v.office?.name },
                  { label: "Driver / custodian", value: v.custodianName ?? v.custodianUser?.fullName },
                  { label: "Registration expiry", value: dateOnly(v.registrationExpiry) },
                  { label: "Remarks", value: v.remarks, full: true },
                ]}
              />
              {s && (
                <div>
                  <h3 className="mb-2 text-sm font-semibold text-slate-800">Last 12 months</h3>
                  <DescList
                    cols={2}
                    items={[
                      { label: "Fuel requested", value: liters(s.totalRequested) },
                      { label: "Fuel approved", value: liters(s.totalApproved) },
                      { label: "Fuel issued", value: liters(s.totalIssued) },
                      { label: "Expenditure", value: peso(s.totalExpenditure) },
                      { label: "Verified distance", value: km(s.verifiedDistance) },
                      { label: "Estimated distance", value: s.estimatedDistance ? `≈ ${km(s.estimatedDistance)}` : "—" },
                      { label: "Period efficiency", value: kmpl(s.periodEfficiency) },
                      { label: "Cost per km", value: s.costPerKm ? peso(s.costPerKm) : "Insufficient data" },
                    ]}
                  />
                </div>
              )}
            </div>
          )}
          {tab === "fuel" && (
            <DataTable
              rows={v.transactions}
              rowKey={(t) => t.id}
              onRowClick={(t) => navigate(`/transactions/${t.id}`)}
              empty="No fuel transactions."
              columns={[
                { key: "n", header: "Transaction", cell: (t) => <span className="font-medium text-navy-800">{t.transactionNumber}</span> },
                { key: "d", header: "Date", cell: (t) => dateTime(t.transactionDate) },
                { key: "r", header: "Request", cell: (t) => t.request?.requestNumber ?? "Direct" },
                { key: "l", header: "Liters", align: "right", cell: (t) => liters(t.litersIssued) },
                { key: "c", header: "Cost", align: "right", cell: (t) => peso(t.totalCost) },
                { key: "o", header: "Odometer", align: "right", cell: (t) => km(t.odometerReading) },
                { key: "s", header: "Status", cell: (t) => <TxStatusBadge status={t.status} /> },
              ]}
            />
          )}
          {tab === "odometer" && (
            <DataTable
              rows={v.odometerLogs}
              rowKey={(l) => l.id}
              onRowClick={(l) => navigate(`/odometer?record=${l.recordNumber}`)}
              empty="No odometer records."
              columns={[
                { key: "d", header: "Date", cell: (l) => <>{dateTime(l.readingDate)}<span className="block text-xs text-slate-500">{l.recordNumber}</span></> },
                { key: "p", header: "Previous", align: "right", cell: (l) => km(l.previousVerifiedOdometer) },
                { key: "a", header: "Actual", align: "right", cell: (l) => km(l.actualOdometer) },
                { key: "f", header: "Fuel", align: "right", cell: (l) => (l.fuelLiters ? liters(l.fuelLiters) : "—") },
                { key: "e", header: "Estimated", align: "right", cell: (l) => (l.estimatedOdometer !== null ? <span className="text-violet-700 italic">≈ {km(l.estimatedOdometer)}</span> : "—") },
                { key: "t", header: "Type", cell: (l) => <>{l.isVoided ? <Badge tone="red">Voided</Badge> : <ReadingTypeBadge type={l.readingType} />}</> },
                { key: "v", header: "Verification", cell: (l) => <VerificationBadge status={l.verificationStatus} /> },
              ]}
            />
          )}
          {tab === "requests" && (
            <DataTable
              rows={v.requests}
              rowKey={(r) => r.id}
              onRowClick={(r) => navigate(`/requests/${r.id}`)}
              empty="No fuel requests."
              columns={[
                { key: "n", header: "Request", cell: (r) => <span className="font-medium text-navy-800">{r.requestNumber}</span> },
                { key: "d", header: "Date", cell: (r) => dateOnly(r.requestDate) },
                { key: "q", header: "Requester", cell: (r) => r.requester.fullName },
                { key: "l", header: "Requested", align: "right", cell: (r) => liters(r.requestedLiters) },
                { key: "s", header: "Status", cell: (r) => <StatusBadge status={r.status} /> },
              ]}
            />
          )}
          {tab === "efficiency" && <EfficiencyTab vehicleId={v.id} plate={v.plateNumber} />}
          {tab === "maintenance" && (
            <DescList cols={3} items={[{ label: "Last maintenance", value: dateOnly(v.lastMaintenanceDate) }, { label: "Next maintenance due", value: dateOnly(v.nextMaintenanceDate) }, { label: "Status", value: <VehicleStatusBadge status={v.status} /> }, { label: "Maintenance notes", value: v.maintenanceNotes, full: true }]} />
          )}
        </div>
      </div>
      <VehicleFormModal open={edit} onClose={() => setEdit(false)} vehicle={v as unknown as Record<string, unknown>} />
    </div>
  );
}

function Mini({ label, value, sub, estimate }: { label: string; value: string; sub?: string; estimate?: boolean }) {
  return (
    <div className={`card px-4 py-3 ${estimate ? "border-dashed border-violet-300" : ""}`}>
      <p className="text-xs text-slate-500">{label}</p>
      <p className={`tabular mt-0.5 text-lg font-semibold ${estimate ? "text-violet-800 italic" : "text-slate-900"}`}>{value}</p>
      {sub && <p className="text-xs text-slate-500">{sub}</p>}
    </div>
  );
}

function EfficiencyTab({ vehicleId, plate }: { vehicleId: number; plate: string }) {
  const { can } = useAuth();
  const qc = useQueryClient();
  const toast = useToast();
  const q = useQuery({ queryKey: ["intervals", vehicleId], queryFn: () => api.get<{ intervals: Interval[]; references: Reference[]; basis: string; method: string }>(`/odometer/vehicle/${vehicleId}/intervals`) });
  const [approve, setApprove] = useState<null | { source: "COMPUTED_INTERVAL" | "MANUAL"; interval?: Interval }>(null);
  const [form, setForm] = useState({ referenceLiters: "", referenceDistance: "", notes: "" });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const m = useMutation({
    mutationFn: () =>
      api.post("/odometer/references", {
        vehicleId,
        source: approve?.source,
        periodStart: approve?.interval?.startAt ?? null,
        periodEnd: approve?.interval?.endAt ?? null,
        referenceLiters: form.referenceLiters,
        referenceDistance: form.referenceDistance,
        quality: approve?.interval?.quality ?? "MANUAL",
        notes: form.notes,
      }),
    onSuccess: () => {
      toast({ tone: "success", title: "Reference approved", body: "It is used when the estimation method is set to 'Approved reference'." });
      setApprove(null);
      qc.invalidateQueries({ queryKey: ["intervals", vehicleId] });
      qc.invalidateQueries({ queryKey: ["vehicle"] });
    },
    onError: (e) => {
      setErrors(fieldErrors(e));
      if (!Object.keys(fieldErrors(e)).length) toast({ tone: "error", title: "Could not approve reference", body: errorMessage(e) });
    },
  });
  if (q.isLoading) return <Spinner />;
  if (q.error) return <ErrorState error={q.error} />;
  const d = q.data!;
  const eff = Number(form.referenceDistance) > 0 && Number(form.referenceLiters) > 0 ? Number(form.referenceDistance) / Number(form.referenceLiters) : null;
  return (
    <div className="space-y-5">
      <Notice tone="info">
        Intervals run between consecutive <strong>verified actual</strong> readings. Efficiency = distance ÷ fuel attributed to the interval ({d.basis === "FULL_TANK" ? "fuel refilled at the end reading, full tank to full tank" : "fuel issued during the interval — an estimate"}). Intervals are labelled <em>Verified</em> only when both ends are full-tank fills.
      </Notice>
      <Card title="Verified intervals" bodyClass="p-0" actions={can("efficiency.approve") && <Button size="sm" variant="secondary" onClick={() => { setForm({ referenceLiters: "", referenceDistance: "", notes: "" }); setErrors({}); setApprove({ source: "MANUAL" }); }}>Enter manual reference</Button>}>
        <DataTable
          rows={[...d.intervals].reverse()}
          rowKey={(i) => i.endAt}
          empty="Insufficient data — at least two verified readings with fuel in between are needed."
          columns={[
            { key: "p", header: "Period", cell: (i) => `${dateManila(i.startAt)} – ${dateManila(i.endAt)}` },
            { key: "o", header: "Odometer", align: "right", cell: (i) => `${km(i.startOdometer)} → ${km(i.endOdometer)}` },
            { key: "d", header: "Distance", align: "right", cell: (i) => km(i.distanceKm) },
            { key: "l", header: "Fuel", align: "right", cell: (i) => liters(i.liters) },
            { key: "e", header: "km/L", align: "right", cell: (i) => kmpl(i.efficiency) },
            { key: "c", header: "Cost/km", align: "right", cell: (i) => (i.cost ? peso(i.cost / i.distanceKm) : "—") },
            { key: "q", header: "Basis", cell: (i) => <Badge tone={i.quality === "VERIFIED" ? "green" : "violet"}>{i.quality === "VERIFIED" ? "Verified" : "Estimated"}</Badge> },
            ...(can("efficiency.approve") ? [{ key: "a", header: "", cell: (i: Interval) => <Button size="sm" variant="ghost" icon={<CheckCircle2 className="size-3.5" />} onClick={() => { setForm({ referenceLiters: String(i.liters), referenceDistance: String(i.distanceKm), notes: "" }); setErrors({}); setApprove({ source: "COMPUTED_INTERVAL", interval: i }); }}>Approve as reference</Button> }] : []),
          ]}
        />
      </Card>
      <Card title="Approved references" subtitle={d.method === "APPROVED_REFERENCE" ? "In use — estimation method is 'Approved reference'" : "Used only when the estimation method is set to 'Approved reference'"} bodyClass="p-0">
        <DataTable
          rows={d.references}
          rowKey={(r) => r.id}
          empty="No approved references."
          columns={[
            { key: "s", header: "Source", cell: (r) => (r.source === "MANUAL" ? "Manual" : "Computed interval") },
            { key: "p", header: "Reference period", cell: (r) => (r.periodStart ? `${dateManila(r.periodStart)} – ${dateManila(r.periodEnd)}` : "—") },
            { key: "v", header: "Liters : km", align: "right", cell: (r) => `${liters(r.referenceLiters)} : ${km(r.referenceDistance)}` },
            { key: "e", header: "km/L", align: "right", cell: (r) => kmpl(r.efficiencyKmPerLiter) },
            { key: "a", header: "Approved", cell: (r) => <>{r.approvedBy.fullName}<span className="block text-xs text-slate-500">{dateTime(r.approvedAt)}</span></> },
            { key: "n", header: "Notes", cell: (r) => r.notes ?? "—" },
            { key: "st", header: "", cell: (r) => (r.isActive ? <Badge tone="green">Active</Badge> : <Badge>Replaced</Badge>) },
          ]}
        />
      </Card>
      <Modal open={!!approve} onClose={() => setApprove(null)} title={`Approve efficiency reference — ${plate}`} footer={<><Button variant="secondary" onClick={() => setApprove(null)}>Cancel</Button><Button loading={m.isPending} onClick={() => m.mutate()}>Approve reference</Button></>}>
        <div className="grid gap-3 sm:grid-cols-2">
          <TextInput label="Reference fuel quantity (L)" type="number" step="0.01" min="0" required value={form.referenceLiters} disabled={approve?.source === "COMPUTED_INTERVAL"} onChange={(e) => setForm({ ...form, referenceLiters: e.target.value })} error={errors.referenceLiters} />
          <TextInput label="Reference distance (km)" type="number" step="0.1" min="0" required value={form.referenceDistance} disabled={approve?.source === "COMPUTED_INTERVAL"} onChange={(e) => setForm({ ...form, referenceDistance: e.target.value })} error={errors.referenceDistance} />
          <p className="text-sm text-slate-700 sm:col-span-2">Resulting efficiency: <strong>{eff ? kmpl(eff) : "—"}</strong>. This replaces the vehicle's active reference.</p>
          <TextArea label={approve?.source === "MANUAL" ? "Source of this reference (required)" : "Notes"} wrapperClass="sm:col-span-2" rows={2} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} error={errors.notes} />
        </div>
      </Modal>
    </div>
  );
}

interface VehicleDetail {
  id: number; plateNumber: string; propertyNumber: string | null; description: string; make: string | null; model: string | null; year: number | null; classification: string; status: string;
  tankCapacityLiters: number | null; currentOdometer: number; currentOdometerAt: string | null; registrationExpiry: string | null; lastMaintenanceDate: string | null; nextMaintenanceDate: string | null;
  maintenanceNotes: string | null; remarks: string | null; custodianName: string | null; custodianUser: { fullName: string } | null;
  fuelType: { name: string }; office: { name: string } | null;
  stats?: { totalRequested: number; totalApproved: number; totalIssued: number; totalExpenditure: number; verifiedDistance: number; estimatedDistance: number; periodEfficiency: number | null; historicalEfficiency: number | null; historicalEfficiencyQuality: string | null; costPerKm: number | null };
  lifetime?: { liters: number; cost: number; transactions: number };
  odometer: { latestVerified: { odometer: number } | null; latestEstimate: { odometer: number } | null; pendingCount: number; flaggedCount: number };
  transactions: { id: number; transactionNumber: string; transactionDate: string; litersIssued: number; totalCost: number; odometerReading: number | null; status: string; request: { requestNumber: string } | null }[];
  odometerLogs: { id: number; recordNumber: string; readingDate: string; previousVerifiedOdometer: number | null; actualOdometer: number | null; fuelLiters: number; estimatedOdometer: number | null; readingType: string; verificationStatus: string; isVoided: boolean }[];
  requests: { id: number; requestNumber: string; requestDate: string; requestedLiters: number; status: string; requester: { fullName: string } }[];
}
