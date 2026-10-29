// Chart building blocks. Colors follow the validated reference palette:
// categorical slots in fixed order, a single navy hue for one-series charts,
// recessive grid/axes, tooltips on every mark and a table view for each chart.
import { Table2, BarChart3 } from "lucide-react";
import { useState, type ReactNode } from "react";
import { Bar, BarChart, CartesianGrid, Cell, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Button, EmptyState } from "./ui";

export const SERIES = ["#2a78d6", "#eb6834", "#1baf7a", "#eda100", "#e87ba4", "#008300", "#6250d6", "#e34948"];
export const SINGLE = "#2a5084"; // navy-600 for single-series charts
const AXIS = { fontSize: 11, fill: "#64748b" };
const GRID = "#e2e8f0";

export function ChartCard({ title, subtitle, children, table, empty }: { title: string; subtitle?: string; children: ReactNode; table: { columns: string[]; rows: (string | number)[][] }; empty?: boolean }) {
  const [asTable, setAsTable] = useState(false);
  return (
    <section className="card flex flex-col">
      <header className="flex items-start justify-between gap-2 border-b border-slate-100 px-4 py-3">
        <div>
          <h2 className="text-sm font-semibold text-slate-800">{title}</h2>
          {subtitle && <p className="text-xs text-slate-500">{subtitle}</p>}
        </div>
        {!empty && (
          <Button variant="ghost" size="sm" onClick={() => setAsTable((v) => !v)} icon={asTable ? <BarChart3 className="size-3.5" /> : <Table2 className="size-3.5" />} aria-pressed={asTable}>
            {asTable ? "Chart" : "Table"}
          </Button>
        )}
      </header>
      <div className="flex-1 p-3">
        {empty ? (
          <EmptyState title="No data for the selected filters" />
        ) : asTable ? (
          <div className="max-h-[280px] overflow-auto">
            <table className="min-w-full text-sm">
              <thead className="sticky top-0 bg-white">
                <tr>{table.columns.map((c, i) => <th key={c} className={`th ${i ? "text-right" : ""}`}>{c}</th>)}</tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {table.rows.map((r, i) => (
                  <tr key={i}>{r.map((v, j) => <td key={j} className={`td py-1.5 ${j ? "tabular text-right" : ""}`}>{v}</td>)}</tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="h-[280px]">{children}</div>
        )}
      </div>
    </section>
  );
}

function TooltipBox({ label, rows }: { label: ReactNode; rows: { name: string; value: string; color?: string }[] }) {
  return (
    <div className="rounded-md border border-slate-200 bg-white px-3 py-2 text-xs shadow-lg">
      <p className="mb-1 font-medium text-slate-800">{label}</p>
      {rows.map((r) => (
        <p key={r.name} className="flex items-center gap-2 text-slate-600">
          {r.color && <span className="size-2.5 rounded-sm" style={{ background: r.color }} />}
          <span>{r.name}</span>
          <span className="tabular ml-auto pl-3 font-medium text-slate-900">{r.value}</span>
        </p>
      ))}
    </div>
  );
}

/** Vertical bars over a category axis; one or several (stacked) series. */
export function ColumnChart<T extends object>({ data, x, series, format, xFormat, stacked }: { data: T[]; x: string; series: { key: string; name: string; color?: string }[]; format: (v: number) => string; xFormat?: (v: string) => string; stacked?: boolean }) {
  return (
    <ResponsiveContainer width="100%" height="100%">
      <BarChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 0 }} barCategoryGap="22%">
        <CartesianGrid vertical={false} stroke={GRID} />
        <XAxis dataKey={x as never} tick={AXIS} tickLine={false} axisLine={{ stroke: GRID }} tickFormatter={xFormat} interval="preserveStartEnd" />
        <YAxis tick={AXIS} tickLine={false} axisLine={false} width={64} tickFormatter={(v) => format(Number(v))} />
        <Tooltip
          cursor={{ fill: "#f1f5f9" }}
          content={({ active, payload, label }) =>
            active && payload?.length ? (
              <TooltipBox label={xFormat ? xFormat(String(label)) : String(label)} rows={payload.map((p) => ({ name: String(p.name), value: format(Number(p.value)), color: String(p.color) }))} />
            ) : null
          }
        />
        {series.length > 1 && <Legend iconType="square" iconSize={10} wrapperStyle={{ fontSize: 12, color: "#475569" }} />}
        {series.map((s, i) => (
          <Bar
            key={s.key}
            dataKey={s.key}
            name={s.name}
            stackId={stacked ? "a" : undefined}
            fill={s.color ?? (series.length === 1 ? SINGLE : SERIES[i])}
            stroke="#ffffff"
            strokeWidth={stacked ? 1 : 0}
            radius={!stacked || i === series.length - 1 ? [4, 4, 0, 0] : 0}
            maxBarSize={36}
          />
        ))}
      </BarChart>
    </ResponsiveContainer>
  );
}

/** Horizontal bars for ranked categories; optional per-row fill (e.g. verified vs estimated). */
export function RankChart<T extends object>({ data, y, value, name, format, fillOf, legend }: { data: T[]; y: string; value: string; name: string; format: (v: number) => string; fillOf?: (row: T) => string; legend?: { label: string; color: string }[] }) {
  return (
    <div className="flex h-full flex-col">
      {legend && (
        <div className="mb-1 flex flex-wrap gap-3 px-1 text-xs text-slate-600">
          {legend.map((l) => (
            <span key={l.label} className="flex items-center gap-1.5">
              <span className="size-2.5 rounded-sm" style={{ background: l.color }} /> {l.label}
            </span>
          ))}
        </div>
      )}
      <div className="min-h-0 flex-1">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} layout="vertical" margin={{ top: 0, right: 16, bottom: 0, left: 0 }} barCategoryGap="20%">
            <CartesianGrid horizontal={false} stroke={GRID} />
            <XAxis type="number" tick={AXIS} tickLine={false} axisLine={false} tickFormatter={(v) => format(Number(v))} />
            <YAxis type="category" dataKey={y as never} interval={0} tick={AXIS} tickLine={false} axisLine={{ stroke: GRID }} width={96} />
            <Tooltip
              cursor={{ fill: "#f1f5f9" }}
              content={({ active, payload, label }) =>
                active && payload?.length ? <TooltipBox label={String(label)} rows={[{ name, value: format(Number(payload[0].value)), color: fillOf ? fillOf(payload[0].payload as T) : SINGLE }]} /> : null
              }
            />
            <Bar dataKey={value as never} name={name} radius={[0, 4, 4, 0]} maxBarSize={18}>
              {data.map((row, i) => (
                <Cell key={i} fill={fillOf ? fillOf(row) : SINGLE} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
