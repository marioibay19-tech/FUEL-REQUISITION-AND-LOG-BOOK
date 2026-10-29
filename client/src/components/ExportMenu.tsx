import { Download } from "lucide-react";
import { useState } from "react";
import { download } from "../lib/api";
import { errorMessage } from "../lib/hooks";
import { Button, useToast } from "./ui";

/** Export buttons backed by the report engine (same filters, real database records). */
export function ExportButtons({ report, params, formats = ["csv", "xlsx", "pdf"] }: { report: string; params: Record<string, string | undefined>; formats?: ("csv" | "xlsx" | "pdf")[] }) {
  const toast = useToast();
  const [busy, setBusy] = useState<string | null>(null);
  const run = async (format: string) => {
    setBusy(format);
    try {
      await download(`/reports/${report}`, { ...params, format }, `${report}.${format}`);
    } catch (e) {
      toast({ tone: "error", title: "Export failed", body: errorMessage(e) });
    } finally {
      setBusy(null);
    }
  };
  const label = { csv: "CSV", xlsx: "Excel", pdf: "PDF" };
  return (
    <div className="flex gap-1.5">
      {formats.map((f) => (
        <Button key={f} variant="secondary" size="sm" icon={<Download className="size-3.5" />} loading={busy === f} onClick={() => run(f)}>
          {label[f]}
        </Button>
      ))}
    </div>
  );
}
