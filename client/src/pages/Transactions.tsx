import { useQuery } from "@tanstack/react-query";
import { Fuel, Search } from "lucide-react";
import { useState } from "react";
import { useNavigate } from "react-router";
import { ExportButtons } from "../components/ExportMenu";
import { IssueFuelModal } from "../components/IssueFuelModal";
import { Badge, Button, DataTable, ErrorState, FilterBar, FilterField, PageHeader, Pagination, ReadingTypeBadge, TxStatusBadge } from "../components/ui";
import { api, type Paged } from "../lib/api";
import { useAuth } from "../lib/auth";
import { dateTime, km, liters, peso } from "../lib/format";
import { useFuelTypes, useListParams, usePeople, useVehicleOptions } from "../lib/hooks";

interface TxRow {
  id: number; transactionNumber: string; transactionDate: string; litersIssued: number; pricePerLiter: number; totalCost: number; requestedLiters: number | null; approvedLiters: number | null;
  status: string; receiptNumber: string | null; station: string | null;
  vehicle: { plateNumber: string; description: string }; fuelType: { name: string }; request: { id: number; requestNumber: string } | null;
  encodedBy: { fullName: string }; verifiedBy: { fullName: string } | null;
  odometerLog: { readingType: string; actualOdometer: number | null; estimatedOdometer: number | null; verificationStatus: string } | null;
}

export default function TransactionsPage() {
  const { can } = useAuth();
  const navigate = useNavigate();
  const [issue, setIssue] = useState(false);
  const defaults = { q: "", from: "", to: "", vehicleId: "", fuelTypeId: "", encodedById: "", status: "ACTIVE", verified: "" };
  const { values, set, reset, page } = useListParams(defaults);
  const vehicles = useVehicleOptions();
  const fuelTypes = useFuelTypes();
  const people = usePeople();
  const q = useQuery({ queryKey: ["transactions", values], queryFn: () => api.get<Paged<TxRow> & { totals: { liters: number; cost: number } }>("/transactions", { ...values, page, pageSize: 25 }), placeholderData: (p) => p });
  return (
    <div>
      <PageHeader
        title="Fuel Transaction Log"
        subtitle="Actual fuel issued — requested, approved and issued quantities are kept separate"
        crumbs={[{ label: "Dashboard", to: "/" }, { label: "Fuel Transaction Log" }]}
        actions={
          <>
            {can("report.export") && <ExportButtons report="issuance" params={{ from: values.from, to: values.to, vehicleId: values.vehicleId, fuelTypeId: values.fuelTypeId, encodedById: values.encodedById, status: values.status === "ALL" ? undefined : values.status }} formats={["csv", "xlsx"]} />}
            {can("transaction.create") && <Button variant="success" icon={<Fuel className="size-4" />} onClick={() => setIssue(true)}>Direct issuance</Button>}
          </>
        }
      />
      <div className="card overflow-hidden">
        <FilterBar onReset={reset}>
          <FilterField label="Search" className="min-w-[200px] flex-1">
            <div className="relative">
              <Search className="pointer-events-none absolute top-2.5 left-2.5 size-4 text-slate-400" />
              <input className="input pl-8" placeholder="Transaction, request, plate, receipt, station" value={values.q} onChange={(e) => set({ q: e.target.value })} />
            </div>
          </FilterField>
          <FilterField label="From"><input type="date" className="input" value={values.from} onChange={(e) => set({ from: e.target.value })} /></FilterField>
          <FilterField label="To"><input type="date" className="input" value={values.to} onChange={(e) => set({ to: e.target.value })} /></FilterField>
          <FilterField label="Vehicle">
            <select className="input" value={values.vehicleId} onChange={(e) => set({ vehicleId: e.target.value })}>
              <option value="">All vehicles</option>
              {vehicles.data?.map((v) => <option key={v.id} value={v.id}>{v.plateNumber}</option>)}
            </select>
          </FilterField>
          <FilterField label="Fuel type">
            <select className="input" value={values.fuelTypeId} onChange={(e) => set({ fuelTypeId: e.target.value })}>
              <option value="">All</option>
              {fuelTypes.data?.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
            </select>
          </FilterField>
          <FilterField label="Encoder">
            <select className="input" value={values.encodedById} onChange={(e) => set({ encodedById: e.target.value })}>
              <option value="">Anyone</option>
              {people.data?.filter((p) => p.roles.includes("CUSTODIAN") || p.roles.includes("ADMIN")).map((p) => <option key={p.id} value={p.id}>{p.fullName}</option>)}
            </select>
          </FilterField>
          <FilterField label="Record status">
            <select className="input" value={values.status} onChange={(e) => set({ status: e.target.value })}>
              <option value="ACTIVE">Active</option>
              <option value="SUPERSEDED">Superseded (corrected)</option>
              <option value="VOIDED">Cancelled</option>
              <option value="ALL">All records</option>
            </select>
          </FilterField>
          <FilterField label="Verification">
            <select className="input" value={values.verified} onChange={(e) => set({ verified: e.target.value })}>
              <option value="">Any</option>
              <option value="true">Verified</option>
              <option value="false">Not verified</option>
            </select>
          </FilterField>
        </FilterBar>
        {q.error ? (
          <div className="p-4"><ErrorState error={q.error} /></div>
        ) : (
          <DataTable
            rows={q.data?.items}
            loading={q.isLoading}
            rowKey={(t) => t.id}
            onRowClick={(t) => navigate(`/transactions/${t.id}`)}
            empty="No transactions match the filters."
            columns={[
              { key: "no", header: "Transaction ID", cell: (t) => <span className="font-medium text-navy-800">{t.transactionNumber}</span> },
              { key: "d", header: "Date", cell: (t) => dateTime(t.transactionDate) },
              { key: "v", header: "Vehicle", cell: (t) => <><span className="font-medium">{t.vehicle.plateNumber}</span><span className="block text-xs text-slate-500">{t.fuelType.name}</span></> },
              { key: "r", header: "Request", cell: (t) => t.request?.requestNumber ?? <Badge tone="orange">Direct</Badge>, hideOnMobile: true },
              { key: "ra", header: "Req. / Appr.", align: "right", cell: (t) => (t.approvedLiters === null ? "—" : `${liters(t.requestedLiters)} / ${liters(t.approvedLiters)}`), hideOnMobile: true },
              { key: "l", header: "Issued", align: "right", cell: (t) => <span className="font-medium">{liters(t.litersIssued)}</span> },
              { key: "p", header: "Price/L", align: "right", cell: (t) => peso(t.pricePerLiter), hideOnMobile: true },
              { key: "c", header: "Total cost", align: "right", cell: (t) => peso(t.totalCost) },
              { key: "o", header: "Odometer", align: "right", cell: (t) => (t.odometerLog?.actualOdometer != null ? km(t.odometerLog.actualOdometer) : t.odometerLog?.estimatedOdometer != null ? <span className="text-violet-700 italic">≈ {km(t.odometerLog.estimatedOdometer)}</span> : "—"), hideOnMobile: true },
              { key: "ot", header: "Reading", cell: (t) => (t.odometerLog ? <ReadingTypeBadge type={t.odometerLog.readingType} /> : "—"), hideOnMobile: true },
              { key: "e", header: "Encoded / Verified", cell: (t) => <>{t.encodedBy.fullName}<span className="block text-xs text-slate-500">{t.verifiedBy ? `✓ ${t.verifiedBy.fullName}` : "Not verified"}</span></>, hideOnMobile: true },
              { key: "s", header: "Status", cell: (t) => <TxStatusBadge status={t.status} /> },
            ]}
            footer={
              q.data && q.data.total > 0 ? (
                <tr>
                  <td className="td" colSpan={5}>Totals for all {q.data.total} matching records</td>
                  <td className="td tabular text-right">{liters(q.data.totals.liters)}</td>
                  <td className="td hidden md:table-cell" />
                  <td className="td tabular text-right">{peso(q.data.totals.cost)}</td>
                  <td className="td" colSpan={4} />
                </tr>
              ) : undefined
            }
          />
        )}
        {q.data && <Pagination page={q.data.page} pages={q.data.pages} total={q.data.total} pageSize={q.data.pageSize} onPage={(p) => set({ page: String(p) })} />}
      </div>
      <IssueFuelModal open={issue} onClose={() => setIssue(false)} ctx={{}} onDone={(t) => navigate(`/transactions/${t.id}`)} />
    </div>
  );
}
