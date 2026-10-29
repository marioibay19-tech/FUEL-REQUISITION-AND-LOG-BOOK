import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Download, Paperclip, Upload } from "lucide-react";
import { useRef, useState } from "react";
import { api } from "../lib/api";
import { dateTime } from "../lib/format";
import { errorMessage } from "../lib/hooks";
import { Button, useToast } from "./ui";

export interface AttachmentItem { id: number; originalName: string; mimeType: string; sizeBytes: number; createdAt: string; description: string | null; uploadedBy?: { fullName: string } }

export async function uploadAttachment(entityType: "FUEL_REQUEST" | "FUEL_TRANSACTION", entityId: number, file: File) {
  const fd = new FormData();
  fd.set("entityType", entityType);
  fd.set("entityId", String(entityId));
  fd.set("file", file);
  return api.post("/attachments", fd);
}

export const ACCEPT = ".pdf,.jpg,.jpeg,.png,application/pdf,image/jpeg,image/png";
export const checkFile = (f: File) => (!/\.(pdf|jpe?g|png)$/i.test(f.name) ? "Only PDF, JPG and PNG files are accepted" : f.size > 5 * 1024 * 1024 ? "File is larger than 5 MB" : null);

export function AttachmentsPanel({ items, entityType, entityId, canUpload, queryKey }: { items: AttachmentItem[]; entityType: "FUEL_REQUEST" | "FUEL_TRANSACTION"; entityId: number; canUpload: boolean; queryKey: unknown[] }) {
  const input = useRef<HTMLInputElement>(null);
  const qc = useQueryClient();
  const toast = useToast();
  const [error, setError] = useState<string | null>(null);
  const m = useMutation({
    mutationFn: (f: File) => uploadAttachment(entityType, entityId, f),
    onSuccess: () => {
      toast({ tone: "success", title: "Document attached" });
      qc.invalidateQueries({ queryKey });
    },
    onError: (e) => setError(errorMessage(e)),
  });
  return (
    <div>
      {items.length === 0 ? (
        <p className="text-sm text-slate-500">No supporting documents attached.</p>
      ) : (
        <ul className="divide-y divide-slate-100 rounded-md border border-slate-200">
          {items.map((a) => (
            <li key={a.id} className="flex items-center justify-between gap-2 px-3 py-2 text-sm">
              <span className="flex min-w-0 items-center gap-2">
                <Paperclip className="size-4 shrink-0 text-slate-400" />
                <span className="truncate">{a.originalName}</span>
                <span className="hidden text-xs text-slate-400 sm:inline">{(a.sizeBytes / 1024).toFixed(0)} KB · {a.uploadedBy?.fullName} · {dateTime(a.createdAt)}</span>
              </span>
              <a href={`/api/attachments/${a.id}/download`} className="inline-flex items-center gap-1 text-xs font-medium text-navy-700 hover:underline">
                <Download className="size-3.5" /> Download
              </a>
            </li>
          ))}
        </ul>
      )}
      {canUpload && (
        <div className="mt-3">
          <input
            ref={input}
            type="file"
            accept={ACCEPT}
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              e.target.value = "";
              if (!f) return;
              const problem = checkFile(f);
              setError(problem);
              if (!problem) m.mutate(f);
            }}
          />
          <Button variant="secondary" size="sm" icon={<Upload className="size-3.5" />} loading={m.isPending} onClick={() => input.current?.click()}>
            Attach document
          </Button>
          <span className="ml-2 text-xs text-slate-500">PDF, JPG or PNG, up to 5 MB</span>
          {error && <p className="mt-1 text-xs text-red-600">{error}</p>}
        </div>
      )}
    </div>
  );
}
