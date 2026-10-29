import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Pencil, Plus, Save } from "lucide-react";
import { useEffect, useState } from "react";
import { Badge, Button, Card, Checkbox, DataTable, ErrorState, Modal, Notice, PageHeader, SelectInput, Spinner, Tabs, TextArea, TextInput, useToast } from "../components/ui";
import { api } from "../lib/api";
import { peso } from "../lib/format";
import { errorMessage, fieldErrors, useFuelTypes, useOffices, usePeople, type FuelType, type Office } from "../lib/hooks";

interface Setting { key: string; group: string; label: string; value: unknown; default: unknown; type: "boolean" | "number" | "select" | "text"; options?: Record<string, string> }

export default function SettingsPage() {
  const [tab, setTab] = useState("rules");
  return (
    <div className="max-w-5xl">
      <PageHeader title="System Settings" subtitle="Workflow rules, odometer estimation, alert thresholds and reference data" crumbs={[{ label: "Dashboard", to: "/" }, { label: "System Settings" }]} />
      <div className="mb-4"><Tabs tabs={[{ key: "rules", label: "Rules and thresholds" }, { key: "fuel", label: "Fuel types" }, { key: "offices", label: "Offices and divisions" }]} active={tab} onChange={setTab} /></div>
      {tab === "rules" && <Rules />}
      {tab === "fuel" && <FuelTypes />}
      {tab === "offices" && <Offices />}
    </div>
  );
}

function Rules() {
  const qc = useQueryClient();
  const toast = useToast();
  const q = useQuery({ queryKey: ["settings"], queryFn: () => api.get<Setting[]>("/settings") });
  const [values, setValues] = useState<Record<string, unknown>>({});
  const [reason, setReason] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  useEffect(() => { if (q.data) setValues(Object.fromEntries(q.data.map((s) => [s.key, s.value]))); }, [q.data]);
  const changed = q.data?.filter((s) => JSON.stringify(s.value) !== JSON.stringify(values[s.key])) ?? [];
  const estimationChanged = changed.some((s) => s.key.startsWith("odometer."));
  const m = useMutation({
    mutationFn: () => api.put<{ updated: string[] }>("/settings", { values: Object.fromEntries(changed.map((s) => [s.key, values[s.key]])), reason: reason || undefined }),
    onSuccess: (r) => { toast({ tone: "success", title: `${r.updated.length} setting(s) saved`, body: estimationChanged ? "New estimates use the updated method. Use 'Recalculate' in the odometer log to refresh pending records." : undefined }); setReason(""); setErrors({}); qc.invalidateQueries({ queryKey: ["settings"] }); qc.invalidateQueries({ queryKey: ["request-meta"] }); },
    onError: (e) => { setErrors(fieldErrors(e)); toast({ tone: "error", title: "Could not save settings", body: errorMessage(e) }); },
  });
  if (q.isLoading) return <Spinner />;
  if (q.error) return <ErrorState error={q.error} />;
  const groups = [...new Set(q.data!.map((s) => s.group))];
  return (
    <div className="space-y-4">
      {groups.map((g) => (
        <Card key={g} title={g}>
          {g === "Odometer estimation" && <Notice tone="info" className="mb-4">Estimated distance = fuel quantity × reference km/L (ratio and proportion). Estimates are always stored and shown separately from actual readings. See the documentation for how each method selects the reference interval.</Notice>}
          <div className="grid gap-4 sm:grid-cols-2">
            {q.data!.filter((s) => s.group === g).map((s) => {
              const v = values[s.key];
              const err = errors[s.key];
              if (s.type === "boolean") return <div key={s.key} className="sm:col-span-2"><Checkbox label={s.label} checked={!!v} onChange={(e) => setValues({ ...values, [s.key]: e.target.checked })} /></div>;
              if (s.type === "select") return <SelectInput key={s.key} label={s.label} value={String(v ?? "")} options={Object.entries(s.options ?? {}).map(([k, l]) => ({ value: k, label: l }))} onChange={(e) => setValues({ ...values, [s.key]: e.target.value })} error={err} />;
              if (s.type === "number") return <TextInput key={s.key} label={s.label} type="number" value={String(v ?? "")} onChange={(e) => setValues({ ...values, [s.key]: e.target.value === "" ? "" : Number(e.target.value) })} error={err} hint={`Default: ${s.default}`} />;
              return <TextInput key={s.key} label={s.label} value={String(v ?? "")} onChange={(e) => setValues({ ...values, [s.key]: e.target.value })} error={err} />;
            })}
          </div>
        </Card>
      ))}
      <div className="sticky bottom-0 flex flex-wrap items-end justify-end gap-3 rounded-lg border border-slate-200 bg-white/95 p-3 backdrop-blur">
        {estimationChanged && <TextArea wrapperClass="min-w-[280px] flex-1" label="Reason for changing the estimation method" required rows={1} value={reason} onChange={(e) => setReason(e.target.value)} error={errors.reason} />}
        <span className="text-sm text-slate-500">{changed.length ? `${changed.length} unsaved change(s)` : "No changes"}</span>
        <Button icon={<Save className="size-4" />} disabled={!changed.length} loading={m.isPending} onClick={() => m.mutate()}>Save settings</Button>
      </div>
    </div>
  );
}

function FuelTypes() {
  const q = useFuelTypes();
  const [edit, setEdit] = useState<FuelType | "new" | null>(null);
  return (
    <Card title="Fuel types" bodyClass="p-0" actions={<Button size="sm" icon={<Plus className="size-3.5" />} onClick={() => setEdit("new")}>Add fuel type</Button>}>
      <DataTable rows={q.data} loading={q.isLoading} rowKey={(f) => f.id} onRowClick={(f) => setEdit(f)} columns={[
        { key: "c", header: "Code", cell: (f) => f.code },
        { key: "n", header: "Name", cell: (f) => f.name },
        { key: "p", header: "Default price per liter", align: "right", cell: (f) => peso(f.defaultPricePerLiter) },
        { key: "a", header: "Status", cell: (f) => (f.active ? <Badge tone="green">Active</Badge> : <Badge>Inactive</Badge>) },
        { key: "e", header: "", cell: () => <Pencil className="size-4 text-slate-400" /> },
      ]} />
      {edit && <FuelTypeModal item={edit === "new" ? null : edit} onClose={() => setEdit(null)} />}
    </Card>
  );
}

function FuelTypeModal({ item, onClose }: { item: FuelType | null; onClose: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [form, setForm] = useState({ code: item?.code ?? "", name: item?.name ?? "", defaultPricePerLiter: item ? String(item.defaultPricePerLiter) : "", active: item?.active ?? true });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const m = useMutation({
    mutationFn: () => (item ? api.put(`/lookups/fuel-types/${item.id}`, form) : api.post("/lookups/fuel-types", form)),
    onSuccess: () => { toast({ tone: "success", title: "Fuel type saved" }); qc.invalidateQueries({ queryKey: ["fuel-types"] }); onClose(); },
    onError: (e) => { setErrors(fieldErrors(e)); if (!Object.keys(fieldErrors(e)).length) toast({ tone: "error", title: "Could not save", body: errorMessage(e) }); },
  });
  return (
    <Modal open onClose={onClose} size="sm" title={item ? `Edit ${item.name}` : "Add fuel type"} footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button loading={m.isPending} onClick={() => m.mutate()}>Save</Button></>}>
      <div className="space-y-3">
        <TextInput label="Code" required value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} error={errors.code} />
        <TextInput label="Name" required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} error={errors.name} />
        <TextInput label="Default price per liter (PHP)" type="number" step="0.01" min="0" required value={form.defaultPricePerLiter} onChange={(e) => setForm({ ...form, defaultPricePerLiter: e.target.value })} error={errors.defaultPricePerLiter} hint="Pre-fills the estimated price on new requests" />
        <Checkbox label="Active" checked={form.active} onChange={(e) => setForm({ ...form, active: e.target.checked })} />
      </div>
    </Modal>
  );
}

function Offices() {
  const q = useOffices();
  const [edit, setEdit] = useState<Office | "new" | null>(null);
  return (
    <Card title="Offices and divisions" subtitle="The default approving officer receives the office's fuel requests" bodyClass="p-0" actions={<Button size="sm" icon={<Plus className="size-3.5" />} onClick={() => setEdit("new")}>Add office</Button>}>
      <DataTable rows={q.data} loading={q.isLoading} rowKey={(o) => o.id} onRowClick={(o) => setEdit(o)} columns={[
        { key: "c", header: "Code", cell: (o) => o.code },
        { key: "n", header: "Name", cell: (o) => o.name },
        { key: "a", header: "Default approving officer", cell: (o) => o.defaultApprover?.fullName ?? <span className="text-slate-400">Automatic (least busy approver)</span> },
        { key: "s", header: "Status", cell: (o) => (o.active ? <Badge tone="green">Active</Badge> : <Badge>Inactive</Badge>) },
        { key: "e", header: "", cell: () => <Pencil className="size-4 text-slate-400" /> },
      ]} />
      {edit && <OfficeModal item={edit === "new" ? null : edit} onClose={() => setEdit(null)} />}
    </Card>
  );
}

function OfficeModal({ item, onClose }: { item: Office | null; onClose: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const people = usePeople();
  const [form, setForm] = useState({ code: item?.code ?? "", name: item?.name ?? "", defaultApproverId: item?.defaultApproverId ? String(item.defaultApproverId) : "", active: item?.active ?? true });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const m = useMutation({
    mutationFn: () => { const body = { ...form, defaultApproverId: form.defaultApproverId || null }; return item ? api.put(`/lookups/offices/${item.id}`, body) : api.post("/lookups/offices", body); },
    onSuccess: () => { toast({ tone: "success", title: "Office saved" }); qc.invalidateQueries({ queryKey: ["offices"] }); onClose(); },
    onError: (e) => { setErrors(fieldErrors(e)); if (!Object.keys(fieldErrors(e)).length) toast({ tone: "error", title: "Could not save", body: errorMessage(e) }); },
  });
  return (
    <Modal open onClose={onClose} size="sm" title={item ? `Edit ${item.name}` : "Add office"} footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button loading={m.isPending} onClick={() => m.mutate()}>Save</Button></>}>
      <div className="space-y-3">
        <TextInput label="Code" required value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} error={errors.code} />
        <TextInput label="Name" required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} error={errors.name} />
        <SelectInput label="Default approving officer" placeholder="Automatic" value={form.defaultApproverId} onChange={(e) => setForm({ ...form, defaultApproverId: e.target.value })} error={errors.defaultApproverId} options={(people.data ?? []).filter((p) => p.isActive && p.roles.includes("APPROVER")).map((p) => ({ value: p.id, label: p.fullName }))} />
        <Checkbox label="Active" checked={form.active} onChange={(e) => setForm({ ...form, active: e.target.checked })} />
      </div>
    </Modal>
  );
}
