import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import clsx from "clsx";
import {
  Activity,
  Bell,
  ChevronDown,
  ClipboardList,
  FileBarChart,
  FilePlus2,
  Fuel,
  Gauge,
  History,
  KeyRound,
  LayoutDashboard,
  LogOut,
  Menu,
  Settings,
  Truck,
  Users,
  X,
} from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { Link, NavLink, Outlet, useLocation, useNavigate } from "react-router";
import { api } from "../lib/api";
import { useAuth } from "../lib/auth";
import { dateTime } from "../lib/format";

interface NavItem { to: string; label: string; icon: ReactNode; perms: string[]; end?: boolean }

export const NAV: { section: string; items: NavItem[] }[] = [
  {
    section: "Overview",
    items: [{ to: "/", label: "Dashboard", icon: <LayoutDashboard className="size-4" />, perms: ["dashboard.view"], end: true }],
  },
  {
    section: "Fuel",
    items: [
      { to: "/requests", label: "Fuel Requests", icon: <ClipboardList className="size-4" />, perms: ["request.view_own", "request.view_all", "request.view_assigned", "request.view_issuable"], end: true },
      { to: "/requests/new", label: "New Fuel Request", icon: <FilePlus2 className="size-4" />, perms: ["request.create"] },
      { to: "/transactions", label: "Fuel Transaction Log", icon: <Fuel className="size-4" />, perms: ["transaction.view"] },
      { to: "/odometer", label: "Odometer Log", icon: <Gauge className="size-4" />, perms: ["odometer.view"] },
    ],
  },
  {
    section: "Fleet",
    items: [
      { to: "/vehicles", label: "Vehicle Management", icon: <Truck className="size-4" />, perms: ["vehicle.view"] },
      { to: "/monitoring", label: "Consumption Monitoring", icon: <Activity className="size-4" />, perms: ["monitoring.view"] },
      { to: "/reports", label: "Reports", icon: <FileBarChart className="size-4" />, perms: ["report.view"] },
    ],
  },
  {
    section: "Administration",
    items: [
      { to: "/users", label: "User Management", icon: <Users className="size-4" />, perms: ["user.manage"] },
      { to: "/settings", label: "System Settings", icon: <Settings className="size-4" />, perms: ["settings.manage"] },
      { to: "/audit", label: "Audit Trail", icon: <History className="size-4" />, perms: ["audit.view"] },
    ],
  },
];

export function Logo({ light }: { light?: boolean }) {
  return (
    <div className="flex items-center gap-2.5">
      <div className={clsx("flex size-9 items-center justify-center rounded-lg", light ? "bg-white/10" : "bg-navy-900")}>
        <Fuel className="size-5 text-white" />
      </div>
      <div className="leading-tight">
        <p className={clsx("text-[15px] font-bold tracking-wide", light ? "text-white" : "text-navy-900")}>FUELTRACK</p>
        <p className={clsx("text-[10.5px]", light ? "text-navy-200" : "text-slate-500")}>Fuel Request &amp; Odometer Monitoring</p>
      </div>
    </div>
  );
}

function Sidebar({ onNavigate }: { onNavigate?: () => void }) {
  const { can } = useAuth();
  return (
    <nav className="flex h-full flex-col bg-navy-900 text-navy-100" aria-label="Main">
      <div className="px-4 py-4">
        <Logo light />
      </div>
      <div className="flex-1 space-y-5 overflow-y-auto px-3 pb-6">
        {NAV.map((g) => {
          const items = g.items.filter((i) => can(...i.perms));
          if (!items.length) return null;
          return (
            <div key={g.section}>
              <p className="mb-1 px-2 text-[10.5px] font-semibold tracking-wider text-navy-300 uppercase">{g.section}</p>
              <ul className="space-y-0.5">
                {items.map((i) => (
                  <li key={i.to}>
                    <NavLink
                      to={i.to}
                      end={i.end}
                      onClick={onNavigate}
                      className={({ isActive }) =>
                        clsx("flex items-center gap-2.5 rounded-md px-2 py-2 text-[13px] font-medium transition-colors", isActive ? "bg-white/12 text-white" : "text-navy-100/85 hover:bg-white/6 hover:text-white")
                      }
                    >
                      {i.icon}
                      {i.label}
                    </NavLink>
                  </li>
                ))}
              </ul>
            </div>
          );
        })}
      </div>
      <p className="px-4 py-3 text-[10.5px] text-navy-300">Fuel Management, Vehicle Utilization, and Consumption Monitoring</p>
    </nav>
  );
}

interface NotificationItem { id: number; type: string; title: string; message: string; link: string | null; readAt: string | null; createdAt: string }

function useOutside(ref: React.RefObject<HTMLElement | null>, onOut: () => void) {
  useEffect(() => {
    const h = (e: MouseEvent) => ref.current && !ref.current.contains(e.target as Node) && onOut();
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, [ref, onOut]);
}

function Notifications() {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useOutside(ref, () => setOpen(false));
  const qc = useQueryClient();
  const navigate = useNavigate();
  const q = useQuery({ queryKey: ["notifications"], queryFn: () => api.get<{ items: NotificationItem[]; unread: number }>("/notifications"), refetchInterval: 60_000 });
  const readOne = useMutation({ mutationFn: (id: number) => api.post(`/notifications/${id}/read`), onSuccess: () => qc.invalidateQueries({ queryKey: ["notifications"] }) });
  const readAll = useMutation({ mutationFn: () => api.post("/notifications/read-all"), onSuccess: () => qc.invalidateQueries({ queryKey: ["notifications"] }) });
  const unread = q.data?.unread ?? 0;
  return (
    <div className="relative" ref={ref}>
      <button onClick={() => setOpen((o) => !o)} className="relative rounded-md p-2 text-slate-500 hover:bg-slate-100 hover:text-slate-700" aria-label={`Notifications, ${unread} unread`}>
        <Bell className="size-5" />
        {unread > 0 && <span className="absolute top-1 right-1 flex min-w-4 items-center justify-center rounded-full bg-red-600 px-1 text-[10px] leading-4 font-semibold text-white">{unread > 99 ? "99+" : unread}</span>}
      </button>
      {open && (
        <div className="absolute right-0 z-40 mt-2 w-[min(380px,calc(100vw-1.5rem))] overflow-hidden rounded-lg border border-slate-200 bg-white shadow-xl">
          <div className="flex items-center justify-between border-b border-slate-100 px-4 py-2.5">
            <p className="text-sm font-semibold">Notifications</p>
            <button disabled={!unread} onClick={() => readAll.mutate()} className="text-xs font-medium text-navy-700 hover:underline disabled:text-slate-300 disabled:no-underline">
              Mark all as read
            </button>
          </div>
          <ul className="max-h-[420px] divide-y divide-slate-100 overflow-y-auto">
            {q.data?.items.length === 0 && <li className="px-4 py-8 text-center text-sm text-slate-500">You're all caught up.</li>}
            {q.data?.items.map((n) => (
              <li key={n.id}>
                <button
                  className={clsx("block w-full px-4 py-2.5 text-left hover:bg-slate-50", !n.readAt && "bg-navy-50/60")}
                  onClick={() => {
                    if (!n.readAt) readOne.mutate(n.id);
                    setOpen(false);
                    if (n.link) navigate(n.link);
                  }}
                >
                  <div className="flex items-start gap-2">
                    {!n.readAt && <span className="mt-1.5 size-2 shrink-0 rounded-full bg-navy-600" aria-label="Unread" />}
                    <div className="min-w-0">
                      <p className="text-[13px] font-medium text-slate-900">{n.title}</p>
                      <p className="mt-0.5 line-clamp-2 text-xs text-slate-600">{n.message}</p>
                      <p className="mt-1 text-[11px] text-slate-400">{dateTime(n.createdAt)}</p>
                    </div>
                  </div>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function UserMenu() {
  const { user, logout } = useAuth();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useOutside(ref, () => setOpen(false));
  const navigate = useNavigate();
  if (!user) return null;
  const initials = user.fullName.split(/\s+/).filter((w) => /^[A-Za-z]/.test(w)).slice(0, 2).map((w) => w[0]).join("").toUpperCase();
  return (
    <div className="relative" ref={ref}>
      <button onClick={() => setOpen((o) => !o)} className="flex items-center gap-2 rounded-md py-1 pr-1.5 pl-1 hover:bg-slate-100" aria-haspopup="menu" aria-expanded={open}>
        <span className="flex size-8 items-center justify-center rounded-full bg-navy-100 text-xs font-semibold text-navy-800">{initials}</span>
        <span className="hidden text-left leading-tight sm:block">
          <span className="block text-[13px] font-medium text-slate-800">{user.fullName}</span>
          <span className="block text-[11px] text-slate-500">{user.roleLabels.join(", ")}</span>
        </span>
        <ChevronDown className="size-4 text-slate-400" />
      </button>
      {open && (
        <div className="absolute right-0 z-40 mt-2 w-60 overflow-hidden rounded-lg border border-slate-200 bg-white py-1 shadow-xl" role="menu">
          <div className="border-b border-slate-100 px-3 py-2">
            <p className="text-sm font-medium text-slate-900">{user.fullName}</p>
            <p className="text-xs text-slate-500">{user.position ?? user.username}</p>
            {user.office && <p className="text-xs text-slate-500">{user.office.name}</p>}
          </div>
          <Link to="/account" onClick={() => setOpen(false)} className="flex items-center gap-2 px-3 py-2 text-sm text-slate-700 hover:bg-slate-50" role="menuitem">
            <KeyRound className="size-4" /> Change password
          </Link>
          <button
            onClick={async () => {
              await logout();
              navigate("/login");
            }}
            className="flex w-full items-center gap-2 px-3 py-2 text-sm text-red-700 hover:bg-red-50"
            role="menuitem"
          >
            <LogOut className="size-4" /> Sign out
          </button>
        </div>
      )}
    </div>
  );
}

export function AppLayout() {
  const [mobileOpen, setMobileOpen] = useState(false);
  const loc = useLocation();
  useEffect(() => setMobileOpen(false), [loc.pathname]);
  return (
    <div className="min-h-screen lg:pl-64">
      <aside className="no-print fixed inset-y-0 left-0 z-30 hidden w-64 lg:block">
        <Sidebar />
      </aside>
      {mobileOpen && (
        <div className="no-print fixed inset-0 z-40 lg:hidden">
          <div className="absolute inset-0 bg-slate-900/50" onClick={() => setMobileOpen(false)} />
          <div className="absolute inset-y-0 left-0 w-72 shadow-xl">
            <button onClick={() => setMobileOpen(false)} className="absolute top-4 right-3 z-10 rounded p-1 text-navy-200 hover:bg-white/10" aria-label="Close menu">
              <X className="size-5" />
            </button>
            <Sidebar onNavigate={() => setMobileOpen(false)} />
          </div>
        </div>
      )}
      <header className="no-print sticky top-0 z-20 flex h-14 items-center gap-3 border-b border-slate-200 bg-white/95 px-4 backdrop-blur sm:px-6">
        <button className="rounded-md p-2 text-slate-600 hover:bg-slate-100 lg:hidden" onClick={() => setMobileOpen(true)} aria-label="Open menu">
          <Menu className="size-5" />
        </button>
        <div className="lg:hidden">
          <span className="text-sm font-bold tracking-wide text-navy-900">FUELTRACK</span>
        </div>
        <p className="hidden text-sm text-slate-500 lg:block">Fuel Management, Vehicle Utilization, and Consumption Monitoring</p>
        <div className="ml-auto flex items-center gap-1">
          <Notifications />
          <UserMenu />
        </div>
      </header>
      <main className="print-full mx-auto max-w-[1400px] px-4 py-5 sm:px-6 lg:py-6">
        <Outlet />
      </main>
    </div>
  );
}
