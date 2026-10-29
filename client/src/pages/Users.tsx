import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { KeyRound, Lock, Plus, Search } from "lucide-react";
import { useState } from "react";
import { Badge, Button, Checkbox, DataTable, ErrorState, FilterBar, FilterField, Modal, Notice, PageHeader, Pagination, SelectInput, TextInput, useToast } from "../components/ui";
import { api, type Paged } from "../lib/api";
import { useAuth } from "../lib/auth";
import { dateTime } from "../lib/format";
import { errorMessage, fieldErrors, useListParams, useOffices } from "../lib/hooks";

interface UserRow { id: number; username: string; fullName: string; email: string | null; position: string | null; officeId: number | null; isActive: boolean; mustChangePassword: boolean; lastLoginAt: string | null; lockedUntil: string | null; office: { name: string; code: string } | null; roles: string[] }
const ROLES: Record<string, string> = { ADMIN: "Administrator", REQUESTER: "Requester", APPROVER: "Approving Officer", CUSTODIAN: "Fuel Custodian / Encoder" };
const ROLE_HINT: Record<string, string> = { ADMIN: "All modules, users, settings and audit trail", REQUESTER: "Creates and tracks own fuel requests", APPROVER: "Approves / rejects / returns assigned requests; verifies odometer records", CUSTODIAN: "Records actual issuance and odometer readings" };

export default function UsersPage() {
  const { user: me } = useAuth();
  const defaults = { q: "", role: "", active: "" };
  const { values, set, reset, page } = useListParams(defaults);
  const [edit, setEdit] = useState<UserRow | "new" | null>(null);
  const [resetFor, setResetFor] = useState<UserRow | null>(null);
  const qc = useQueryClient();
  const toast = useToast();
  const q = useQuery({ queryKey: ["users", values], queryFn: () => api.get<Paged<UserRow>>("/users", { ...values, page, pageSize: 25 }), placeholderData: (p) => p });
  const unlock = useMutation({ mutationFn: (id: number) => api.post(`/users/${id}/unlock`), onSuccess: () => { toast({ tone: "success", title: "Account unlocked" }); qc.invalidateQueries({ queryKey: ["users"] }); } });
  return (
    <div>
      <PageHeader title="User Management" subtitle="Accounts, role assignments and access" crumbs={[{ label: "Dashboard", to: "/" }, { label: "User Management" }]} actions={<Button icon={<Plus className="size-4" />} onClick={() => setEdit("new")}>Add user</Button>} />
      <div className="card overflow-hidden">
        <FilterBar onReset={reset}>
          <FilterField label="Search" className="min-w-[220px] flex-1">
            <div className="relative"><Search className="pointer-events-none absolute top-2.5 left-2.5 size-4 text-slate-400" /><input className="input pl-8" placeholder="Name, username or email" value={values.q} onChange={(e) => set({ q: e.target.value })} /></div>
          </FilterField>
          <FilterField label="Role"><select className="input" value={values.role} onChange={(e) => set({ role: e.target.value })}><option value="">All roles</option>{Object.entries(ROLES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></FilterField>
          <FilterField label="Status"><select className="input" value={values.active} onChange={(e) => set({ active: e.target.value })}><option value="">All</option><option value="true">Active</option><option value="false">Deactivated</option></select></FilterField>
        </FilterBar>
        {q.error ? <div className="p-4"><ErrorState error={q.error} /></div> : (
          <DataTable
            rows={q.data?.items}
            loading={q.isLoading}
            rowKey={(u) => u.id}
            onRowClick={(u) => setEdit(u)}
            columns={[
              { key: "n", header: "Name", cell: (u) => <><span className="font-medium text-slate-900">{u.fullName}</span><span className="block text-xs text-slate-500">{u.username}{u.email ? ` · ${u.email}` : ""}</span></> },
              { key: "p", header: "Position / office", cell: (u) => <>{u.position ?? "—"}<span className="block text-xs text-slate-500">{u.office?.name}</span></>, hideOnMobile: true },
              { key: "r", header: "Roles", cell: (u) => <span className="flex flex-wrap gap-1">{u.roles.map((r) => <Badge key={r} tone={r === "ADMIN" ? "navy" : "slate"}>{ROLES[r]}</Badge>)}</span> },
              { key: "l", header: "Last sign-in", cell: (u) => dateTime(u.lastLoginAt), hideOnMobile: true },
              { key: "s", header: "Status", cell: (u) => <span className="flex flex-wrap gap-1">{u.isActive ? <Badge tone="green">Active</Badge> : <Badge tone="red">Deactivated</Badge>}{u.lockedUntil && new Date(u.lockedUntil) > new Date() && <Badge tone="amber">Locked</Badge>}{u.mustChangePassword && <Badge tone="slate">Must change password</Badge>}</span> },
              {
                key: "a", header: "", cell: (u) => (
                  <span className="flex gap-1" onClick={(e) => e.stopPropagation()}>
                    <Button size="sm" variant="ghost" icon={<KeyRound className="size-3.5" />} onClick={() => setResetFor(u)}>Reset password</Button>
                    {u.lockedUntil && new Date(u.lockedUntil) > new Date() && <Button size="sm" variant="ghost" icon={<Lock className="size-3.5" />} onClick={() => unlock.mutate(u.id)}>Unlock</Button>}
                  </span>
                ),
              },
            ]}
          />
        )}
        {q.data && <Pagination page={q.data.page} pages={q.data.pages} total={q.data.total} pageSize={q.data.pageSize} onPage={(p) => set({ page: String(p) })} />}
      </div>
      {edit && <UserModal user={edit === "new" ? null : edit} onClose={() => setEdit(null)} isSelf={edit !== "new" && edit.id === me?.id} />}
      {resetFor && <ResetModal user={resetFor} onClose={() => setResetFor(null)} />}
    </div>
  );
}

function UserModal({ user, onClose, isSelf }: { user: UserRow | null; onClose: () => void; isSelf: boolean }) {
  const offices = useOffices();
  const qc = useQueryClient();
  const toast = useToast();
  const [form, setForm] = useState({ username: user?.username ?? "", fullName: user?.fullName ?? "", email: user?.email ?? "", position: user?.position ?? "", officeId: user?.officeId ? String(user.officeId) : "", roles: user?.roles ?? ["REQUESTER"], isActive: user?.isActive ?? true, password: "" });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const m = useMutation({
    mutationFn: () => {
      const body = { ...form, officeId: form.officeId || null, password: user ? undefined : form.password };
      return user ? api.put(`/users/${user.id}`, body) : api.post("/users", body);
    },
    onSuccess: () => { toast({ tone: "success", title: user ? "User updated" : "User created", body: user ? undefined : "They must change the password at first sign-in." }); qc.invalidateQueries({ queryKey: ["users"] }); qc.invalidateQueries({ queryKey: ["people"] }); onClose(); },
    onError: (e) => { setErrors(fieldErrors(e)); if (!Object.keys(fieldErrors(e)).length) toast({ tone: "error", title: "Could not save user", body: errorMessage(e) }); },
  });
  const toggleRole = (r: string) => setForm((f) => ({ ...f, roles: f.roles.includes(r) ? f.roles.filter((x) => x !== r) : [...f.roles, r] }));
  return (
    <Modal open onClose={onClose} title={user ? `Edit ${user.fullName}` : "Add user"} size="lg" footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button loading={m.isPending} onClick={() => m.mutate()}>{user ? "Save changes" : "Create user"}</Button></>}>
      <div className="grid gap-3 sm:grid-cols-2">
        <TextInput label="Full name" required value={form.fullName} onChange={(e) => setForm({ ...form, fullName: e.target.value })} error={errors.fullName} />
        <TextInput label="Username" required value={form.username} onChange={(e) => setForm({ ...form, username: e.target.value })} error={errors.username} autoComplete="off" />
        <TextInput label="Email" type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} error={errors.email} />
        <TextInput label="Position / designation" value={form.position} onChange={(e) => setForm({ ...form, position: e.target.value })} />
        <SelectInput label="Office / division" placeholder="None" value={form.officeId} onChange={(e) => setForm({ ...form, officeId: e.target.value })} options={(offices.data ?? []).map((o) => ({ value: o.id, label: o.name }))} hint="Requesters can request fuel for their office's vehicles" />
        {!user && <TextInput label="Temporary password" type="password" required value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} error={errors.password} hint="At least 10 characters with letters and numbers" autoComplete="new-password" />}
      </div>
      <fieldset className="mt-4">
        <legend className="label">Roles (one or more)</legend>
        <div className="grid gap-2 sm:grid-cols-2">
          {Object.entries(ROLES).map(([k, v]) => <Checkbox key={k} label={v} hint={ROLE_HINT[k]} checked={form.roles.includes(k)} disabled={isSelf && k === "ADMIN"} onChange={() => toggleRole(k)} />)}
        </div>
        {errors.roles && <p className="mt-1 text-xs text-red-600">{errors.roles}</p>}
      </fieldset>
      <div className="mt-4">
        <Checkbox label="Account active" hint="Deactivated users cannot sign in; their history is kept." checked={form.isActive} disabled={isSelf} onChange={(e) => setForm({ ...form, isActive: e.target.checked })} />
      </div>
      {isSelf && <Notice tone="info" className="mt-3">You cannot deactivate your own account or remove your own administrator role.</Notice>}
    </Modal>
  );
}

function ResetModal({ user, onClose }: { user: UserRow; onClose: () => void }) {
  const toast = useToast();
  const [password, setPassword] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const m = useMutation({
    mutationFn: () => api.post(`/users/${user.id}/reset-password`, { password }),
    onSuccess: () => { toast({ tone: "success", title: "Password reset", body: `${user.fullName} must choose a new password at next sign-in.` }); onClose(); },
    onError: (e) => setErrors(fieldErrors(e)),
  });
  return (
    <Modal open onClose={onClose} size="sm" title={`Reset password — ${user.fullName}`} footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button loading={m.isPending} onClick={() => m.mutate()}>Reset password</Button></>}>
      <TextInput label="New temporary password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} error={errors.password} hint="Share it securely. The user's active sessions are signed out." autoComplete="new-password" />
    </Modal>
  );
}
