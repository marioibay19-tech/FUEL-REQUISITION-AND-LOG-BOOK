import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { api } from "../lib/api";
import { isoDate } from "../lib/format";
import { errorMessage, useFuelTypes, useOffices, usePeople } from "../lib/hooks";
import { Button, Modal, SelectInput, TextArea, TextInput, useToast } from "./ui";

const schema = z.object({
  plateNumber: z.string().trim().min(1, "Plate number is required").max(20),
  propertyNumber: z.string().max(40).optional(),
  description: z.string().trim().min(1, "Description is required").max(200),
  make: z.string().max(60).optional(),
  model: z.string().max(60).optional(),
  year: z.string().optional(),
  classification: z.string().trim().min(1, "Classification is required").max(60),
  fuelTypeId: z.string().min(1, "Select a fuel type"),
  officeId: z.string().optional(),
  custodianName: z.string().max(120).optional(),
  custodianUserId: z.string().optional(),
  tankCapacityLiters: z.string().optional(),
  registrationExpiry: z.string().optional(),
  lastMaintenanceDate: z.string().optional(),
  nextMaintenanceDate: z.string().optional(),
  maintenanceNotes: z.string().max(2000).optional(),
  status: z.enum(["ACTIVE", "INACTIVE", "UNDER_REPAIR", "RETIRED"]),
  remarks: z.string().max(2000).optional(),
  initialOdometer: z.string().optional(),
});
type Values = z.infer<typeof schema>;

export const CLASSIFICATIONS = ["Service Vehicle", "Pick-up", "Van", "Dump Truck", "Boom Truck", "Water Truck", "Cargo Truck", "Motorcycle", "Ambulance", "Bus"];
export const VEHICLE_STATUS = { ACTIVE: "Active", INACTIVE: "Inactive", UNDER_REPAIR: "Under Repair", RETIRED: "Retired" } as const;

export function VehicleFormModal({ open, onClose, vehicle }: { open: boolean; onClose: () => void; vehicle?: Record<string, unknown> | null }) {
  const fuelTypes = useFuelTypes();
  const offices = useOffices();
  const people = usePeople(open);
  const qc = useQueryClient();
  const toast = useToast();
  const [server, setServer] = useState<Record<string, string>>({});
  const form = useForm<Values>({ resolver: zodResolver(schema), defaultValues: { status: "ACTIVE" } });
  useEffect(() => {
    if (!open) return;
    setServer({});
    const v = vehicle;
    const s = (k: string) => (v?.[k] === null || v?.[k] === undefined ? "" : String(v[k]));
    form.reset({
      plateNumber: s("plateNumber"), propertyNumber: s("propertyNumber"), description: s("description"), make: s("make"), model: s("model"), year: s("year"),
      classification: s("classification") || "Service Vehicle", fuelTypeId: s("fuelTypeId"), officeId: s("officeId"), custodianName: s("custodianName"), custodianUserId: s("custodianUserId"),
      tankCapacityLiters: s("tankCapacityLiters"), registrationExpiry: isoDate(v?.registrationExpiry as string), lastMaintenanceDate: isoDate(v?.lastMaintenanceDate as string),
      nextMaintenanceDate: isoDate(v?.nextMaintenanceDate as string), maintenanceNotes: s("maintenanceNotes"), status: (v?.status as Values["status"]) ?? "ACTIVE", remarks: s("remarks"), initialOdometer: "",
    });
  }, [open, vehicle]); // eslint-disable-line react-hooks/exhaustive-deps
  const m = useMutation({
    mutationFn: (v: Values) => {
      const body = { ...v, year: v.year || null, officeId: v.officeId || null, custodianUserId: v.custodianUserId || null, tankCapacityLiters: v.tankCapacityLiters || null, initialOdometer: v.initialOdometer };
      return vehicle ? api.put(`/vehicles/${vehicle.id}`, body) : api.post("/vehicles", body);
    },
    onSuccess: () => {
      toast({ tone: "success", title: vehicle ? "Vehicle updated" : "Vehicle registered" });
      for (const k of ["vehicles", "vehicle", "vehicle-options"]) qc.invalidateQueries({ queryKey: [k] });
      onClose();
    },
    onError: (e) => {
      const f = (e as { fields?: Record<string, string> }).fields ?? {};
      setServer(f);
      if (!Object.keys(f).length) toast({ tone: "error", title: "Could not save vehicle", body: errorMessage(e) });
    },
  });
  const err = (k: keyof Values) => (form.formState.errors[k]?.message as string | undefined) ?? server[k];
  return (
    <Modal open={open} onClose={onClose} size="xl" title={vehicle ? `Edit vehicle ${vehicle.plateNumber}` : "Register vehicle"} footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button loading={m.isPending} onClick={form.handleSubmit((v) => m.mutate(v))}>{vehicle ? "Save changes" : "Register vehicle"}</Button></>}>
      <form className="space-y-5" onSubmit={(e) => e.preventDefault()} noValidate>
        <fieldset className="grid gap-3 sm:grid-cols-3">
          <legend className="mb-2 text-sm font-semibold text-slate-800">Identification</legend>
          <TextInput label="Plate number" required {...form.register("plateNumber")} error={err("plateNumber")} />
          <TextInput label="Property / equipment number" {...form.register("propertyNumber")} error={err("propertyNumber")} />
          <SelectInput label="Status" options={Object.entries(VEHICLE_STATUS).map(([k, v]) => ({ value: k, label: v }))} {...form.register("status")} />
          <TextInput label="Vehicle description" required wrapperClass="sm:col-span-3" {...form.register("description")} error={err("description")} />
          <TextInput label="Make" {...form.register("make")} />
          <TextInput label="Model" {...form.register("model")} />
          <TextInput label="Year" type="number" min="1950" max="2100" {...form.register("year")} error={err("year")} />
          <div>
            <TextInput label="Classification" required list="classifications" {...form.register("classification")} error={err("classification")} />
            <datalist id="classifications">{CLASSIFICATIONS.map((c) => <option key={c} value={c} />)}</datalist>
          </div>
          <SelectInput label="Fuel type" required placeholder="Select" options={(fuelTypes.data ?? []).map((f) => ({ value: f.id, label: f.name }))} {...form.register("fuelTypeId")} error={err("fuelTypeId")} />
          <TextInput label="Tank capacity (L)" type="number" step="0.1" min="0" {...form.register("tankCapacityLiters")} error={err("tankCapacityLiters")} />
        </fieldset>
        <fieldset className="grid gap-3 sm:grid-cols-3">
          <legend className="mb-2 text-sm font-semibold text-slate-800">Assignment</legend>
          <SelectInput label="Assigned office / division" placeholder="None" options={(offices.data ?? []).map((o) => ({ value: o.id, label: o.name }))} {...form.register("officeId")} />
          <TextInput label="Assigned driver / custodian" {...form.register("custodianName")} />
          <SelectInput label="Custodian user account" placeholder="None" options={(people.data ?? []).filter((p) => p.isActive).map((p) => ({ value: p.id, label: p.fullName }))} {...form.register("custodianUserId")} hint="Lets that user request fuel for this vehicle" />
        </fieldset>
        <fieldset className="grid gap-3 sm:grid-cols-3">
          <legend className="mb-2 text-sm font-semibold text-slate-800">Registration and maintenance</legend>
          {!vehicle && <TextInput label="Current odometer reading (km)" type="number" step="0.1" min="0" required {...form.register("initialOdometer")} error={err("initialOdometer")} hint="Recorded as the verified baseline reading" />}
          <TextInput label="Registration expiration" type="date" {...form.register("registrationExpiry")} />
          <TextInput label="Last maintenance" type="date" {...form.register("lastMaintenanceDate")} />
          <TextInput label="Next maintenance due" type="date" {...form.register("nextMaintenanceDate")} />
          <TextArea label="Maintenance notes" wrapperClass="sm:col-span-3" rows={2} {...form.register("maintenanceNotes")} />
          <TextArea label="Remarks" wrapperClass="sm:col-span-3" rows={2} {...form.register("remarks")} />
        </fieldset>
        {vehicle && <p className="text-xs text-slate-500">The current odometer is maintained from verified readings in the Odometer Log and cannot be edited here.</p>}
      </form>
    </Modal>
  );
}
