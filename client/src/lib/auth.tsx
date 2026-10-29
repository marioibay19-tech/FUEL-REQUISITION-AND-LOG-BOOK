import { useQuery, useQueryClient } from "@tanstack/react-query";
import { createContext, useContext, useEffect, type ReactNode } from "react";
import { api, ApiError } from "./api";

export interface Me {
  id: number;
  username: string;
  fullName: string;
  position: string | null;
  officeId: number | null;
  office: { id: number; code: string; name: string } | null;
  roles: string[];
  roleLabels: string[];
  permissions: string[];
  mustChangePassword: boolean;
}

interface AuthState {
  user: Me | null;
  loading: boolean;
  can: (...perms: string[]) => boolean;
  hasRole: (role: string) => boolean;
  refresh: () => Promise<unknown>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const qc = useQueryClient();
  const me = useQuery({
    queryKey: ["me"],
    queryFn: async () => {
      try {
        return (await api.get<{ user: Me }>("/auth/me")).user;
      } catch (e) {
        if (e instanceof ApiError && e.status === 401) return null;
        throw e;
      }
    },
    staleTime: 60_000,
    retry: false,
  });
  useEffect(() => {
    const onUnauthorized = () => qc.setQueryData(["me"], null);
    window.addEventListener("fueltrack:unauthorized", onUnauthorized);
    return () => window.removeEventListener("fueltrack:unauthorized", onUnauthorized);
  }, [qc]);
  const user = me.data ?? null;
  const value: AuthState = {
    user,
    loading: me.isLoading,
    can: (...perms) => !!user && perms.some((p) => user.permissions.includes(p)),
    hasRole: (role) => !!user && user.roles.includes(role),
    refresh: () => me.refetch(),
    logout: async () => {
      await api.post("/auth/logout").catch(() => undefined);
      qc.clear();
      qc.setQueryData(["me"], null);
    },
  };
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth outside AuthProvider");
  return ctx;
}
