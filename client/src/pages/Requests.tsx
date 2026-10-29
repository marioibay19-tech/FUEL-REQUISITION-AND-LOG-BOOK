import { useQuery } from "@tanstack/react-query";
import { FilePlus2, Search } from "lucide-react";
import { useNavigate } from "react-router";
import { Badge, ButtonLink, DataTable, ErrorState, FilterBar, FilterField, PageHeader, Pagination, REQUEST_STATUS, StatusBadge, Tabs } from "../components/ui";
import { api, type Paged } from "../lib/api";
import { useAuth } from "../lib/auth";
import { dateOnly, liters, peso } from "../lib/format";
import { useListParams, useVehicleOptions } from "../lib/hooks";

export interface RequestRow {
  id: number;
  requestNumber: string;
  requestDate: string;
  status: string;
  purpose: string;
  requestedLiters: number;
  approvedLiters: number | null;
  issuedLiters: number;
  estimatedTotalCost: number;
  flaggedForReview: boolean;
  vehicle: { id: number; plateNumber: string; description: string };
  requester: { id: number; fullName: string };
  fuelType: { name: string };
  office: { code: string; name: string } | null;
  assignedApprover: { fullName: string } | null;
}

export default function RequestsPage() {
  const { can } = useAuth();
  const navigate = useNavigate();
  const defaults = { q: "", status: "", from: "", to: "", vehicleId: "", scope: "all", flagged: "" };
  const { values, set, reset, page } = useListParams(defaults);
  const vehicles = useVehicleOptions();
  const q = useQuery({
    queryKey: ["requests", values],
    queryFn: () => api.get<Paged<RequestRow>>("/requests", { ...values, page, pageSize: 20 }),
    placeholderData: (prev) => prev,
  });
  const tabs = [
    { key: "all", label: "All visible" },
    ...(can("request.create") ? [{ key: "mine", label: "My requests" }] : []),
    ...(can("request.approve") ? [{ key: "assigned", label: "Awaiting my approval" }] : []),
    ...(can("request.view_issuable") ? [{ key: "issuable", label: "For issuance" }] : []),
  ];
  return (
    <div>
      <PageHeader
        title="Fuel Requests"
        subtitle="Requests, approval status and issuance progress"
        crumbs={[{ label: "Dashboard", to: "/" }, { label: "Fuel Requests" }]}
        actions={can("request.create") && <ButtonLink to="/requests/new" icon={<FilePlus2 className="size-4" />}>New fuel request</ButtonLink>}
      />
      <div className="card overflow-hidden">
        {tabs.length > 1 && (
          <div className="px-4 pt-2">
            <Tabs tabs={tabs} active={values.scope} onChange={(k) => set({ scope: k })} />
          </div>
        )}
        <FilterBar onReset={reset}>
          <FilterField label="Search" className="min-w-[220px] flex-1">
            <div className="relative">
              <Search className="pointer-events-none absolute top-2.5 left-2.5 size-4 text-slate-400" />
              <input className="input pl-8" placeholder="Request no., plate, requester, purpose" value={values.q} onChange={(e) => set({ q: e.target.value })} />
            </div>
          </FilterField>
          <FilterField label="Status">
            <select className="input" value={values.status} onChange={(e) => set({ status: e.target.value })}>
              <option value="">All statuses</option>
              {Object.entries(REQUEST_STATUS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
            </select>
          </FilterField>
          <FilterField label="Vehicle">
            <select className="input" value={values.vehicleId} onChange={(e) => set({ vehicleId: e.target.value })}>
              <option value="">All vehicles</option>
              {vehicles.data?.map((v) => <option key={v.id} value={v.id}>{v.plateNumber}</option>)}
            </select>
          </FilterField>
          <FilterField label="Request date from">
            <input type="date" className="input" value={values.from} onChange={(e) => set({ from: e.target.value })} />
          </FilterField>
          <FilterField label="to">
            <input type="date" className="input" value={values.to} onChange={(e) => set({ to: e.target.value })} />
          </FilterField>
          <FilterField label="Review flag">
            <select className="input" value={values.flagged} onChange={(e) => set({ flagged: e.target.value })}>
              <option value="">Any</option>
              <option value="true">Flagged for review</option>
            </select>
          </FilterField>
        </FilterBar>
        {q.error ? (
          <div className="p-4"><ErrorState error={q.error} /></div>
        ) : (
          <DataTable
            rows={q.data?.items}
            loading={q.isLoading}
            rowKey={(r) => r.id}
            onRowClick={(r) => navigate(`/requests/${r.id}`)}
            empty="No fuel requests match the filters."
            columns={[
              { key: "no", header: "Request No.", cell: (r) => <span className="font-medium text-navy-800">{r.requestNumber}{r.flaggedForReview && <Badge tone="red" className="ml-1.5">Flagged</Badge>}</span> },
              { key: "date", header: "Date", cell: (r) => dateOnly(r.requestDate) },
              { key: "vehicle", header: "Vehicle", cell: (r) => <><span className="font-medium">{r.vehicle.plateNumber}</span><span className="block text-xs text-slate-500">{r.vehicle.description}</span></> },
              { key: "req", header: "Requester", cell: (r) => <>{r.requester.fullName}<span className="block text-xs text-slate-500">{r.office?.code}</span></>, hideOnMobile: true },
              { key: "purpose", header: "Purpose", className: "wrap", cell: (r) => <span className="line-clamp-2 max-w-[260px]">{r.purpose}</span>, hideOnMobile: true },
              { key: "req-l", header: "Requested", align: "right", cell: (r) => liters(r.requestedLiters) },
              { key: "appr", header: "Approved", align: "right", cell: (r) => (r.approvedLiters === null ? "—" : liters(r.approvedLiters)), hideOnMobile: true },
              { key: "iss", header: "Issued", align: "right", cell: (r) => (r.issuedLiters ? liters(r.issuedLiters) : "—"), hideOnMobile: true },
              { key: "cost", header: "Est. cost", align: "right", cell: (r) => peso(r.estimatedTotalCost), hideOnMobile: true },
              { key: "status", header: "Status", cell: (r) => <StatusBadge status={r.status} /> },
            ]}
          />
        )}
        {q.data && <Pagination page={q.data.page} pages={q.data.pages} total={q.data.total} pageSize={q.data.pageSize} onPage={(p) => set({ page: String(p) })} />}
      </div>
    </div>
  );
}
