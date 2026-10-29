import { Router } from "express";
import { z } from "zod";
import { prisma } from "../db.js";
import { audit } from "../lib/audit.js";
import { toCsv, toPdf, toXlsx } from "../lib/export.js";
import { parse } from "../lib/validate.js";
import { can, requirePerm, userOf } from "../middleware/auth.js";
import { buildReport, reportFilters, REPORTS } from "../services/reports.js";

export const reportsRouter = Router();

reportsRouter.get("/", requirePerm("report.view"), (req, res) => {
  const user = userOf(req);
  res.json(REPORTS.filter((r) => !r.permission || can(user, r.permission)));
});

reportsRouter.get("/:key", requirePerm("report.view"), async (req, res) => {
  const user = userOf(req);
  const format = parse(z.enum(["json", "csv", "xlsx", "pdf"]).default("json"), req.query.format);
  if (format !== "json" && !can(user, "report.export")) {
    res.status(403).json({ error: "You do not have permission to export reports" });
    return;
  }
  const filters = parse(reportFilters, req.query);
  const report = await buildReport(user, String(req.params.key), filters);
  if (format === "json") {
    res.json(report);
    return;
  }
  await audit(prisma, { userId: user.id, action: "REPORT_EXPORTED", module: "REPORT", recordId: report.key, after: { format, filters, rows: report.rows.length }, ip: req.ip });
  const stamp = new Date().toISOString().slice(0, 10);
  const name = `${report.key}-${stamp}.${format}`;
  res.setHeader("Content-Disposition", `attachment; filename="${name}"`);
  if (format === "csv") res.type("text/csv; charset=utf-8").send(toCsv(report));
  else if (format === "xlsx") res.type("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet").send(await toXlsx(report));
  else res.type("application/pdf").send(await toPdf(report));
});
