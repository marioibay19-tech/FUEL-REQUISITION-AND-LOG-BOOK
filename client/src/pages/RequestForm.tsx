import { zodResolver } from "@hookform/resolvers/zod";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, Paperclip, Save, Send, Trash2, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useForm } from "react-hook-form";
import { Link, useNavigate, useParams } from "react-router";
import { z } from "zod";
import { ACCEPT, checkFile, uploadAttachment } from "../components/Attachments";
import { Button, ButtonLink, Card, ConfirmDialog, DescList, ErrorState, Notice, PageHeader, ReadOnly, SelectInput, Spinner, StatusBadge, TextArea, TextInput, useToast } from "../components/ui";
import { api, ApiError } from "../lib/api";
import { useAuth } from "../lib/auth";
import { addDays, dateOnly, dateTime, isoDate, km, liters, peso, uid } from "../lib/format";
import { errorMessage, useFuelTypes, useOffices, useVehicleOptions } from "../lib/hooks";

const schema = z.object({
  officeId: z.string().min(1, "Select the office or division"),
  purpose: z.string().trim().min(1, "Purpose of request is required").max(500),
  destination: z.string().max(300).optional(),
  travelDate: z.string().optional(),
  remarks: z.string().max(2000).optional(),
  vehicleId: z.string().min(1, "Select a vehicle"),
  fuelTypeId: z.string().min(1, "Select a fuel type"),
  overrideReason: z.string().max(300).optional(),
  requestedLiters: z.coerce.number({ message: "Enter the requested liters" }).refine(Number.isFinite, "Enter a number").gt(0, "Requested liters must be greater than zero"),
  estimatedPricePerLiter: z.coerce.number({ message: "Enter the estimated price" }).min(0, "Price cannot be negative"),
  intendedFuelingDate: z.string().min(1, "Intended fueling date is required"),
  reason: z.string().max(500).optional(),
});
type Values = z.input<typeof schema>;

interface Meta { today: string; maxFuelingDaysAhead: number; allowFuelTypeOverride: boolean; requireAttachment: boolean }
interface VehicleSummary {
  id: number; plateNumber: string; description: string; classification: string; status: string; fuelTypeId: number; tankCapacityLiters: number | null;
  fuelType: { name: string }; office: { name: string } | null; currentOdometer: number;
  odometer: { latestVerified: { odometer: number; readingDate: string; recordNumber: string; transactionNumber: string | null } | null; latestEstimate: { odometer: number; readingDate: string } | null; pendingCount: number; flaggedCount: number };
}

const EMPTY: Values = { officeId: "", purpose: "", destination: "", travelDate: "", remarks: "", vehicleId: "", fuelTypeId: "", overrideReason: "", requestedLiters: "" as unknown as number, estimatedPricePerLiter: "" as unknown as number, intendedFuelingDate: "", reason: "" };

export default function RequestFormPage() {
  const { id } = useParams();
  const editing = !!id;
  const { user } = useAuth();
  const navigate = useNavigate();
  const toast = useToast();
  const qc = useQueryClient();
  const meta = useQuery({ queryKey: ["request-meta"], queryFn: () => api.get<Meta>("/requests/meta/form") });
  const vehicles = useVehicleOptions();
  const fuelTypes = useFuelTypes();
  const offices = useOffices();
  const existing = useQuery({ queryKey: ["request", id], queryFn: () => api.get<Record<string, unknown> & { requestNumber: string; status: string; actions: { edit: boolean }; approvals: { action: string; reason: string | null; createdAt: string; actedBy: { fullName: string } }[] }>(`/requests/${id}`), enabled: editing });

  const [token, setToken] = useState(uid);
  const [savedId, setSavedId] = useState<number | null>(id ? Number(id) : null);
  const [files, setFiles] = useState<File[]>([]);
  const [fileError, setFileError] = useState<string | null>(null);
  const [serverErrors, setServerErrors] = useState<Record<string, string>>({});
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState<"draft" | "submit" | null>(null);
  const [done, setDone] = useState<{ id: number; requestNumber: string; flagged: boolean; flags: string[] } | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  const form = useForm<Values>({ resolver: zodResolver(schema), defaultValues: EMPTY });
  const w = form.watch();

  useEffect(() => {
    if (!editing && user?.officeId && !form.getValues("officeId")) form.setValue("officeId", String(user.officeId));
  }, [user?.officeId, editing]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const r = existing.data as Record<string, unknown> | undefined;
    if (!r) return;
    form.reset({
      officeId: r.officeId ? String(r.officeId) : "",
      purpose: String(r.purpose ?? ""),
      destination: (r.destination as string) ?? "",
      travelDate: isoDate(r.travelDate as string),
      remarks: (r.remarks as string) ?? "",
      vehicleId: String(r.vehicleId),
      fuelTypeId: String(r.fuelTypeId),
      overrideReason: (r.overrideReason as string) ?? "",
      requestedLiters: Number(r.requestedLiters),
      estimatedPricePerLiter: Number(r.estimatedPricePerLiter),
      intendedFuelingDate: isoDate(r.intendedFuelingDate as string),
      reason: (r.reason as string) ?? "",
    });
  }, [existing.data]); // eslint-disable-line react-hooks/exhaustive-deps

  const vehicle = useQuery({ queryKey: ["vehicle-summary", w.vehicleId], queryFn: () => api.get<VehicleSummary>(`/vehicles/${w.vehicleId}/summary`), enabled: !!w.vehicleId });
  // When a vehicle is chosen, default the fuel type and price from its registration.
  const lastVehicle = useRef<string>("");
  useEffect(() => {
    const v = vehicle.data;
    if (!v || lastVehicle.current === String(v.id)) return;
    const first = lastVehicle.current === "" && editing;
    lastVehicle.current = String(v.id);
    if (first) return;
    form.setValue("fuelTypeId", String(v.fuelTypeId));
    const ft = fuelTypes.data?.find((f) => f.id === v.fuelTypeId);
    if (ft) form.setValue("estimatedPricePerLiter", ft.defaultPricePerLiter);
  }, [vehicle.data, fuelTypes.data]); // eslint-disable-line react-hooks/exhaustive-deps

  const total = useMemo(() => {
    const l = Number(w.requestedLiters);
    const p = Number(w.estimatedPricePerLiter);
    return l > 0 && p >= 0 && w.estimatedPricePerLiter !== "" ? Math.round(l * p * 100) / 100 : null;
  }, [w.requestedLiters, w.estimatedPricePerLiter]);
  const fuelMismatch = vehicle.data && w.fuelTypeId && Number(w.fuelTypeId) !== vehicle.data.fuelTypeId;
  const today = meta.data?.today ?? "";
  const maxDate = meta.data ? addDays(meta.data.today, meta.data.maxFuelingDaysAhead) : undefined;

  const err = (k: keyof Values) => (form.formState.errors[k]?.message as string | undefined) ?? serverErrors[k];

  const payload = (v: Values) => ({
    clientToken: savedId ? undefined : token,
    officeId: Number(v.officeId) || null,
    purpose: v.purpose,
    destination: v.destination,
    travelDate: v.travelDate,
    remarks: v.remarks,
    vehicleId: Number(v.vehicleId),
    fuelTypeId: Number(v.fuelTypeId),
    overrideReason: v.overrideReason,
    requestedLiters: Number(v.requestedLiters),
    estimatedPricePerLiter: Number(v.estimatedPricePerLiter),
    intendedFuelingDate: v.intendedFuelingDate,
    reason: v.reason,
  });

  async function save(v: Values) {
    const r = savedId ? await api.put<{ id: number; requestNumber: string }>(`/requests/${savedId}`, payload(v)) : await api.post<{ id: number; requestNumber: string }>("/requests", payload(v));
    setSavedId(r.id);
    if (files.length) {
      for (const f of files) await uploadAttachment("FUEL_REQUEST", r.id, f);
      setFiles([]);
    }
    return r;
  }

  const handleError = (e: unknown, what: string) => {
    const f = e instanceof ApiError ? e.fields : {};
    setServerErrors(f);
    toast({ tone: "error", title: `Could not ${what}`, body: Object.keys(f).length ? "Please correct the highlighted fields." : errorMessage(e) });
  };

  const saveDraft = form.handleSubmit(async (v) => {
    setBusy("draft");
    setServerErrors({});
    try {
      const r = await save(v);
      toast({ tone: "success", title: `Draft ${r.requestNumber} saved`, body: "You can submit it when it is complete." });
      qc.invalidateQueries({ queryKey: ["requests"] });
      if (!editing) navigate(`/requests/${r.id}/edit`, { replace: true });
    } catch (e) {
      handleError(e, "save the draft");
    } finally {
      setBusy(null);
    }
  });

  const openConfirm = form.handleSubmit(() => {
    if (meta.data?.requireAttachment && files.length === 0 && !((existing.data as { attachments?: unknown[] })?.attachments?.length)) {
      setFileError("A supporting document is required by office policy");
      return;
    }
    setConfirm(true);
  });

  const submit = async () => {
    if (busy) return; // guards against double clicks
    setBusy("submit");
    setServerErrors({});
    try {
      const r = await save(form.getValues());
      const s = await api.post<{ id: number; requestNumber: string; flaggedForReview: boolean; flagReasons: string[] }>(`/requests/${r.id}/submit`);
      setConfirm(false);
      setDone({ id: s.id, requestNumber: s.requestNumber, flagged: s.flaggedForReview, flags: s.flagReasons });
      toast({ tone: "success", title: `Request ${s.requestNumber} submitted`, body: "It is now pending approval." });
      for (const k of ["requests", "dashboard", "notifications", "request"]) qc.invalidateQueries({ queryKey: [k] });
    } catch (e) {
      setConfirm(false);
      handleError(e, "submit the request");
    } finally {
      setBusy(null);
    }
  };

  const clear = () => {
    form.reset({ ...EMPTY, officeId: user?.officeId ? String(user.officeId) : "" });
    setFiles([]);
    setServerErrors({});
    lastVehicle.current = "";
  };

  if (done)
    return (
      <div className="mx-auto max-w-xl py-10">
        <Card>
          <div className="text-center">
            <CheckCircle2 className="mx-auto size-12 text-emerald-600" />
            <h1 className="mt-3 text-lg font-semibold">Fuel request submitted</h1>
            <p className="mt-1 text-sm text-slate-600">
              Reference number <span className="font-semibold text-navy-800">{done.requestNumber}</span> is now <strong>Pending Approval</strong>. You will be notified when the approving officer acts on it.
            </p>
            {done.flagged && <Notice tone="warning" title="Flagged for review" className="mt-4 text-left">{done.flags.join("; ")}</Notice>}
            <div className="mt-6 flex justify-center gap-2">
              <ButtonLink to={`/requests/${done.id}`}>View submitted request</ButtonLink>
              <Button
                variant="secondary"
                onClick={() => {
                  setDone(null);
                  setSavedId(null);
                  setToken(uid());
                  clear();
                  navigate("/requests/new", { replace: true });
                }}
              >
                New request
              </Button>
            </div>
          </div>
        </Card>
      </div>
    );

  if (editing && existing.isLoading) return <Spinner />;
  if (editing && existing.error) return <ErrorState error={existing.error} />;
  if (editing && existing.data && !existing.data.actions.edit)
    return <Notice tone="warning" title="This request can no longer be edited">It is {existing.data.status.replaceAll("_", " ").toLowerCase()}. <Link className="underline" to={`/requests/${id}`}>View the request</Link>.</Notice>;

  const returned = existing.data?.status === "RETURNED" ? [...existing.data.approvals].reverse().find((a) => a.action === "RETURN") : null;
  const odo = vehicle.data?.odometer;
  const officeName = offices.data?.find((o) => String(o.id) === w.officeId)?.name;
  const vehicleOptions = (vehicles.data ?? []).map((v) => ({ value: v.id, label: `${v.plateNumber} — ${v.description}${v.status !== "ACTIVE" ? ` (${v.status.replace("_", " ").toLowerCase()})` : ""}`, disabled: v.status === "RETIRED" }));

  return (
    <div className="max-w-5xl">
      <PageHeader
        title={editing ? `Edit fuel request ${existing.data?.requestNumber ?? ""}` : "New Fuel Request"}
        subtitle="Complete each section. Fields marked * are required."
        crumbs={[{ label: "Dashboard", to: "/" }, { label: "Fuel Requests", to: "/requests" }, { label: editing ? "Edit" : "New request" }]}
        actions={existing.data && <StatusBadge status={existing.data.status} />}
      />
      {returned && <Notice tone="warning" title={`Returned for revision by ${returned.actedBy.fullName} on ${dateTime(returned.createdAt)}`} className="mb-4">{returned.reason}</Notice>}
      <form className="space-y-4" onSubmit={(e) => e.preventDefault()} noValidate>
        <Card title="A. Request information">
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <ReadOnly label="Request number" value={existing.data?.requestNumber ?? <span className="text-slate-400">Assigned automatically when saved</span>} />
            <ReadOnly label="Request date" value={dateOnly(`${today || new Date().toISOString().slice(0, 10)}T00:00:00Z`)} />
            <ReadOnly label="Requester" value={`${user?.fullName}${user?.position ? ` — ${user.position}` : ""}`} />
            <SelectInput label="Office or division" required placeholder="Select office" options={(offices.data ?? []).filter((o) => o.active).map((o) => ({ value: o.id, label: o.name }))} {...form.register("officeId")} error={err("officeId")} />
            <TextInput label="Destination or intended route" {...form.register("destination")} error={err("destination")} placeholder="e.g. San Fernando – Bauang – Naguilian" />
            <TextInput label="Date of intended travel" type="date" min={today} {...form.register("travelDate")} error={err("travelDate")} />
            <TextArea label="Purpose of request" required wrapperClass="sm:col-span-2 lg:col-span-3" rows={2} {...form.register("purpose")} error={err("purpose")} placeholder="Official activity the fuel is needed for" />
            <TextArea label="Remarks" wrapperClass="sm:col-span-2 lg:col-span-3" rows={2} {...form.register("remarks")} error={err("remarks")} />
          </div>
        </Card>

        <Card title="B. Vehicle information">
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <SelectInput label="Vehicle plate number" required wrapperClass="sm:col-span-2 lg:col-span-1" placeholder="Select a registered vehicle" options={vehicleOptions} {...form.register("vehicleId")} error={err("vehicleId")} />
            <ReadOnly label="Description / model" value={vehicle.data?.description} />
            <ReadOnly label="Vehicle type" value={vehicle.data?.classification} />
            <ReadOnly label="Assigned office or division" value={vehicle.data?.office?.name} />
            <ReadOnly label="Registered fuel type" value={vehicle.data?.fuelType.name} />
            <ReadOnly
              label="Latest verified odometer"
              value={odo?.latestVerified ? <span><span className="tabular font-medium">{km(odo.latestVerified.odometer)}</span> <span className="text-xs text-slate-500">· {dateTime(odo.latestVerified.readingDate)}{odo.latestVerified.transactionNumber ? ` · ${odo.latestVerified.transactionNumber}` : ""}</span></span> : vehicle.data ? "No verified reading" : undefined}
            />
          </div>
          {vehicle.data && vehicle.data.status !== "ACTIVE" && <Notice tone="danger" className="mt-3">This vehicle is {vehicle.data.status.replace("_", " ").toLowerCase()}. Requests can only be submitted for active vehicles.</Notice>}
          {odo && (odo.pendingCount > 0 || odo.flaggedCount > 0) && (
            <Notice tone="warning" className="mt-3" title="Unverified odometer records">
              This vehicle has {odo.pendingCount} pending{odo.flaggedCount ? ` and ${odo.flaggedCount} flagged` : ""} odometer record(s). The reading shown above is the latest verified one.
              {odo.latestEstimate && <> Latest estimate: <em>≈ {km(odo.latestEstimate.odometer)}</em> (estimated, not an instrument reading).</>}
            </Notice>
          )}
        </Card>

        <Card title="C. Fuel request information">
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <SelectInput label="Fuel type" required placeholder="Select fuel type" options={(fuelTypes.data ?? []).filter((f) => f.active).map((f) => ({ value: f.id, label: f.name }))} {...form.register("fuelTypeId")} error={err("fuelTypeId")} />
            <TextInput label="Requested fuel quantity (liters)" type="number" step="0.01" min="0" required {...form.register("requestedLiters")} error={err("requestedLiters")} hint={vehicle.data?.tankCapacityLiters ? `Tank capacity ${liters(vehicle.data.tankCapacityLiters)}` : undefined} />
            <TextInput label="Estimated price per liter (PHP)" type="number" step="0.01" min="0" required {...form.register("estimatedPricePerLiter")} error={err("estimatedPricePerLiter")} />
            <TextInput label="Intended fueling date" type="date" required min={today} max={maxDate} {...form.register("intendedFuelingDate")} error={err("intendedFuelingDate")} />
            <TextInput label="Reason for request" wrapperClass="lg:col-span-2" {...form.register("reason")} error={err("reason")} placeholder="e.g. Scheduled hauling, inspection" />
            {fuelMismatch && (
              <TextInput
                label="Reason for using a different fuel type"
                required
                wrapperClass="sm:col-span-2 lg:col-span-3"
                {...form.register("overrideReason")}
                error={err("overrideReason")}
                hint={meta.data?.allowFuelTypeOverride ? "The selected fuel type differs from the vehicle's registration; this request will be flagged for review." : "Office policy does not allow a different fuel type."}
              />
            )}
          </div>
          <div className="mt-4 flex flex-wrap items-center justify-between gap-2 rounded-md bg-navy-50 px-4 py-3">
            <span className="text-sm text-navy-900">Estimated total cost = requested liters × estimated price per liter</span>
            <span className="tabular text-lg font-semibold text-navy-900" aria-live="polite">{total === null ? "—" : peso(total)}</span>
          </div>
        </Card>

        <Card title="D. Supporting documents" subtitle={meta.data?.requireAttachment ? "Required by office policy" : "Optional (travel order, trip ticket, etc.)"}>
          <input
            ref={fileInput}
            type="file"
            accept={ACCEPT}
            multiple
            className="hidden"
            onChange={(e) => {
              const list = [...(e.target.files ?? [])];
              e.target.value = "";
              const bad = list.map(checkFile).find(Boolean);
              setFileError(bad ?? null);
              if (!bad) setFiles((f) => [...f, ...list]);
            }}
          />
          {files.length > 0 && (
            <ul className="mb-3 divide-y divide-slate-100 rounded-md border border-slate-200">
              {files.map((f, i) => (
                <li key={i} className="flex items-center justify-between px-3 py-2 text-sm">
                  <span className="flex items-center gap-2"><Paperclip className="size-4 text-slate-400" />{f.name} <span className="text-xs text-slate-400">{(f.size / 1024).toFixed(0)} KB · uploads when saved</span></span>
                  <button type="button" onClick={() => setFiles((xs) => xs.filter((_, j) => j !== i))} className="text-slate-400 hover:text-red-600" aria-label={`Remove ${f.name}`}><X className="size-4" /></button>
                </li>
              ))}
            </ul>
          )}
          {editing && ((existing.data as { attachments?: { id: number; originalName: string }[] })?.attachments?.length ?? 0) > 0 && (
            <p className="mb-2 text-sm text-slate-600">Already attached: {(existing.data as unknown as { attachments: { originalName: string }[] }).attachments.map((a) => a.originalName).join(", ")}</p>
          )}
          <Button variant="secondary" size="sm" icon={<Paperclip className="size-3.5" />} onClick={() => fileInput.current?.click()}>Add file</Button>
          <span className="ml-2 text-xs text-slate-500">PDF, JPG or PNG, up to 5 MB each</span>
          {(fileError || serverErrors.attachments) && <p className="mt-1 text-xs text-red-600">{fileError ?? serverErrors.attachments}</p>}
        </Card>

        <div className="no-print sticky bottom-0 -mx-4 flex flex-wrap justify-end gap-2 border-t border-slate-200 bg-white/95 px-4 py-3 backdrop-blur sm:mx-0 sm:rounded-lg sm:border">
          <Button variant="ghost" onClick={() => navigate(editing ? `/requests/${id}` : "/requests")} disabled={!!busy}>Cancel</Button>
          <Button variant="secondary" icon={<Trash2 className="size-4" />} onClick={clear} disabled={!!busy}>Clear form</Button>
          <Button variant="secondary" icon={<Save className="size-4" />} onClick={saveDraft} loading={busy === "draft"} disabled={busy === "submit"}>Save as draft</Button>
          <Button icon={<Send className="size-4" />} onClick={openConfirm} disabled={!!busy}>Submit request</Button>
        </div>
      </form>

      <ConfirmDialog open={confirm} title="Submit this fuel request?" confirmLabel="Submit request" onCancel={() => setConfirm(false)} onConfirm={submit} loading={busy === "submit"}>
        <p className="mb-3">Please review the summary. After submission the request goes to the approving officer and can no longer be edited unless it is returned.</p>
        <DescList
          cols={2}
          items={[
            { label: "Vehicle", value: vehicle.data ? `${vehicle.data.plateNumber} — ${vehicle.data.description}` : "", full: true },
            { label: "Office", value: officeName },
            { label: "Fuel type", value: fuelTypes.data?.find((f) => String(f.id) === w.fuelTypeId)?.name },
            { label: "Requested", value: liters(Number(w.requestedLiters)) },
            { label: "Estimated cost", value: peso(total) },
            { label: "Intended fueling date", value: w.intendedFuelingDate ? dateOnly(`${w.intendedFuelingDate}T00:00:00Z`) : "" },
            { label: "Travel date", value: w.travelDate ? dateOnly(`${w.travelDate}T00:00:00Z`) : "—" },
            { label: "Purpose", value: w.purpose, full: true },
            ...(files.length ? [{ label: "Documents to upload", value: files.map((f) => f.name).join(", "), full: true }] : []),
          ]}
        />
      </ConfirmDialog>
    </div>
  );
}
