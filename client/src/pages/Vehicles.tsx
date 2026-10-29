import { useQuery } from "@tanstack/react-query";
import { Plus, Search } from "lucide-react";
import { useState } from "react";
import { useNavigate } from "react-router";
import { VEHICLE_STATUS, VehicleFormModal } from "../components/VehicleForm";
import { Badge, Button, DataTable, ErrorState, FilterBar, FilterField, PageHeader, Pagination } from "../components/ui";
import { api, type Paged } from "../lib/api";
import { useAuth } from "../lib/auth";
import { dateManila, km } from "../lib/format";
import { useFuelTypes, useListParams, useOffices } from "../lib/hooks";

interface VehicleRow { id: number; plateNumber: string; propertyNumber: string | null; description: string; classification: string; status: string; currentOdometer: number; currentOdometerAt: string | null; custodianName: string | null; fuelType: { name: string }; office: { name: string; code: string } | null; registrationExpiry: string | null }

export function VehicleStatusBadge({ status }: { status: string }) {
  const tone = status === "ACTIVE" ? "green" : status === "UNDER_REPAIR" ? "amber" : status === "RETIRED" ? "slate" : "red";
  return <Badge tone={tone}>{VEHICLE_STATUS[status as keyof typeof VEHICLE_STATUS] ?? status}</Badge>;
}

export default function VehiclesPage() {
  const { can } = useAuth();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const defaults = { q: "", status: "", officeId: "", fuelTypeId: "" };
  const { values, set, reset, page } = useListParams(defaults);
  const offices = useOffices();
  const fuelTypes = useFuelTypes();
  const q = useQuery({ queryKey: ["vehicles", values], queryFn: () => api.get<Paged<VehicleRow>>("/vehicles", { ...values, page, pageSize: 25 }), placeholderData: (p) => p });
  return (
    <div>
      <PageHeader title="Vehicle Management" subtitle="Registered fleet, linked to fuel requests, transactions and odometer records" crumbs={[{ label: "Dashboard", to: "/" }, { label: "Vehicles" }]} actions={can("vehicle.manage") && <Button icon={<Plus className="size-4" />} onClick={() => setOpen(true)}>Register vehicle</Button>} />
      <div className="card overflow-hidden">
        <FilterBar onReset={reset}>
          <FilterField label="Search" className="min-w-[220px] flex-1">
            <div className="relative">
              <Search className="pointer-events-none absolute top-2.5 left-2.5 size-4 text-slate-400" />
              <input className="input pl-8" placeholder="Plate, property / equipment no., description" value={values.q} onChange={(e) => set({ q: e.target.value })} />
            </div>
          </FilterField>
          <FilterField label="Status">
            <select className="input" value={values.status} onChange={(e) => set({ status: e.target.value })}>
              <option value="">All</option>
              {Object.entries(VEHICLE_STATUS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
          </FilterField>
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
        {q.error ? <div className="p-4"><ErrorState error={q.error} /></div> : (
          <DataTable
            rows={q.data?.items}
            loading={q.isLoading}
            rowKey={(v) => v.id}
            onRowClick={(v) => navigate(`/vehicles/${v.id}`)}
            empty="No vehicles match the filters."
            columns={[
              { key: "p", header: "Plate No.", cell: (v) => <><span className="font-medium text-navy-800">{v.plateNumber}</span><span className="block text-xs text-slate-500">{v.propertyNumber}</span></> },
              { key: "d", header: "Description", className: "wrap", cell: (v) => <>{v.description}<span className="block text-xs text-slate-500">{v.classification}</span></> },
              { key: "f", header: "Fuel", cell: (v) => v.fuelType.name, hideOnMobile: true },
              { key: "o", header: "Office", cell: (v) => v.office?.name ?? "—", hideOnMobile: true },
              { key: "c", header: "Driver / custodian", cell: (v) => v.custodianName ?? "—", hideOnMobile: true },
              { key: "odo", header: "Verified odometer", align: "right", cell: (v) => <>{km(v.currentOdometer)}<span className="block text-xs text-slate-500">{dateManila(v.currentOdometerAt)}</span></> },
              { key: "s", header: "Status", cell: (v) => <VehicleStatusBadge status={v.status} /> },
            ]}
          />
        )}
        {q.data && <Pagination page={q.data.page} pages={q.data.pages} total={q.data.total} pageSize={q.data.pageSize} onPage={(p) => set({ page: String(p) })} />}
      </div>
      <VehicleFormModal open={open} onClose={() => setOpen(false)} />
    </div>
  );
}
