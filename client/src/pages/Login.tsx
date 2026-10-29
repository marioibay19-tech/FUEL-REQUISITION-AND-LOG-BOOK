import { useQueryClient } from "@tanstack/react-query";
import { Eye, EyeOff, Lock, ShieldCheck } from "lucide-react";
import { useState, type FormEvent } from "react";
import { Navigate, useLocation, useNavigate } from "react-router";
import { Logo } from "../components/Layout";
import { Button, Notice } from "../components/ui";
import { api, ApiError } from "../lib/api";
import { useAuth, type Me } from "../lib/auth";

export default function LoginPage() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const loc = useLocation();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [show, setShow] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fields, setFields] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  if (user) return <Navigate to="/" replace />;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const f: Record<string, string> = {};
    if (!username.trim()) f.username = "Enter your username";
    if (!password) f.password = "Enter your password";
    setFields(f);
    setError(null);
    if (Object.keys(f).length) return;
    setBusy(true);
    try {
      const res = await api.post<{ user: Me }>("/auth/login", { username: username.trim(), password });
      qc.setQueryData(["me"], res.user);
      const from = (loc.state as { from?: string } | null)?.from;
      navigate(res.user.mustChangePassword ? "/account" : from && from !== "/login" ? from : "/", { replace: true });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Unable to reach the server. Check your connection and try again.");
      setPassword("");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="grid min-h-screen lg:grid-cols-[1.1fr_1fr]">
      <div className="relative hidden flex-col justify-between overflow-hidden bg-navy-900 p-10 text-white lg:flex">
        <Logo light />
        <div className="max-w-md">
          <h1 className="text-3xl leading-tight font-semibold">Fuel Request and Odometer Monitoring System</h1>
          <p className="mt-3 text-navy-200">Fuel Management, Vehicle Utilization, and Consumption Monitoring for the government fleet.</p>
          <ul className="mt-8 space-y-3 text-sm text-navy-100">
            <li className="flex gap-2.5"><ShieldCheck className="size-5 shrink-0 text-emerald-300" /> Requests, approvals and actual fuel issuance on one accountable record</li>
            <li className="flex gap-2.5"><ShieldCheck className="size-5 shrink-0 text-emerald-300" /> Odometer estimates computed by ratio and proportion, always kept separate from actual readings</li>
            <li className="flex gap-2.5"><ShieldCheck className="size-5 shrink-0 text-emerald-300" /> Complete audit trail of every approval, issuance and correction</li>
          </ul>
        </div>
        <p className="text-xs text-navy-300">For authorized personnel only. Activity on this system is logged.</p>
      </div>
      <div className="flex items-center justify-center bg-white px-6 py-12">
        <div className="w-full max-w-sm">
          <div className="mb-8 lg:hidden">
            <Logo />
          </div>
          <h2 className="text-xl font-semibold text-slate-900">Sign in</h2>
          <p className="mt-1 text-sm text-slate-500">Use the account issued by your system administrator.</p>
          <form onSubmit={submit} className="mt-6 space-y-4" noValidate>
            {error && <Notice tone="danger">{error}</Notice>}
            <div>
              <label htmlFor="username" className="label">Username</label>
              <input id="username" className={`input ${fields.username ? "input-error" : ""}`} autoComplete="username" autoFocus value={username} onChange={(e) => setUsername(e.target.value)} aria-invalid={!!fields.username} />
              {fields.username && <p className="mt-1 text-xs text-red-600">{fields.username}</p>}
            </div>
            <div>
              <label htmlFor="password" className="label">Password</label>
              <div className="relative">
                <input id="password" type={show ? "text" : "password"} className={`input pr-10 ${fields.password ? "input-error" : ""}`} autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} aria-invalid={!!fields.password} />
                <button type="button" onClick={() => setShow((s) => !s)} className="absolute inset-y-0 right-0 flex items-center px-3 text-slate-400 hover:text-slate-600" aria-label={show ? "Hide password" : "Show password"}>
                  {show ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                </button>
              </div>
              {fields.password && <p className="mt-1 text-xs text-red-600">{fields.password}</p>}
            </div>
            <Button type="submit" className="w-full" loading={busy} icon={<Lock className="size-4" />}>
              Sign in
            </Button>
          </form>
          <p className="mt-8 text-xs text-slate-400">Forgot your password? Ask the system administrator to reset it.</p>
        </div>
      </div>
    </div>
  );
}
