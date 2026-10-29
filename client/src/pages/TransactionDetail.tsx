import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Ban, CheckCircle2, Pencil, Printer } from "lucide-react";
import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { AttachmentsPanel, type AttachmentItem } from "../components/Attachments";
import { IssueFuelModal } from "../components/IssueFuelModal";
import { Badge, Button, Card, ConfirmDialog, DescList, ErrorState, Modal, Notice, PageHeader, ReadingTypeBadge, Spinner, TextArea, TxStatusBadge, VerificationBadge, useToast } from "../components/ui";
import { api } from "../lib/api";
import { dateTime, km, kmpl, liters, peso } from "../lib/format";
import { errorMessage, fieldErrors } from "../lib/hooks";

interface Tx {
  id: number; transactionNumber: string; transactionDate: string; status: string; statusReason: string | null; litersIssued: number; pricePerLiter: number; totalCost: number;
  requestedLiters: number | null; approvedLiters: number | null; odometerReading: number | null; isFullTank: boolean; station: string | null; receiptNumber: string | null; remarks: string | null;
  verifiedAt: string | null; createdAt: string; fuelTypeId: number;
  vehicle: { id: number; plateNumber: string; description: string; office: { name: string } | null };
  fuelType: { name: string };
  request: { id: number; requestNumber: string; requester: { fullName: string } } | null;
  encodedBy: { fullName: string }; verifiedBy: { fullName: string } | null;
  odometerLog: { id: number; recordNumber: string; readingType: string; actualOdometer: number | null; estimatedOdometer: number | null; estimatedDistance: number | null; efficiencyKmPerLiter: number | null; verificationStatus: string; estimateStatus: string; isVoided: boolean } | null;
  corrects: { id: number; transactionNumber: string } | null;
  correctedBy: { id: number; transactionNumber: string } | null;
  attachments: AttachmentItem[];
  actions: { correct: boolean; void: boolean; verify: boolean; attach: boolean };
}

export default function TransactionDetailPage() {
  const { id } = useParams();
  const qc = useQueryClient();
  const toast = useToast();
  const navigate = useNavigate();
  const key = ["transaction", id];
  const q = useQuery({ queryKey: key, queryFn: () => api.get<Tx>(`/transactions/${id}`) });
  const [correct, setCorrect] = useState(false);
  const [voiding, setVoiding] = useState(false);
  const [verify, setVerify] = useState(false);
  const [reason, setReason] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const act = useMutation({
    mutationFn: ({ url, body }: { url: string; body?: unknown }) => api.post(url, body),
    onSuccess: (_d, v) => {
      toast({ tone: "success", title: v.url.endsWith("/void") ? "Transaction cancelled" : "Transaction verified", body: v.url.endsWith("/void") ? "The record is kept in the log for audit purposes." : undefined });
      setVoiding(false);
      setVerify(false);
      for (const k of ["transaction", "transactions", "request", "odometer", "dashboard"]) qc.invalidateQueries({ queryKey: [k] });
    },
    onError: (e) => {
      setErrors(fieldErrors(e));
      if (!Object.keys(fieldErrors(e)).length) toast({ tone: "error", title: "Action failed", body: errorMessage(e) });
    },
  });
  if (q.isLoading) return <Spinner />;
  if (q.error) return <ErrorState error={q.error} />;
  const t = q.data!;
  const o = t.odometerLog;
  return (
    <div>
      <PageHeader
        title={`Transaction ${t.transactionNumber}`}
        subtitle={<span className="flex flex-wrap items-center gap-2"><TxStatusBadge status={t.status} />{t.verifiedBy ? <Badge tone="green">Verified by {t.verifiedBy.fullName}</Badge> : <Badge tone="amber">Not verified</Badge>}<span>{dateTime(t.transactionDate)}</span></span>}
        crumbs={[{ label: "Dashboard", to: "/" }, { label: "Fuel Transaction Log", to: "/transactions" }, { label: t.transactionNumber }]}
        actions={
          <>
            <Button variant="secondary" icon={<Printer className="size-4" />} onClick={() => window.print()}>Print</Button>
            {t.actions.verify && <Button variant="success" icon={<CheckCircle2 className="size-4" />} onClick={() => setVerify(true)}>Verify</Button>}
            {t.actions.correct && <Button variant="secondary" icon={<Pencil className="size-4" />} onClick={() => setCorrect(true)}>Correct</Button>}
            {t.actions.void && <Button variant="secondary" icon={<Ban className="size-4" />} onClick={() => { setReason(""); setVoiding(true); }}>Cancel / reverse</Button>}
          </>
        }
      />
      {t.status === "SUPERSEDED" && <Notice tone="warning" className="mb-4" title="This record was corrected">Replaced by <Link className="font-medium underline" to={`/transactions/${t.correctedBy?.id}`}>{t.correctedBy?.transactionNumber}</Link>. Reason: {t.statusReason}</Notice>}
      {t.status === "VOIDED" && <Notice tone="danger" className="mb-4" title="This transaction was cancelled">Reason: {t.statusReason}. It no longer counts toward totals but is kept for audit.</Notice>}
      {t.corrects && <Notice tone="info" className="mb-4">This record corrects <Link className="font-medium underline" to={`/transactions/${t.corrects.id}`}>{t.corrects.transactionNumber}</Link>.</Notice>}
      <div className="grid gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          <Card title="Issuance details">
            <DescList
              cols={3}
              items={[
                { label: "Transaction ID", value: t.transactionNumber },
                { label: "Fuel request", value: t.request ? <Link className="text-navy-700 hover:underline" to={`/requests/${t.request.id}`}>{t.request.requestNumber}</Link> : <Badge tone="orange">Direct issuance</Badge> },
                { label: "Requester", value: t.request?.requester.fullName },
                { label: "Vehicle", value: <Link className="font-medium text-navy-700 hover:underline" to={`/vehicles/${t.vehicle.id}`}>{t.vehicle.plateNumber}</Link> },
                { label: "Description", value: t.vehicle.description },
                { label: "Fuel type", value: t.fuelType.name },
                { label: "Fuel station / supplier", value: t.station },
                { label: "Receipt / document no.", value: t.receiptNumber ?? <span className="text-amber-700">None recorded</span> },
                { label: "Tank filled to full", value: t.isFullTank ? "Yes" : "No" },
                { label: "Remarks", value: t.remarks, full: true },
              ]}
            />
            <div className="mt-4 grid grid-cols-2 gap-3 border-t border-slate-100 pt-4 sm:grid-cols-5">
              {[
                ["Requested", liters(t.requestedLiters)],
                ["Approved", liters(t.approvedLiters)],
                ["Actually issued", liters(t.litersIssued)],
                ["Price per liter", peso(t.pricePerLiter)],
                ["Actual total cost", peso(t.totalCost)],
              ].map(([l, v]) => (
                <div key={l} className="rounded-md bg-slate-50 px-3 py-2">
                  <p className="text-xs text-slate-500">{l}</p>
                  <p className="tabular text-sm font-semibold text-slate-900">{v}</p>
                </div>
              ))}
            </div>
            <p className="mt-2 text-xs text-slate-500">Actual total cost = {liters(t.litersIssued)} × {peso(t.pricePerLiter)} = {peso(t.totalCost)}</p>
          </Card>
          <Card title="Receipts and supporting documents">
            <AttachmentsPanel items={t.attachments} entityType="FUEL_TRANSACTION" entityId={t.id} canUpload={t.actions.attach} queryKey={key} />
          </Card>
        </div>
        <div className="space-y-4">
          <Card title="Odometer" actions={o && <Link to={`/odometer?record=${o.recordNumber}`} className="text-xs font-medium text-navy-700 hover:underline">Open in odometer log</Link>}>
            {!o ? (
              <p className="text-sm text-slate-500">No odometer record.</p>
            ) : (
              <DescList
                cols={2}
                items={[
                  { label: "Record", value: o.recordNumber },
                  { label: "Reading type", value: <ReadingTypeBadge type={o.readingType} /> },
                  { label: "Reading at fueling (as encoded)", value: km(t.odometerReading), full: true },
                  { label: "Actual (odometer log)", value: km(o.actualOdometer) },
                  { label: "Estimated", value: o.estimatedOdometer !== null ? <span className="text-violet-700 italic">≈ {km(o.estimatedOdometer)}</span> : o.estimateStatus === "INSUFFICIENT_DATA" ? "Insufficient data" : "—" },
                  { label: "Reference efficiency", value: kmpl(o.efficiencyKmPerLiter) },
                  { label: "Verification", value: <VerificationBadge status={o.verificationStatus} /> },
                ]}
              />
            )}
          </Card>
          <Card title="Accountability">
            <DescList cols={2} items={[{ label: "Encoded by", value: t.encodedBy.fullName }, { label: "Encoded at", value: dateTime(t.createdAt) }, { label: "Verified by", value: t.verifiedBy?.fullName }, { label: "Verified at", value: dateTime(t.verifiedAt) }]} />
          </Card>
        </div>
      </div>
      <IssueFuelModal
        open={correct}
        onClose={() => setCorrect(false)}
        onDone={(n) => navigate(`/transactions/${n.id}`)}
        ctx={{ correct: { id: t.id, transactionNumber: t.transactionNumber, transactionDate: t.transactionDate, litersIssued: t.litersIssued, pricePerLiter: t.pricePerLiter, odometerReading: t.odometerReading, isFullTank: t.isFullTank, station: t.station, receiptNumber: t.receiptNumber, remarks: t.remarks, fuelTypeId: t.fuelTypeId, plateNumber: t.vehicle.plateNumber } }}
      />
      <Modal open={voiding} onClose={() => setVoiding(false)} size="sm" title="Cancel / reverse this transaction?" footer={<><Button variant="secondary" onClick={() => setVoiding(false)}>Keep</Button><Button variant="danger" loading={act.isPending} onClick={() => act.mutate({ url: `/transactions/${t.id}/void`, body: { reason } })}>Cancel transaction</Button></>}>
        <p className="mb-3 text-sm text-slate-600">The record stays in the log marked as cancelled. Issued liters on the linked request and odometer estimates are recalculated.</p>
        <TextArea label="Reason" required value={reason} onChange={(e) => setReason(e.target.value)} error={errors.reason} />
      </Modal>
      <ConfirmDialog open={verify} title="Verify this transaction?" confirmLabel="Verify" tone="success" onCancel={() => setVerify(false)} onConfirm={() => act.mutate({ url: `/transactions/${t.id}/verify` })} loading={act.isPending}>
        Confirm that {liters(t.litersIssued)} at {peso(t.pricePerLiter)}/L ({peso(t.totalCost)}) matches the receipt {t.receiptNumber ?? "(none recorded)"}.
      </ConfirmDialog>
    </div>
  );
}
