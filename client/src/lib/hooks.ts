import { useQuery } from "@tanstack/react-query";
import { useCallback } from "react";
import { useSearchParams } from "react-router";
import { api, ApiError } from "./api";

/** Filter and paging state kept in the URL so views are bookmarkable and survive refresh. */
export function useListParams<T extends Record<string, string>>(defaults: T) {
  const [sp, setSp] = useSearchParams();
  const values = { ...defaults } as T & { page: string };
  for (const k of Object.keys(defaults)) if (sp.has(k)) (values as Record<string, string>)[k] = sp.get(k)!;
  values.page = sp.get("page") ?? "1";
  const set = useCallback(
    (patch: Partial<T> & { page?: string }) => {
      setSp(
        (prev) => {
          const next = new URLSearchParams(prev);
          for (const [k, v] of Object.entries(patch)) {
            if (v === undefined || v === "" || v === (defaults as Record<string, string>)[k]) next.delete(k);
            else next.set(k, String(v));
          }
          if (!("page" in patch)) next.delete("page");
          return next;
        },
        { replace: true },
      );
    },
    [setSp, defaults],
  );
  const reset = useCallback(() => setSp(new URLSearchParams(), { replace: true }), [setSp]);
  return { values, set, reset, page: Number(values.page) || 1 };
}

export interface FuelType { id: number; code: string; name: string; defaultPricePerLiter: number; active: boolean }
export interface Office { id: number; code: string; name: string; active: boolean; defaultApproverId: number | null; defaultApprover?: { id: number; fullName: string } | null }
export interface VehicleOption { id: number; plateNumber: string; description: string; status: string; fuelTypeId: number; officeId: number | null; classification: string }
export interface Person { id: number; fullName: string; isActive: boolean; roles: string[] }

export const useFuelTypes = () => useQuery({ queryKey: ["fuel-types"], queryFn: () => api.get<FuelType[]>("/lookups/fuel-types"), staleTime: 300_000 });
export const useOffices = () => useQuery({ queryKey: ["offices"], queryFn: () => api.get<Office[]>("/lookups/offices"), staleTime: 300_000 });
export const useVehicleOptions = (enabled = true) => useQuery({ queryKey: ["vehicle-options"], queryFn: () => api.get<VehicleOption[]>("/vehicles/options"), staleTime: 60_000, enabled });
export const usePeople = (enabled = true) => useQuery({ queryKey: ["people"], queryFn: () => api.get<Person[]>("/lookups/people"), staleTime: 60_000, enabled });

export const fieldErrors = (e: unknown): Record<string, string> => (e instanceof ApiError ? e.fields : {});
export const errorMessage = (e: unknown) => (e instanceof Error ? e.message : "Something went wrong");
