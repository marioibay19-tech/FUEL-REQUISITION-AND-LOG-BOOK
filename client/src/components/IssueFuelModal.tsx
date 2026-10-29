import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { api } from "../lib/api";
import { fromManilaLocalInput, liters, peso, toManilaLocalInput, uid } from "../lib/format";
import { errorMessage, useFuelTypes, useVehicleOptions } from "../lib/hooks";
import { Button, Checkbox, Modal, Notice, ReadOnly, SelectInput, TextArea, TextInput, useToast } from "./ui";

const schema = z.object({
  vehicleId: z.string().optional(),
  fuelTypeId: z.string().optional(),
  transactionDate: z.string().min(1, "Enter the date and time of fueling"),
  litersIssued: z.coerce.number({ message: "Enter the liters issued" }).gt(0, "Liters issued must be greater than zero"),
  pricePerLiter: z.coerce.number({ message: "Enter the price per liter" }).min(0, "Price cannot be negative"),
  odometerReading: z.string().optional(),
  isFullTank: z.boolean(),
  station: z.string().max(150).optional(),
  receiptNumber: z.string().max(60).optional(),
  remarks: z.string().max(2000).optional(),
  reason: z.string().max(1000).optional(),
});
type Values = z.input<typeof schema>;

export interface IssueContext {
  request?: { id: number; requestNumber: string; plateNumber: string; fuelTypeName: string; fuelTypeId: number; requestedLiters: number; approvedLiters: number; issuedLiters: number; price: number };
  correct?: { id: number; transactionNumber: string; transactionDate: string; litersIssued: number; pricePerLiter: number; odometerReading: number | null; isFullTank: boolean; station: string | null; receiptNumber: string | null; remarks: string | null; fuelTypeId: number; plateNumber: string };
}

/** Record actual fuel issuance (from an approved request or direct), or correct an existing transaction. */
export function IssueFuelModal({ open, onClose, ctx, onDone }: { open: boolean; onClose: () => void; ctx: IssueContext; onDone?: (t: { id: number; transactionNumber: string }) => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const vehicles = useVehicleOptions(open && !ctx.request && !ctx.correct);
  const fuelTypes = useFuelTypes();
  const [token] = useState(uid);
  const [serverErrors, setServerErrors] = useState<Record<string, string>>({});
  const remaining = ctx.request ? Math.round((ctx.request.approvedLiters - ctx.request.issuedLiters) * 100) / 100 : null;
  const form = useForm<Values>({ resolver: zodResolver(schema), defaultValues: { isFullTank: true } });
  useEffect(() => {
    if (!open) return;
    setServerErrors({});
    const c = ctx.correct;
    form.reset(
      c
        ? { transactionDate: toManilaLocalInput(new Date(c.transactionDate)), litersIssued: c.litersIssued, pricePerLiter: c.pricePerLiter, odometerReading: c.odometerReading?.toString() ?? "", isFullTank: c.isFullTank, station: c.station ?? "", receiptNumber: c.receiptNumber ?? "", remarks: c.remarks ?? "", fuelTypeId: String(c.fuelTypeId), reason: "" }
        : { transactionDate: toManilaLocalInput(new Date()), litersIssued: remaining ?? ("" as unknown as number), pricePerLiter: ctx.request?.price ?? ("" as unknown as number), isFullTank: true, odometerReading: "", station: "", receiptNumber: "", remarks: "", vehicleId: "" },
    );
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
  const w = form.watch();
  const total = useMemo(() => {
    const l = Number(w.litersIssued);
    const p = Number(w.pricePerLiter);
    return l > 0 && p >= 0 ? Math.round(l * p * 100) / 100 : null;
  }, [w.litersIssued, w.pricePerLiter]);
  const selectedVehicle = vehicles.data?.find((v) => String(v.id) === w.vehicleId);
  useEffect(() => {
    if (selectedVehicle && !ctx.correct) {
      form.setValue("fuelTypeId", String(selectedVehicle.fuelTypeId));
      const ft = fuelTypes.data?.find((f) => f.id === selectedVehicle.fuelTypeId);
      if (ft && !w.pricePerLiter) form.setValue("pricePerLiter", ft.defaultPricePerLiter);
    }
  }, [selectedVehicle?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const m = useMutation({
    mutationFn: (v: Values) => {
      const body = {
        transactionDate: fromManilaLocalInput(v.transactionDate),
        litersIssued: Number(v.litersIssued),
        pricePerLiter: Number(v.pricePerLiter),
        odometerReading: v.odometerReading === "" ? null : Number(v.odometerReading),
        isFullTank: v.isFullTank,
        station: v.station,
        receiptNumber: v.receiptNumber,
        remarks: v.remarks,
      };
      if (ctx.correct) return api.post<{ id: number; transactionNumber: string }>(`/transactions/${ctx.correct.id}/correct`, { ...body, fuelTypeId: Number(v.fuelTypeId), reason: v.reason });
      return api.post<{ id: number; transactionNumber: string }>("/transactions", { ...body, clientToken: token, requestId: ctx.request?.id, vehicleId: ctx.request ? undefined : Number(v.vehicleId) || undefined, fuelTypeId: ctx.request ? undefined : Number(v.fuelTypeId) || undefined });
    },
    onSuccess: (t) => {
      toast({ tone: "success", title: ctx.correct ? `Correction saved as ${t.transactionNumber}` : `Fuel issuance ${t.transactionNumber} recorded`, body: ctx.correct ? "The original record was kept and marked as superseded." : "The odometer log was updated automatically." });
      for (const k of ["transactions", "request", "requests", "odometer", "dashboard", "vehicle", "transaction", "notifications"]) qc.invalidateQueries({ queryKey: [k] });
      onDone?.(t);
      onClose();
    },
    onError: (e) => {
      const f = (e as { fields?: Record<string, string> }).fields ?? {};
      setServerErrors(f);
      if (!Object.keys(f).length) toast({ tone: "error", title: "Could not save the transaction", body: errorMessage(e) });
    },
  });
  const err = (k: keyof Values) => (form.formState.errors[k]?.message as string | undefined) ?? serverErrors[k];

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="lg"
      title={ctx.correct ? `Correct transaction ${ctx.correct.transactionNumber}` : ctx.request ? `Record fuel issuance — ${ctx.request.requestNumber}` : "Record direct fuel issuance"}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={m.isPending}>Cancel</Button>
          <Button onClick={form.handleSubmit((v) => m.mutate(v))} loading={m.isPending}>{ctx.correct ? "Save correction" : "Confirm issuance"}</Button>
        </>
      }
    >
      <form className="space-y-4" onSubmit={(e) => e.preventDefault()} noValidate>
        {ctx.request && (
          <div className="grid gap-3 sm:grid-cols-4">
            <ReadOnly label="Vehicle" value={ctx.request.plateNumber} />
            <ReadOnly label="Fuel type" value={ctx.request.fuelTypeName} />
            <ReadOnly label="Requested / Approved" value={`${liters(ctx.request.requestedLiters)} / ${liters(ctx.request.approvedLiters)}`} />
            <ReadOnly label="Remaining to issue" value={<span className="font-medium">{liters(remaining)}</span>} />
          </div>
        )}
        {ctx.correct && <Notice tone="info">Corrections create a new transaction record. The original stays in the log as <em>superseded</em> with your reason, and its odometer reading is preserved.</Notice>}
        {!ctx.request && !ctx.correct && (
          <>
            <Notice tone="warning">Use direct issuance only when fuel is released without an approved request (e.g. emergency). Explain why in the remarks.</Notice>
            <div className="grid gap-3 sm:grid-cols-2">
              <SelectInput label="Vehicle" required placeholder="Select a vehicle" options={(vehicles.data ?? []).filter((v) => v.status !== "RETIRED" && v.status !== "INACTIVE").map((v) => ({ value: v.id, label: `${v.plateNumber} — ${v.description}` }))} {...form.register("vehicleId")} error={err("vehicleId")} />
              <SelectInput label="Fuel type" options={(fuelTypes.data ?? []).filter((f) => f.active).map((f) => ({ value: f.id, label: f.name }))} placeholder="Vehicle's fuel type" {...form.register("fuelTypeId")} error={err("fuelTypeId")} />
            </div>
          </>
        )}
        <div className="grid gap-3 sm:grid-cols-3">
          <TextInput label="Date and time of fueling" type="datetime-local" required {...form.register("transactionDate")} error={err("transactionDate")} hint="Asia/Manila time" />
          <TextInput label="Actual liters issued" type="number" step="0.01" min="0" required {...form.register("litersIssued")} error={err("litersIssued")} />
          <TextInput label="Actual price per liter (PHP)" type="number" step="0.01" min="0" required {...form.register("pricePerLiter")} error={err("pricePerLiter")} />
        </div>
        <div className="flex items-center justify-between rounded-md bg-navy-50 px-3 py-2 text-sm">
          <span className="text-navy-900">Actual total cost = liters × price per liter</span>
          <span className="tabular text-base font-semibold text-navy-900">{total === null ? "—" : peso(total)}</span>
        </div>
        <div className="grid gap-3 sm:grid-cols-3">
          <TextInput label="Odometer reading at fueling (km)" type="number" step="0.1" min="0" {...form.register("odometerReading")} error={err("odometerReading")} hint="Leave blank if not read — an estimate will be computed and labelled as such." />
          <TextInput label="Fuel station / supplier" {...form.register("station")} error={err("station")} />
          <TextInput label="Receipt / document no." {...form.register("receiptNumber")} error={err("receiptNumber")} />
        </div>
        <Checkbox label="Tank filled to full" hint="Needed for verified full-tank-to-full-tank efficiency." {...form.register("isFullTank")} />
        <TextArea label="Remarks" rows={2} {...form.register("remarks")} error={err("remarks")} />
        {ctx.correct && <TextArea label="Reason for correction" required rows={2} {...form.register("reason")} error={err("reason")} />}
      </form>
    </Modal>
  );
}
