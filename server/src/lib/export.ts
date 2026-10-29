import ExcelJS from "exceljs";
import PDFDocument from "pdfkit";
import { formatDateOnly, formatManila } from "./time.js";

export type ColType = "text" | "number" | "money" | "liters" | "km" | "kmpl" | "pct" | "date" | "datetime";
export interface Column {
  key: string;
  label: string;
  type?: ColType;
}
export interface ReportData {
  key: string;
  title: string;
  subtitle?: string;
  periodLabel: string;
  generatedAt: Date;
  generatedBy: string;
  columns: Column[];
  rows: Record<string, unknown>[];
  totals?: Record<string, unknown>;
  notes?: string[];
  header: { agency: string; office: string; address?: string };
}

export function formatCell(v: unknown, type: ColType = "text"): string {
  if (v === null || v === undefined || v === "") return "";
  switch (type) {
    case "money":
      return Number(v).toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    case "liters":
      return Number(v).toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    case "km":
      return Number(v).toLocaleString("en-PH", { maximumFractionDigits: 1 });
    case "kmpl":
      return Number(v).toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    case "pct":
      return `${Number(v).toLocaleString("en-PH", { maximumFractionDigits: 2 })}%`;
    case "number":
      return Number(v).toLocaleString("en-PH");
    case "date":
      return formatDateOnly(v as Date);
    case "datetime":
      return formatManila(v as Date);
    default:
      return String(v);
  }
}

const csvEscape = (s: string) => (/[",\n\r]/.test(s) || /^[=+\-@\t]/.test(s) ? `"${(/^[=+\-@\t]/.test(s) ? "'" : "") + s.replace(/"/g, '""')}"` : s);

/** CSV (UTF-8 with BOM for Excel). Cells that look like formulas are neutralised. */
export function toCsv(r: ReportData): Buffer {
  const lines: string[] = [];
  lines.push(csvEscape(r.title));
  lines.push(csvEscape(`Reporting period: ${r.periodLabel}`));
  lines.push(csvEscape(`Generated: ${formatManila(r.generatedAt)} by ${r.generatedBy}`));
  lines.push("");
  lines.push(r.columns.map((c) => csvEscape(c.label)).join(","));
  const raw = (v: unknown, t?: ColType) => {
    if (v === null || v === undefined) return "";
    if (t === "date") return formatDateOnly(v as Date);
    if (t === "datetime") return formatManila(v as Date);
    return String(v);
  };
  for (const row of r.rows) lines.push(r.columns.map((c) => csvEscape(raw(row[c.key], c.type))).join(","));
  if (r.totals) lines.push(r.columns.map((c) => csvEscape(raw(r.totals![c.key], c.type))).join(","));
  for (const n of r.notes ?? []) lines.push(csvEscape(n));
  return Buffer.from("﻿" + lines.join("\r\n"), "utf8");
}

const numFmt: Partial<Record<ColType, string>> = { money: "#,##0.00", liters: "#,##0.00", km: "#,##0.0", kmpl: "0.00", pct: "0.00", number: "#,##0" };

export async function toXlsx(r: ReportData): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = "FUELTRACK";
  wb.created = r.generatedAt;
  const ws = wb.addWorksheet(r.title.slice(0, 31).replace(/[\\/?*[\]:]/g, " "));
  const width = r.columns.length;
  const head = [r.header.agency, r.header.office, r.title, `Reporting period: ${r.periodLabel}`, `Generated: ${formatManila(r.generatedAt)} by ${r.generatedBy}`];
  head.forEach((text, i) => {
    const row = ws.addRow([text]);
    ws.mergeCells(row.number, 1, row.number, Math.max(1, width));
    row.getCell(1).font = { bold: i < 3, size: i === 2 ? 14 : 11 };
  });
  ws.addRow([]);
  const header = ws.addRow(r.columns.map((c) => c.label));
  header.eachCell((cell) => {
    cell.font = { bold: true, color: { argb: "FFFFFFFF" } };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1E3A5F" } };
    cell.alignment = { vertical: "middle", wrapText: true };
  });
  const value = (v: unknown, t?: ColType) => {
    if (v === null || v === undefined) return null;
    if (t === "date") return formatDateOnly(v as Date);
    if (t === "datetime") return formatManila(v as Date);
    if (t && numFmt[t]) return Number(v);
    return String(v);
  };
  for (const row of r.rows) ws.addRow(r.columns.map((c) => value(row[c.key], c.type)));
  if (r.totals) {
    const t = ws.addRow(r.columns.map((c) => value(r.totals![c.key], c.type)));
    t.font = { bold: true };
  }
  r.columns.forEach((c, i) => {
    const col = ws.getColumn(i + 1);
    col.width = Math.min(40, Math.max(10, c.label.length + 2, c.type === "text" ? 18 : 12));
    if (c.type && numFmt[c.type]) col.numFmt = numFmt[c.type]!;
  });
  for (const n of r.notes ?? []) ws.addRow([n]).getCell(1).font = { italic: true, size: 9 };
  return Buffer.from(await wb.xlsx.writeBuffer());
}

/** Landscape A4 PDF with repeated table headers. Peso amounts are labelled PHP (core PDF fonts lack ₱). */
export function toPdf(r: ReportData): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: "A4", layout: "landscape", margin: 32, bufferPages: true, info: { Title: r.title, Author: "FUELTRACK" } });
    const chunks: Buffer[] = [];
    doc.on("data", (c: Buffer) => chunks.push(c));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
    const left = doc.page.margins.left;
    const usable = doc.page.width - left - doc.page.margins.right;
    doc.font("Helvetica-Bold").fontSize(10).fillColor("#1e3a5f").text(r.header.agency, { align: "center" });
    doc.font("Helvetica").fontSize(9).fillColor("#333").text(r.header.office, { align: "center" });
    if (r.header.address) doc.fontSize(8).text(r.header.address, { align: "center" });
    doc.moveDown(0.6).font("Helvetica-Bold").fontSize(13).fillColor("#111").text(r.title, { align: "center" });
    doc.font("Helvetica").fontSize(8.5).fillColor("#444").text(`Reporting period: ${r.periodLabel}   |   Generated: ${formatManila(r.generatedAt)} by ${r.generatedBy}`, { align: "center" });
    doc.moveDown(0.8);

    const weights = r.columns.map((c) => (c.type === "text" || !c.type ? 1.6 : 1));
    const total = weights.reduce((a, b) => a + b, 0);
    const widths = weights.map((w) => (w / total) * usable);
    const fontSize = r.columns.length > 10 ? 6.5 : 7.5;
    const isNum = (t?: ColType) => !!t && ["money", "liters", "km", "kmpl", "pct", "number"].includes(t);
    const bottom = doc.page.height - doc.page.margins.bottom - 20;

    const drawRow = (cells: string[], opts: { bold?: boolean; fill?: string; color?: string } = {}) => {
      doc.font(opts.bold ? "Helvetica-Bold" : "Helvetica").fontSize(fontSize);
      const h = Math.max(...cells.map((c, i) => doc.heightOfString(c || " ", { width: widths[i] - 6 }))) + 6;
      if (doc.y + h > bottom) {
        doc.addPage();
        drawHeader();
        doc.font(opts.bold ? "Helvetica-Bold" : "Helvetica").fontSize(fontSize);
      }
      const y = doc.y;
      if (opts.fill) doc.rect(left, y, usable, h).fill(opts.fill);
      let x = left;
      cells.forEach((c, i) => {
        doc.fillColor(opts.color ?? "#111").text(c, x + 3, y + 3, { width: widths[i] - 6, align: isNum(r.columns[i].type) && !opts.color ? "right" : "left" });
        x += widths[i];
      });
      doc.moveTo(left, y + h).lineTo(left + usable, y + h).lineWidth(0.3).strokeColor("#cccccc").stroke();
      doc.x = left;
      doc.y = y + h;
    };
    const drawHeader = () => drawRow(r.columns.map((c) => c.label), { bold: true, fill: "#1e3a5f", color: "#ffffff" });

    drawHeader();
    if (r.rows.length === 0) drawRow(r.columns.map((_, i) => (i === 0 ? "No records for the selected filters." : "")));
    r.rows.forEach((row, idx) => drawRow(r.columns.map((c) => formatCell(row[c.key], c.type)), { fill: idx % 2 ? "#f4f6f9" : undefined }));
    if (r.totals) drawRow(r.columns.map((c) => formatCell(r.totals![c.key], c.type)), { bold: true, fill: "#e6ebf2" });
    doc.moveDown(0.8);
    for (const n of r.notes ?? []) doc.font("Helvetica-Oblique").fontSize(7.5).fillColor("#555").text(n, left, doc.y, { width: usable });
    const range = doc.bufferedPageRange();
    for (let i = range.start; i < range.start + range.count; i++) {
      doc.switchToPage(i);
      const bottomMargin = doc.page.margins.bottom;
      doc.page.margins.bottom = 0; // writing inside the margin must not trigger a new page
      doc.font("Helvetica").fontSize(7).fillColor("#888").text(`FUELTRACK — ${r.title} — Page ${i + 1} of ${range.count}`, left, doc.page.height - bottomMargin + 8, { width: usable, align: "right", lineBreak: false });
      doc.page.margins.bottom = bottomMargin;
    }
    doc.end();
  });
}
