import { useQuery } from "@tanstack/react-query";
import { Search } from "lucide-react";
import { useState } from "react";
import { ExportButtons } from "../components/ExportMenu";
import { DataTable, DescList, ErrorState, FilterBar, FilterField, Modal, PageHeader, Pagination } from "../components/ui";
import { api, type Paged } from "../lib/api";
import { useAuth } from "../lib/auth";
import { dateTime, humanize } from "../lib/format";
import { useListParams, usePeople } from "../lib/hooks";

interface AuditRow { id: string; action: string; module: string; recordId: string | null; before: unknown; after: unknown; reason: string | null; ipAddress: string | null; createdAt: string; user: { fullName: string; username: string } | null }

function Json({ value }: { value: unknown }) {
  if (value === null || value === undefined) return <p className="text-xs text-slate-400">—</p>;
  return <pre className="max-h-72 overflow-auto rounded-md bg-slate-50 p-2 text-[11.5px] leading-relaxed text-slate-700 ring-1 ring-slate-200">{JSON.stringify(value, null, 2)}</pre>;
}

export default function AuditPage() {
  const { can } = useAuth();
  const defaults = { q: "", from: "", to: "", userId: "", module: "", action: "" };
  const { values, set, reset, page } = useListParams(defaults);
  const people = usePeople();
  const [open, setOpen] = useState<AuditRow | null>(null);
  const q = useQuery({ queryKey: ["audit", values], queryFn: () => api.get<Paged<AuditRow> & { modules: string[]; actions: string[] }>("/audit", { ...values, page, pageSize: 30 }), placeholderData: (p) => p });
  return (
    <div>
      <PageHeader title="Audit Trail" subtitle="Append-only record of sign-ins, approvals, issuance, odometer changes and administration" crumbs={[{ label: "Dashboard", to: "/" }, { label: "Audit Trail" }]} actions={can("report.export") && <ExportButtons report="audit-trail" params={{ from: values.from || undefined, to: values.to || undefined, requesterId: values.userId }} />} />
      <div className="card overflow-hidden">
        <FilterBar onReset={reset}>
          <FilterField label="Search" className="min-w-[200px] flex-1">
            <div className="relative"><Search className="pointer-events-none absolute top-2.5 left-2.5 size-4 text-slate-400" /><input className="input pl-8" placeholder="Record ID, action or reason" value={values.q} onChange={(e) => set({ q: e.target.value })} /></div>
          </FilterField>
          <FilterField label="From"><input type="date" className="input" value={values.from} onChange={(e) => set({ from: e.target.value })} /></FilterField>
          <FilterField label="To"><input type="date" className="input" value={values.to} onChange={(e) => set({ to: e.target.value })} /></FilterField>
          <FilterField label="User"><select className="input" value={values.userId} onChange={(e) => set({ userId: e.target.value })}><option value="">Anyone</option>{people.data?.map((p) => <option key={p.id} value={p.id}>{p.fullName}</option>)}</select></FilterField>
          <FilterField label="Module"><select className="input" value={values.module} onChange={(e) => set({ module: e.target.value })}><option value="">All</option>{q.data?.modules.map((m) => <option key={m} value={m}>{humanize(m)}</option>)}</select></FilterField>
          <FilterField label="Action"><select className="input" value={values.action} onChange={(e) => set({ action: e.target.value })}><option value="">All</option>{q.data?.actions.map((a) => <option key={a} value={a}>{humanize(a)}</option>)}</select></FilterField>
        </FilterBar>
        {q.error ? <div className="p-4"><ErrorState error={q.error} /></div> : (
          <DataTable rows={q.data?.items} loading={q.isLoading} rowKey={(a) => a.id} onRowClick={setOpen} dense columns={[
            { key: "t", header: "Timestamp", cell: (a) => <span className="whitespace-nowrap">{dateTime(a.createdAt)}</span> },
            { key: "u", header: "User", cell: (a) => a.user?.fullName ?? <span className="text-slate-400">System / unknown</span> },
            { key: "a", header: "Action", cell: (a) => <span className="font-medium">{humanize(a.action)}</span> },
            { key: "m", header: "Module", cell: (a) => humanize(a.module), hideOnMobile: true },
            { key: "r", header: "Record", cell: (a) => a.recordId ?? "—" },
            { key: "x", header: "Reason", className: "wrap", cell: (a) => <span className="line-clamp-1 max-w-[260px]">{a.reason ?? ""}</span>, hideOnMobile: true },
          ]} />
        )}
        {q.data && <Pagination page={q.data.page} pages={q.data.pages} total={q.data.total} pageSize={q.data.pageSize} onPage={(p) => set({ page: String(p) })} />}
      </div>
      {open && (
        <Modal open onClose={() => setOpen(null)} size="lg" title={humanize(open.action)}>
          <DescList cols={3} items={[{ label: "Timestamp", value: dateTime(open.createdAt) }, { label: "User", value: open.user ? `${open.user.fullName} (${open.user.username})` : "System / unknown" }, { label: "IP address", value: open.ipAddress }, { label: "Module", value: humanize(open.module) }, { label: "Record", value: open.recordId }, { label: "Reason / remarks", value: open.reason, full: true }]} />
          <div className="mt-4 grid gap-3 md:grid-cols-2">
            <div><p className="label">Before</p><Json value={open.before} /></div>
            <div><p className="label">After</p><Json value={open.after} /></div>
          </div>
          <p className="mt-3 text-xs text-slate-500">Audit records cannot be edited or deleted.</p>
        </Modal>
      )}
    </div>
  );
}
