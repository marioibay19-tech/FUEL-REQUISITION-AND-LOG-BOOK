import clsx from "clsx";
import { AlertTriangle, CheckCircle2, ChevronLeft, ChevronRight, Info, Loader2, X, XCircle } from "lucide-react";
import {
  createContext,
  forwardRef,
  useCallback,
  useContext,
  useEffect,
  useId,
  useRef,
  useState,
  type ButtonHTMLAttributes,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from "react";
import { Link } from "react-router";

// ---------------------------------------------------------------- buttons

type Variant = "primary" | "secondary" | "ghost" | "danger" | "success";
const variants: Record<Variant, string> = {
  primary: "bg-navy-800 text-white hover:bg-navy-700 shadow-xs disabled:bg-navy-300",
  secondary: "bg-white text-slate-700 border border-slate-300 hover:bg-slate-50 shadow-xs disabled:text-slate-400",
  ghost: "text-slate-600 hover:bg-slate-100 disabled:text-slate-300",
  danger: "bg-red-600 text-white hover:bg-red-700 shadow-xs disabled:bg-red-300",
  success: "bg-emerald-600 text-white hover:bg-emerald-700 shadow-xs disabled:bg-emerald-300",
};

export const Button = forwardRef<HTMLButtonElement, ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: "sm" | "md"; loading?: boolean; icon?: ReactNode }>(
  function Button({ variant = "primary", size = "md", loading, icon, className, children, disabled, type = "button", ...rest }, ref) {
    return (
      <button
        ref={ref}
        type={type}
        disabled={disabled || loading}
        className={clsx(
          "inline-flex items-center justify-center gap-1.5 rounded-md font-medium whitespace-nowrap transition-colors disabled:cursor-not-allowed",
          size === "sm" ? "px-2.5 py-1.5 text-xs" : "px-3.5 py-2 text-sm",
          variants[variant],
          className,
        )}
        {...rest}
      >
        {loading ? <Loader2 className="size-4 animate-spin" /> : icon}
        {children}
      </button>
    );
  },
);

export function ButtonLink({ to, variant = "primary", icon, children, className }: { to: string; variant?: Variant; icon?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <Link to={to} className={clsx("inline-flex items-center gap-1.5 rounded-md px-3.5 py-2 text-sm font-medium whitespace-nowrap transition-colors", variants[variant], className)}>
      {icon}
      {children}
    </Link>
  );
}

// ---------------------------------------------------------------- form fields

export function Field({ label, error, hint, required, children, className, htmlFor }: { label: string; error?: string; hint?: ReactNode; required?: boolean; children: ReactNode; className?: string; htmlFor?: string }) {
  return (
    <div className={className}>
      <label className="label" htmlFor={htmlFor}>
        {label}
        {required && <span className="ml-0.5 text-red-600">*</span>}
      </label>
      {children}
      {error ? <p className="mt-1 text-xs text-red-600" role="alert">{error}</p> : hint ? <p className="mt-1 text-xs text-slate-500">{hint}</p> : null}
    </div>
  );
}

type WithField = { label: string; error?: string; hint?: ReactNode; wrapperClass?: string };

export const TextInput = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement> & WithField>(function TextInput({ label, error, hint, wrapperClass, required, className, id, ...rest }, ref) {
  const auto = useId();
  return (
    <Field label={label} error={error} hint={hint} required={required} className={wrapperClass} htmlFor={id ?? auto}>
      <input ref={ref} id={id ?? auto} aria-invalid={!!error} className={clsx("input", error && "input-error", className)} {...rest} />
    </Field>
  );
});

export const SelectInput = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement> & WithField & { placeholder?: string; options: { value: string | number; label: string; disabled?: boolean }[] }>(
  function SelectInput({ label, error, hint, wrapperClass, required, className, options, placeholder, id, ...rest }, ref) {
    const auto = useId();
    return (
      <Field label={label} error={error} hint={hint} required={required} className={wrapperClass} htmlFor={id ?? auto}>
        <select ref={ref} id={id ?? auto} aria-invalid={!!error} className={clsx("input pr-8", error && "input-error", className)} {...rest}>
          {placeholder !== undefined && <option value="">{placeholder}</option>}
          {options.map((o) => (
            <option key={o.value} value={o.value} disabled={o.disabled}>
              {o.label}
            </option>
          ))}
        </select>
      </Field>
    );
  },
);

export const TextArea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement> & WithField>(function TextArea({ label, error, hint, wrapperClass, required, className, id, rows = 3, ...rest }, ref) {
  const auto = useId();
  return (
    <Field label={label} error={error} hint={hint} required={required} className={wrapperClass} htmlFor={id ?? auto}>
      <textarea ref={ref} id={id ?? auto} rows={rows} aria-invalid={!!error} className={clsx("input", error && "input-error", className)} {...rest} />
    </Field>
  );
});

export function Checkbox({ label, hint, ...rest }: InputHTMLAttributes<HTMLInputElement> & { label: ReactNode; hint?: ReactNode }) {
  return (
    <label className="flex items-start gap-2 text-sm text-slate-700">
      <input type="checkbox" className="mt-0.5 size-4 rounded border-slate-300 text-navy-700 focus:ring-navy-500" {...rest} />
      <span>
        {label}
        {hint && <span className="block text-xs text-slate-500">{hint}</span>}
      </span>
    </label>
  );
}

/** Read-only value displayed in a form grid. */
export function ReadOnly({ label, value, className }: { label: string; value: ReactNode; className?: string }) {
  return (
    <div className={className}>
      <span className="label">{label}</span>
      <div className="min-h-[38px] rounded-md border border-dashed border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700">{value ?? "—"}</div>
    </div>
  );
}

// ---------------------------------------------------------------- layout bits

export function Card({ title, actions, children, className, bodyClass, subtitle }: { title?: ReactNode; subtitle?: ReactNode; actions?: ReactNode; children: ReactNode; className?: string; bodyClass?: string }) {
  return (
    <section className={clsx("card", className)}>
      {(title || actions) && (
        <header className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 px-4 py-3">
          <div>
            {title && <h2 className="text-sm font-semibold text-slate-800">{title}</h2>}
            {subtitle && <p className="text-xs text-slate-500">{subtitle}</p>}
          </div>
          {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
        </header>
      )}
      <div className={clsx("p-4", bodyClass)}>{children}</div>
    </section>
  );
}

export function PageHeader({ title, subtitle, actions, crumbs }: { title: string; subtitle?: ReactNode; actions?: ReactNode; crumbs?: { label: string; to?: string }[] }) {
  return (
    <div className="mb-5">
      {crumbs && crumbs.length > 0 && (
        <nav aria-label="Breadcrumb" className="no-print mb-1.5 flex flex-wrap items-center gap-1 text-xs text-slate-500">
          {crumbs.map((c, i) => (
            <span key={i} className="flex items-center gap-1">
              {i > 0 && <ChevronRight className="size-3" />}
              {c.to ? (
                <Link to={c.to} className="hover:text-navy-700 hover:underline">
                  {c.label}
                </Link>
              ) : (
                <span className="text-slate-700">{c.label}</span>
              )}
            </span>
          ))}
        </nav>
      )}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-slate-900">{title}</h1>
          {subtitle && <p className="mt-0.5 text-sm text-slate-500">{subtitle}</p>}
        </div>
        {actions && <div className="no-print flex flex-wrap items-center gap-2">{actions}</div>}
      </div>
    </div>
  );
}

export function DescList({ items, cols = 2 }: { items: { label: string; value: ReactNode; full?: boolean }[]; cols?: 2 | 3 | 4 }) {
  return (
    <dl className={clsx("grid gap-x-6 gap-y-3", cols === 2 ? "sm:grid-cols-2" : cols === 3 ? "sm:grid-cols-3" : "sm:grid-cols-2 lg:grid-cols-4")}>
      {items.map((it, i) => (
        <div key={i} className={clsx(it.full && "sm:col-span-full")}>
          <dt className="text-xs font-medium text-slate-500">{it.label}</dt>
          <dd className="mt-0.5 text-sm text-slate-800">{it.value ?? "—"}</dd>
        </div>
      ))}
    </dl>
  );
}

export function Notice({ tone = "info", title, children, className }: { tone?: "info" | "warning" | "danger" | "success"; title?: ReactNode; children?: ReactNode; className?: string }) {
  const styles = {
    info: "border-navy-200 bg-navy-50 text-navy-900",
    warning: "border-amber-300 bg-amber-50 text-amber-900",
    danger: "border-red-300 bg-red-50 text-red-900",
    success: "border-emerald-300 bg-emerald-50 text-emerald-900",
  }[tone];
  const Icon = { info: Info, warning: AlertTriangle, danger: XCircle, success: CheckCircle2 }[tone];
  return (
    <div className={clsx("flex gap-2.5 rounded-md border px-3 py-2.5 text-sm", styles, className)} role={tone === "danger" ? "alert" : "status"}>
      <Icon className="mt-0.5 size-4 shrink-0" />
      <div>
        {title && <p className="font-medium">{title}</p>}
        {children && <div className={clsx(title && "mt-0.5", "text-[13px] opacity-90")}>{children}</div>}
      </div>
    </div>
  );
}

export function Spinner({ label = "Loading…" }: { label?: string }) {
  return (
    <div className="flex items-center justify-center gap-2 py-10 text-sm text-slate-500">
      <Loader2 className="size-4 animate-spin" /> {label}
    </div>
  );
}

export function EmptyState({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="py-10 text-center">
      <p className="text-sm font-medium text-slate-700">{title}</p>
      {children && <div className="mt-1 text-sm text-slate-500">{children}</div>}
    </div>
  );
}

export function ErrorState({ error }: { error: unknown }) {
  const msg = error instanceof Error ? error.message : "Something went wrong.";
  return <Notice tone="danger" title="Could not load this page">{msg}</Notice>;
}

// ---------------------------------------------------------------- badges

export function Badge({ children, tone = "slate", className, dashed }: { children: ReactNode; tone?: "slate" | "amber" | "green" | "red" | "orange" | "blue" | "teal" | "navy" | "emerald" | "violet"; className?: string; dashed?: boolean }) {
  const t = {
    slate: "bg-slate-100 text-slate-700 ring-slate-200",
    amber: "bg-amber-50 text-amber-800 ring-amber-200",
    green: "bg-green-50 text-green-800 ring-green-200",
    emerald: "bg-emerald-600 text-white ring-emerald-600",
    red: "bg-red-50 text-red-700 ring-red-200",
    orange: "bg-orange-50 text-orange-800 ring-orange-200",
    blue: "bg-sky-50 text-sky-800 ring-sky-200",
    teal: "bg-teal-50 text-teal-800 ring-teal-200",
    navy: "bg-navy-800 text-white ring-navy-800",
    violet: "bg-violet-50 text-violet-800 ring-violet-200",
  }[tone];
  return <span className={clsx("inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap ring-1 ring-inset", t, dashed && "border border-dashed border-current ring-0", className)}>{children}</span>;
}

export const REQUEST_STATUS: Record<string, { label: string; tone: Parameters<typeof Badge>[0]["tone"] }> = {
  DRAFT: { label: "Draft", tone: "slate" },
  PENDING_APPROVAL: { label: "Pending Approval", tone: "amber" },
  APPROVED: { label: "Approved", tone: "green" },
  REJECTED: { label: "Rejected", tone: "red" },
  RETURNED: { label: "Returned for Revision", tone: "orange" },
  READY_FOR_ISSUANCE: { label: "Ready for Issuance", tone: "blue" },
  PARTIALLY_ISSUED: { label: "Partially Issued", tone: "teal" },
  FULLY_ISSUED: { label: "Fully Issued", tone: "emerald" },
  CANCELLED: { label: "Cancelled", tone: "slate" },
};

export function StatusBadge({ status }: { status: string }) {
  const s = REQUEST_STATUS[status] ?? { label: status, tone: "slate" as const };
  return <Badge tone={s.tone} className={status === "CANCELLED" ? "line-through decoration-slate-400" : undefined}>{s.label}</Badge>;
}

export function VerificationBadge({ status }: { status: string }) {
  const map = { PENDING: ["Pending", "amber"], VERIFIED: ["Verified", "green"], FLAGGED: ["Flagged", "red"] } as const;
  const [label, tone] = map[status as keyof typeof map] ?? [status, "slate"];
  return <Badge tone={tone}>{label}</Badge>;
}

/** Actual readings are solid navy; estimates are dashed and prefixed with ≈ so they are never mistaken for instrument readings. */
export function ReadingTypeBadge({ type }: { type: string }) {
  return type === "ACTUAL" ? (
    <Badge tone="navy">Actual</Badge>
  ) : (
    <Badge tone="violet" dashed className="italic">
      ≈ Estimated
    </Badge>
  );
}

export function TxStatusBadge({ status }: { status: string }) {
  if (status === "ACTIVE") return <Badge tone="green">Active</Badge>;
  if (status === "SUPERSEDED") return <Badge tone="slate">Superseded</Badge>;
  return <Badge tone="red">Cancelled</Badge>;
}

// ---------------------------------------------------------------- summary card

export function SummaryCard({ label, value, sub, icon, tone = "navy", to }: { label: string; value: ReactNode; sub?: ReactNode; icon?: ReactNode; tone?: "navy" | "amber" | "green" | "red" | "slate"; to?: string }) {
  const ring = { navy: "bg-navy-50 text-navy-700", amber: "bg-amber-50 text-amber-700", green: "bg-emerald-50 text-emerald-700", red: "bg-red-50 text-red-700", slate: "bg-slate-100 text-slate-600" }[tone];
  const body = (
    <div className="card flex h-full items-start gap-3 p-4 transition-shadow hover:shadow-sm">
      {icon && <div className={clsx("rounded-md p-2", ring)}>{icon}</div>}
      <div className="min-w-0">
        <p className="text-xs font-medium text-slate-500">{label}</p>
        <p className="tabular mt-1 truncate text-xl font-semibold text-slate-900">{value}</p>
        {sub && <p className="mt-0.5 text-xs text-slate-500">{sub}</p>}
      </div>
    </div>
  );
  return to ? <Link to={to} className="block">{body}</Link> : body;
}

// ---------------------------------------------------------------- data table

export interface Column<T> {
  key: string;
  header: ReactNode;
  cell: (row: T) => ReactNode;
  align?: "left" | "right" | "center";
  className?: string;
  hideOnMobile?: boolean;
}

export function DataTable<T>({ columns, rows, rowKey, onRowClick, empty = "No records found.", loading, footer, dense }: { columns: Column<T>[]; rows: T[] | undefined; rowKey: (r: T) => string | number; onRowClick?: (r: T) => void; empty?: string; loading?: boolean; footer?: ReactNode; dense?: boolean }) {
  return (
    <div className="overflow-x-auto">
      <table className="min-w-full divide-y divide-slate-200">
        <thead className="bg-slate-50">
          <tr>
            {columns.map((c) => (
              <th key={c.key} className={clsx("th", c.align === "right" && "text-right", c.align === "center" && "text-center", c.hideOnMobile && "hidden md:table-cell", c.className)}>
                {c.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100 bg-white">
          {loading && (
            <tr>
              <td colSpan={columns.length}>
                <Spinner />
              </td>
            </tr>
          )}
          {!loading && rows && rows.length === 0 && (
            <tr>
              <td colSpan={columns.length}>
                <EmptyState title={empty} />
              </td>
            </tr>
          )}
          {!loading &&
            rows?.map((r) => (
              <tr
                key={rowKey(r)}
                onClick={onRowClick ? () => onRowClick(r) : undefined}
                onKeyDown={onRowClick ? (e) => e.key === "Enter" && onRowClick(r) : undefined}
                tabIndex={onRowClick ? 0 : undefined}
                className={clsx(onRowClick && "cursor-pointer hover:bg-navy-50/50 focus:bg-navy-50")}
              >
                {columns.map((c) => (
                  <td key={c.key} className={clsx("td", dense && "py-2", c.align === "right" && "tabular text-right", c.align === "center" && "text-center", c.hideOnMobile && "hidden md:table-cell", c.className)}>
                    {c.cell(r)}
                  </td>
                ))}
              </tr>
            ))}
        </tbody>
        {footer && <tfoot className="bg-slate-50 font-medium">{footer}</tfoot>}
      </table>
    </div>
  );
}

export function Pagination({ page, pages, total, pageSize, onPage }: { page: number; pages: number; total: number; pageSize: number; onPage: (p: number) => void }) {
  if (total === 0) return null;
  const start = (page - 1) * pageSize + 1;
  const end = Math.min(total, page * pageSize);
  return (
    <div className="no-print flex flex-wrap items-center justify-between gap-2 border-t border-slate-100 px-4 py-3 text-sm text-slate-600">
      <span>
        Showing <span className="font-medium">{start}</span>–<span className="font-medium">{end}</span> of <span className="font-medium">{total}</span>
      </span>
      <div className="flex items-center gap-1">
        <Button variant="secondary" size="sm" disabled={page <= 1} onClick={() => onPage(page - 1)} icon={<ChevronLeft className="size-4" />} aria-label="Previous page">
          Prev
        </Button>
        <span className="px-2 text-xs">
          Page {page} of {pages}
        </span>
        <Button variant="secondary" size="sm" disabled={page >= pages} onClick={() => onPage(page + 1)} aria-label="Next page">
          Next <ChevronRight className="size-4" />
        </Button>
      </div>
    </div>
  );
}

/** A horizontal panel of filter controls with an optional reset. */
export function FilterBar({ children, onReset }: { children: ReactNode; onReset?: () => void }) {
  return (
    <div className="no-print flex flex-wrap items-end gap-3 border-b border-slate-100 bg-slate-50/60 px-4 py-3">
      {children}
      {onReset && (
        <Button variant="ghost" size="sm" onClick={onReset} className="mb-0.5">
          Reset filters
        </Button>
      )}
    </div>
  );
}

export function FilterField({ label, children, className }: { label: string; children: ReactNode; className?: string }) {
  return (
    <div className={clsx("min-w-[140px]", className)}>
      <span className="label">{label}</span>
      {children}
    </div>
  );
}

// ---------------------------------------------------------------- modal / dialogs

export function Modal({ open, onClose, title, children, footer, size = "md", side }: { open: boolean; onClose: () => void; title: ReactNode; children: ReactNode; footer?: ReactNode; size?: "sm" | "md" | "lg" | "xl"; side?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const prev = document.activeElement as HTMLElement | null;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    setTimeout(() => ref.current?.querySelector<HTMLElement>("input,select,textarea,button:not([data-close])")?.focus(), 30);
    return () => {
      document.removeEventListener("keydown", onKey);
      prev?.focus?.();
    };
  }, [open, onClose]);
  if (!open) return null;
  const width = { sm: "max-w-md", md: "max-w-xl", lg: "max-w-3xl", xl: "max-w-5xl" }[size];
  return (
    <div className="no-print fixed inset-0 z-50 flex items-stretch justify-center bg-slate-900/40 sm:items-center" role="dialog" aria-modal="true" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div ref={ref} className={clsx("flex w-full flex-col bg-white shadow-xl", width, side ? "ml-auto h-full sm:rounded-none" : "max-h-full sm:max-h-[92vh] sm:rounded-lg")}>
        <div className="flex items-center justify-between border-b border-slate-200 px-5 py-3.5">
          <h2 className="text-base font-semibold text-slate-900">{title}</h2>
          <button data-close onClick={onClose} className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600" aria-label="Close">
            <X className="size-5" />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto px-5 py-4">{children}</div>
        {footer && <div className="flex flex-wrap justify-end gap-2 border-t border-slate-200 bg-slate-50 px-5 py-3">{footer}</div>}
      </div>
    </div>
  );
}

export function ConfirmDialog({ open, title, children, confirmLabel = "Confirm", tone = "primary", onConfirm, onCancel, loading }: { open: boolean; title: string; children: ReactNode; confirmLabel?: string; tone?: Variant; onConfirm: () => void; onCancel: () => void; loading?: boolean }) {
  return (
    <Modal
      open={open}
      onClose={onCancel}
      title={title}
      size="sm"
      footer={
        <>
          <Button variant="secondary" onClick={onCancel} disabled={loading}>
            Cancel
          </Button>
          <Button variant={tone} onClick={onConfirm} loading={loading}>
            {confirmLabel}
          </Button>
        </>
      }
    >
      <div className="text-sm text-slate-700">{children}</div>
    </Modal>
  );
}

export function Tabs({ tabs, active, onChange }: { tabs: { key: string; label: ReactNode }[]; active: string; onChange: (k: string) => void }) {
  return (
    <div className="no-print flex gap-1 overflow-x-auto border-b border-slate-200" role="tablist">
      {tabs.map((t) => (
        <button
          key={t.key}
          role="tab"
          aria-selected={active === t.key}
          onClick={() => onChange(t.key)}
          className={clsx("-mb-px border-b-2 px-3 py-2 text-sm font-medium whitespace-nowrap", active === t.key ? "border-navy-700 text-navy-800" : "border-transparent text-slate-500 hover:text-slate-700")}
        >
          {t.label}
        </button>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------- toasts

interface Toast {
  id: number;
  tone: "success" | "error" | "info";
  title: string;
  body?: ReactNode;
}
const ToastCtx = createContext<(t: Omit<Toast, "id">) => void>(() => undefined);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const push = useCallback((t: Omit<Toast, "id">) => {
    const id = Date.now() + Math.random();
    setToasts((xs) => [...xs, { ...t, id }]);
    setTimeout(() => setToasts((xs) => xs.filter((x) => x.id !== id)), t.tone === "error" ? 8000 : 5000);
  }, []);
  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div className="no-print pointer-events-none fixed right-4 bottom-4 z-[60] flex w-[min(380px,calc(100vw-2rem))] flex-col gap-2" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className={clsx("pointer-events-auto flex gap-2.5 rounded-lg border bg-white p-3 shadow-lg", t.tone === "success" ? "border-emerald-200" : t.tone === "error" ? "border-red-200" : "border-slate-200")}>
            {t.tone === "success" ? <CheckCircle2 className="size-5 shrink-0 text-emerald-600" /> : t.tone === "error" ? <XCircle className="size-5 shrink-0 text-red-600" /> : <Info className="size-5 shrink-0 text-navy-600" />}
            <div className="min-w-0 flex-1 text-sm">
              <p className="font-medium text-slate-900">{t.title}</p>
              {t.body && <div className="mt-0.5 text-slate-600">{t.body}</div>}
            </div>
            <button onClick={() => setToasts((xs) => xs.filter((x) => x.id !== t.id))} className="self-start text-slate-400 hover:text-slate-600" aria-label="Dismiss">
              <X className="size-4" />
            </button>
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}
export const useToast = () => useContext(ToastCtx);
