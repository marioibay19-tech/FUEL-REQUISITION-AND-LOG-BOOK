import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Ban, CheckCircle2, Fuel, Pencil, Printer, Send, Undo2, UserCog, XCircle } from "lucide-react";
import { useState } from "react";
import { Link, useParams } from "react-router";
import { AttachmentsPanel, type AttachmentItem } from "../components/Attachments";
import { IssueFuelModal } from "../components/IssueFuelModal";
import { Badge, Button, ButtonLink, Card, ConfirmDialog, DataTable, DescList, ErrorState, Modal, Notice, PageHeader, SelectInput, Spinner, StatusBadge, TextArea, TextInput, TxStatusBadge, useToast, REQUEST_STATUS } from "../components/ui";
import { api } from "../lib/api";
import { useAuth } from "../lib/auth";
import { dateOnly, dateTime, km, liters, peso } from "../lib/format";
import { errorMessage, fieldErrors, usePeople } from "../lib/hooks";

interface Approval { id: number; action: string; previousStatus: string | null; newStatus: string; remarks: string | null; reason: string | null; approvedLiters: number | null; createdAt: string; actedBy: { fullName: string } }
interface Detail {
  id: number; requestNumber: string; status: string; requestDate: string; purpose: string; destination: string | null; travelDate: string | null; remarks: string | null; reason: string | null;
  requestedLiters: number; approvedLiters: number | null; issuedLiters: number; estimatedPricePerLiter: number; estimatedTotalCost: number; intendedFuelingDate: string | null;
  fuelTypeOverride: boolean; overrideReason: string | null; flaggedForReview: boolean; flagReasons: string[]; submittedAt: string | null; decidedAt: string | null; createdAt: string; odometerAtRequest: number | null; requesterId: number;
  vehicle: { id: number; plateNumber: string; description: string; classification: string; status: string; fuelTypeId: number; fuelType: { name: string }; office: { name: string } | null };
  requester: { id: number; fullName: string; position: string | null };
  fuelType: { id: number; name: string };
  office: { name: string } | null;
  assignedApprover: { id: number; fullName: string; position: string | null } | null;
  approvals: Approval[];
  transactions: { id: number; transactionNumber: string; transactionDate: string; litersIssued: number; pricePerLiter: number; totalCost: number; status: string; receiptNumber: string | null; encodedBy: { fullName: string } }[];
  attachments: AttachmentItem[];
  odometer: { latestVerified: { odometer: number; readingDate: string } | null; pendingCount: number; flaggedCount: number };
  actions: { edit: boolean; submit: boolean; decide: boolean; markReady: boolean; issue: boolean; cancel: boolean; reassign: boolean };
}

const ACTION_LABEL: Record<string, string> = { SUBMIT: "Submitted", RESUBMIT: "Resubmitted", APPROVE: "Approved", REJECT: "Rejected", RETURN: "Returned for revision", READY: "Marked ready for issuance", ISSUE: "Issuance recorded", CANCEL: "Cancelled", REASSIGN: "Reassigned" };

export default function RequestDetailPage() {
  const { id } = useParams();
  const { user } = useAuth();
  const qc = useQueryClient();
  const toast = useToast();
  const key = ["request", id];
  const q = useQuery({ queryKey: key, queryFn: () => api.get<Detail>(`/requests/${id}`) });
  const [decision, setDecision] = useState<null | "APPROVE" | "REJECT" | "RETURN">(null);
  const [form, setForm] = useState({ approvedLiters: "", remarks: "", reason: "" });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [issue, setIssue] = useState(false);
  const [cancel, setCancel] = useState(false);
  const [ready, setReady] = useState(false);
  const [submitConfirm, setSubmitConfirm] = useState(false);
  const [reassign, setReassign] = useState(false);
  const [approverId, setApproverId] = useState("");
  const people = usePeople(!!q.data?.actions.reassign);

  const refresh = () => {
    for (const k of ["request", "requests", "dashboard", "notifications"]) qc.invalidateQueries({ queryKey: [k] });
  };
  const act = useMutation({
    mutationFn: ({ url, body }: { url: string; body?: unknown }) => api.post(url, body),
    onSuccess: (_d, v) => {
      const msg = v.url.endsWith("/decision") ? { APPROVE: "Request approved", REJECT: "Request rejected", RETURN: "Request returned for revision" }[decision ?? "APPROVE"] : v.url.endsWith("/cancel") ? "Request cancelled" : v.url.endsWith("/ready") ? "Marked ready for issuance" : v.url.endsWith("/submit") ? "Request submitted" : "Approver reassigned";
      toast({ tone: "success", title: msg });
      setDecision(null);
      setCancel(false);
      setReady(false);
      setSubmitConfirm(false);
      setReassign(false);
      setErrors({});
      refresh();
    },
    onError: (e) => {
      setErrors(fieldErrors(e));
      if (!Object.keys(fieldErrors(e)).length) toast({ tone: "error", title: "Action failed", body: errorMessage(e) });
    },
  });

  if (q.isLoading) return <Spinner />;
  if (q.error) return <ErrorState error={q.error} />;
  const r = q.data!;
  const a = r.actions;
  const remaining = (r.approvedLiters ?? 0) - r.issuedLiters;

  return (
    <div>
      <PageHeader
        title={`Fuel Request ${r.requestNumber}`}
        subtitle={<span className="flex flex-wrap items-center gap-2"><StatusBadge status={r.status} />{r.flaggedForReview && <Badge tone="red">Flagged for review</Badge>}<span>Requested by {r.requester.fullName} · {dateTime(r.submittedAt ?? r.createdAt)}</span></span>}
        crumbs={[{ label: "Dashboard", to: "/" }, { label: "Fuel Requests", to: "/requests" }, { label: r.requestNumber }]}
        actions={
          <>
            <Button variant="secondary" icon={<Printer className="size-4" />} onClick={() => window.print()}>Print</Button>
            {a.edit && <ButtonLink to={`/requests/${r.id}/edit`} variant="secondary" icon={<Pencil className="size-4" />}>Edit</ButtonLink>}
            {a.submit && <Button icon={<Send className="size-4" />} onClick={() => setSubmitConfirm(true)}>Submit</Button>}
            {a.reassign && <Button variant="secondary" icon={<UserCog className="size-4" />} onClick={() => setReassign(true)}>Reassign</Button>}
            {a.cancel && <Button variant="secondary" icon={<Ban className="size-4" />} onClick={() => setCancel(true)}>Cancel request</Button>}
            {a.markReady && <Button variant="secondary" onClick={() => setReady(true)}>Mark ready for issuance</Button>}
            {a.issue && <Button variant="success" icon={<Fuel className="size-4" />} onClick={() => setIssue(true)}>Record issuance</Button>}
          </>
        }
      />
      <div className="print-only mb-4">
        <p className="text-xs">FUELTRACK — printed {dateTime(new Date())} by {user?.fullName}</p>
      </div>

      {r.flaggedForReview && <Notice tone="warning" title="Flagged for review" className="mb-4"><ul className="list-disc pl-4">{r.flagReasons.map((f) => <li key={f}>{f}</li>)}</ul></Notice>}

      {a.decide && (
        <Card className="no-print mb-4 border-amber-300 bg-amber-50/40" title="Decision required" subtitle="Review the request details below, then approve, reject or return it.">
          <div className="flex flex-wrap gap-2">
            <Button variant="success" icon={<CheckCircle2 className="size-4" />} onClick={() => { setForm({ approvedLiters: String(r.requestedLiters), remarks: "", reason: "" }); setDecision("APPROVE"); }}>Approve</Button>
            <Button variant="secondary" icon={<Undo2 className="size-4" />} onClick={() => { setForm({ approvedLiters: "", remarks: "", reason: "" }); setDecision("RETURN"); }}>Return for revision</Button>
            <Button variant="danger" icon={<XCircle className="size-4" />} onClick={() => { setForm({ approvedLiters: "", remarks: "", reason: "" }); setDecision("REJECT"); }}>Reject</Button>
          </div>
        </Card>
      )}

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          <Card title="Request information">
            <DescList
              cols={3}
              items={[
                { label: "Request number", value: r.requestNumber },
                { label: "Request date", value: dateOnly(r.requestDate) },
                { label: "Office / division", value: r.office?.name },
                { label: "Requester", value: <>{r.requester.fullName}{r.requester.position && <span className="block text-xs text-slate-500">{r.requester.position}</span>}</> },
                { label: "Destination / route", value: r.destination },
                { label: "Date of intended travel", value: dateOnly(r.travelDate) },
                { label: "Purpose", value: r.purpose, full: true },
                { label: "Reason", value: r.reason },
                { label: "Remarks", value: r.remarks, full: true },
              ]}
            />
          </Card>
          <Card title="Vehicle and fuel">
            <DescList
              cols={3}
              items={[
                { label: "Vehicle", value: <Link className="font-medium text-navy-700 hover:underline" to={`/vehicles/${r.vehicle.id}`}>{r.vehicle.plateNumber}</Link> },
                { label: "Description", value: r.vehicle.description },
                { label: "Vehicle type", value: r.vehicle.classification },
                { label: "Assigned office", value: r.vehicle.office?.name },
                { label: "Fuel type", value: <>{r.fuelType.name}{r.fuelTypeOverride && <Badge tone="orange" className="ml-1.5">Differs from {r.vehicle.fuelType.name}</Badge>}</> },
                { label: "Odometer at request (verified)", value: km(r.odometerAtRequest) },
                ...(r.fuelTypeOverride ? [{ label: "Reason for different fuel type", value: r.overrideReason, full: true }] : []),
              ]}
            />
            <div className="mt-4 grid grid-cols-2 gap-3 border-t border-slate-100 pt-4 sm:grid-cols-4">
              {[
                ["Requested", liters(r.requestedLiters)],
                ["Approved", r.approvedLiters === null ? "—" : liters(r.approvedLiters)],
                ["Actually issued", liters(r.issuedLiters)],
                ["Estimated cost", peso(r.estimatedTotalCost)],
              ].map(([l, v]) => (
                <div key={l} className="rounded-md bg-slate-50 px-3 py-2">
                  <p className="text-xs text-slate-500">{l}</p>
                  <p className="tabular text-base font-semibold text-slate-900">{v}</p>
                </div>
              ))}
            </div>
            <p className="mt-2 text-xs text-slate-500">Estimated price {peso(r.estimatedPricePerLiter)}/L · intended fueling date {dateOnly(r.intendedFuelingDate)}. Requested and approved quantities are not fuel consumption; only recorded issuance counts as fuel issued.</p>
          </Card>
          <Card title="Fuel issuance" subtitle={r.approvedLiters ? `${liters(Math.max(0, remaining))} of the approved quantity remain` : "Fuel is recorded only when actually dispensed"} bodyClass="p-0">
            <DataTable
              rows={r.transactions}
              rowKey={(t) => t.id}
              empty="No fuel issued yet."
              columns={[
                { key: "no", header: "Transaction", cell: (t) => <Link to={`/transactions/${t.id}`} className="font-medium text-navy-700 hover:underline">{t.transactionNumber}</Link> },
                { key: "d", header: "Date", cell: (t) => dateTime(t.transactionDate) },
                { key: "l", header: "Liters", align: "right", cell: (t) => liters(t.litersIssued) },
                { key: "c", header: "Total cost", align: "right", cell: (t) => peso(t.totalCost) },
                { key: "r", header: "Receipt", cell: (t) => t.receiptNumber ?? "—", hideOnMobile: true },
                { key: "s", header: "Status", cell: (t) => <TxStatusBadge status={t.status} /> },
              ]}
            />
          </Card>
          <Card title="Supporting documents">
            <AttachmentsPanel items={r.attachments} entityType="FUEL_REQUEST" entityId={r.id} canUpload={r.requesterId === user?.id && ["DRAFT", "RETURNED", "PENDING_APPROVAL"].includes(r.status)} queryKey={key} />
          </Card>
        </div>
        <div className="space-y-4">
          <Card title="Approval">
            <DescList cols={2} items={[{ label: "Assigned approving officer", value: r.assignedApprover ? <>{r.assignedApprover.fullName}<span className="block text-xs text-slate-500">{r.assignedApprover.position}</span></> : r.status === "DRAFT" ? "Assigned on submission" : "Administrator", full: true }, { label: "Decided", value: dateTime(r.decidedAt), full: true }]} />
          </Card>
          <Card title="Approval history">
            {r.approvals.length === 0 ? (
              <p className="text-sm text-slate-500">Not yet submitted.</p>
            ) : (
              <ol className="relative space-y-4 border-l border-slate-200 pl-4">
                {r.approvals.map((h) => (
                  <li key={h.id} className="relative">
                    <span className="absolute top-1 -left-[21px] size-2.5 rounded-full border-2 border-white bg-navy-600 ring-1 ring-navy-200" />
                    <p className="text-sm font-medium text-slate-800">{ACTION_LABEL[h.action] ?? h.action}</p>
                    <p className="text-xs text-slate-500">{h.actedBy.fullName} · {dateTime(h.createdAt)}</p>
                    <p className="mt-0.5 text-xs text-slate-500">{h.previousStatus ? `${REQUEST_STATUS[h.previousStatus]?.label ?? h.previousStatus} → ` : ""}{REQUEST_STATUS[h.newStatus]?.label ?? h.newStatus}{h.approvedLiters !== null ? ` · ${liters(h.approvedLiters)} approved` : ""}</p>
                    {h.reason && <p className="mt-1 rounded bg-slate-50 px-2 py-1 text-xs text-slate-700">Reason: {h.reason}</p>}
                    {h.remarks && <p className="mt-1 text-xs text-slate-600">{h.remarks}</p>}
                  </li>
                ))}
              </ol>
            )}
          </Card>
        </div>
      </div>

      <Modal
        open={!!decision}
        onClose={() => setDecision(null)}
        size="sm"
        title={decision === "APPROVE" ? "Approve request" : decision === "REJECT" ? "Reject request" : "Return for revision"}
        footer={
          <>
            <Button variant="secondary" onClick={() => setDecision(null)}>Cancel</Button>
            <Button variant={decision === "REJECT" ? "danger" : decision === "APPROVE" ? "success" : "primary"} loading={act.isPending} onClick={() => act.mutate({ url: `/requests/${r.id}/decision`, body: { action: decision, approvedLiters: decision === "APPROVE" ? form.approvedLiters : undefined, remarks: form.remarks, reason: form.reason } })}>
              {decision === "APPROVE" ? "Approve" : decision === "REJECT" ? "Reject" : "Return to requester"}
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          <p className="text-sm text-slate-600">{r.requestNumber} · {r.vehicle.plateNumber} · {liters(r.requestedLiters)} requested</p>
          {decision === "APPROVE" && <TextInput label="Approved liters" type="number" step="0.01" min="0" max={r.requestedLiters} value={form.approvedLiters} onChange={(e) => setForm({ ...form, approvedLiters: e.target.value })} error={errors.approvedLiters} hint="May be lower than requested. Approval does not record fuel as issued." />}
          {decision !== "APPROVE" && <TextArea label={decision === "REJECT" ? "Reason for rejection" : "What needs to be revised"} required value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })} error={errors.reason} />}
          <TextArea label="Remarks" value={form.remarks} onChange={(e) => setForm({ ...form, remarks: e.target.value })} rows={2} />
        </div>
      </Modal>

      <Modal open={cancel} onClose={() => setCancel(false)} size="sm" title="Cancel this request?" footer={<><Button variant="secondary" onClick={() => setCancel(false)}>Keep request</Button><Button variant="danger" loading={act.isPending} onClick={() => act.mutate({ url: `/requests/${r.id}/cancel`, body: { reason: form.reason } })}>Cancel request</Button></>}>
        <TextArea label="Reason for cancelling" required={r.status !== "DRAFT"} value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })} error={errors.reason} />
      </Modal>

      <ConfirmDialog open={ready} title="Mark ready for issuance?" onCancel={() => setReady(false)} onConfirm={() => act.mutate({ url: `/requests/${r.id}/ready`, body: {} })} loading={act.isPending} confirmLabel="Mark ready">
        The requester will be notified that fuel is ready to be issued for {r.vehicle.plateNumber}.
      </ConfirmDialog>

      <ConfirmDialog open={submitConfirm} title="Submit this request?" onCancel={() => setSubmitConfirm(false)} onConfirm={() => act.mutate({ url: `/requests/${r.id}/submit` })} loading={act.isPending} confirmLabel="Submit">
        {r.vehicle.plateNumber} · {liters(r.requestedLiters)} · {peso(r.estimatedTotalCost)}. The request will go to the approving officer.
        {Object.keys(errors).length > 0 && <Notice tone="danger" className="mt-3">{Object.values(errors).join(" ")}</Notice>}
      </ConfirmDialog>

      <Modal open={reassign} onClose={() => setReassign(false)} size="sm" title="Reassign approving officer" footer={<><Button variant="secondary" onClick={() => setReassign(false)}>Cancel</Button><Button loading={act.isPending} onClick={() => act.mutate({ url: `/requests/${r.id}/reassign`, body: { approverId } })}>Reassign</Button></>}>
        <SelectInput label="Approving officer" placeholder="Select" value={approverId} onChange={(e) => setApproverId(e.target.value)} error={errors.approverId} options={(people.data ?? []).filter((p) => p.isActive && p.roles.includes("APPROVER") && p.id !== r.requesterId).map((p) => ({ value: p.id, label: p.fullName }))} />
      </Modal>

      {a.issue && (
        <IssueFuelModal
          open={issue}
          onClose={() => setIssue(false)}
          ctx={{ request: { id: r.id, requestNumber: r.requestNumber, plateNumber: r.vehicle.plateNumber, fuelTypeName: r.fuelType.name, fuelTypeId: r.fuelType.id, requestedLiters: r.requestedLiters, approvedLiters: r.approvedLiters ?? 0, issuedLiters: r.issuedLiters, price: r.estimatedPricePerLiter } }}
        />
      )}
    </div>
  );
}
