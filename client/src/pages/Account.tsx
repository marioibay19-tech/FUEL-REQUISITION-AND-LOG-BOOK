import { useState, type FormEvent } from "react";
import { useNavigate } from "react-router";
import { Button, Card, DescList, Notice, PageHeader, TextInput, useToast } from "../components/ui";
import { api } from "../lib/api";
import { useAuth } from "../lib/auth";
import { dateTime } from "../lib/format";
import { errorMessage, fieldErrors } from "../lib/hooks";

export default function AccountPage() {
  const { user, refresh } = useAuth();
  const toast = useToast();
  const navigate = useNavigate();
  const [form, setForm] = useState({ currentPassword: "", newPassword: "", confirm: "" });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  if (!user) return null;
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (form.newPassword !== form.confirm) return setErrors({ confirm: "Passwords do not match" });
    setBusy(true);
    setErrors({});
    try {
      await api.post("/auth/change-password", { currentPassword: form.currentPassword, newPassword: form.newPassword });
      toast({ tone: "success", title: "Password changed" });
      setForm({ currentPassword: "", newPassword: "", confirm: "" });
      const wasForced = user.mustChangePassword;
      await refresh();
      if (wasForced) navigate("/");
    } catch (err) {
      setErrors(fieldErrors(err));
      if (!Object.keys(fieldErrors(err)).length) toast({ tone: "error", title: "Could not change password", body: errorMessage(err) });
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="max-w-3xl">
      <PageHeader title="My account" crumbs={[{ label: "Dashboard", to: "/" }, { label: "My account" }]} />
      {user.mustChangePassword && <Notice tone="warning" title="Change your password to continue" className="mb-4">Your password was set by an administrator. Choose a new password that only you know.</Notice>}
      <div className="grid gap-4 md:grid-cols-2">
        <Card title="Profile">
          <DescList
            cols={2}
            items={[
              { label: "Name", value: user.fullName, full: true },
              { label: "Username", value: user.username },
              { label: "Position", value: user.position },
              { label: "Office / Division", value: user.office?.name, full: true },
              { label: "Roles", value: user.roleLabels.join(", "), full: true },
              { label: "Timezone", value: "Asia/Manila", full: true },
            ]}
          />
          <p className="mt-4 text-xs text-slate-500">Profile details are maintained by the system administrator. Current time: {dateTime(new Date())}</p>
        </Card>
        <Card title="Change password">
          <form onSubmit={submit} className="space-y-3" noValidate>
            <TextInput label="Current password" type="password" autoComplete="current-password" value={form.currentPassword} onChange={(e) => setForm({ ...form, currentPassword: e.target.value })} error={errors.currentPassword} required />
            <TextInput label="New password" type="password" autoComplete="new-password" value={form.newPassword} onChange={(e) => setForm({ ...form, newPassword: e.target.value })} error={errors.newPassword} hint="At least 10 characters with letters and numbers." required />
            <TextInput label="Confirm new password" type="password" autoComplete="new-password" value={form.confirm} onChange={(e) => setForm({ ...form, confirm: e.target.value })} error={errors.confirm} required />
            <Button type="submit" loading={busy}>Update password</Button>
          </form>
        </Card>
      </div>
    </div>
  );
}
