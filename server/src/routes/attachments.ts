import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { Router } from "express";
import multer from "multer";
import { z } from "zod";
import { config } from "../config.js";
import { prisma } from "../db.js";
import { audit } from "../lib/audit.js";
import { badRequest, forbidden, notFound } from "../lib/errors.js";
import { parse, zId, zOptText } from "../lib/validate.js";
import { can, userOf, type AuthUser } from "../middleware/auth.js";
import { getVisibleRequest } from "../services/requests.js";

export const attachmentsRouter = Router();

const uploadDir = path.resolve(config.uploadDir);
fs.mkdirSync(uploadDir, { recursive: true });

// Allowed types, checked by extension, declared MIME type AND file signature.
const ALLOWED: Record<string, { mime: string[]; magic: (b: Buffer) => boolean }> = {
  ".pdf": { mime: ["application/pdf"], magic: (b) => b.subarray(0, 5).toString("latin1") === "%PDF-" },
  ".jpg": { mime: ["image/jpeg"], magic: (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  ".jpeg": { mime: ["image/jpeg"], magic: (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  ".png": { mime: ["image/png"], magic: (b) => b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) },
};

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: config.maxUploadBytes, files: 1 },
});

type Entity = "FUEL_REQUEST" | "FUEL_TRANSACTION";

async function assertCanView(user: AuthUser, entityType: Entity, entityId: number) {
  if (entityType === "FUEL_REQUEST") await getVisibleRequest(user, entityId);
  else if (!can(user, "transaction.view")) throw forbidden();
}

async function assertCanAttach(user: AuthUser, entityType: Entity, entityId: number) {
  if (entityType === "FUEL_REQUEST") {
    const r = await getVisibleRequest(user, entityId);
    const ownerEditable = r.requesterId === user.id && ["DRAFT", "RETURNED", "PENDING_APPROVAL"].includes(r.status);
    if (!ownerEditable && !user.roles.includes("ADMIN")) throw forbidden("Documents can only be added by the requester while the request is open");
    return r.requestNumber;
  }
  if (!can(user, "transaction.create")) throw forbidden();
  const t = await prisma.fuelTransaction.findUnique({ where: { id: entityId } });
  if (!t) throw notFound("Transaction not found");
  if (t.status !== "ACTIVE") throw forbidden("Documents cannot be added to a superseded or cancelled transaction");
  return t.transactionNumber;
}

const entityParams = z.object({ entityType: z.enum(["FUEL_REQUEST", "FUEL_TRANSACTION"]), entityId: zId });

attachmentsRouter.post("/", upload.single("file"), async (req, res) => {
  const user = userOf(req);
  const { entityType, entityId } = parse(entityParams, req.body);
  const { description } = parse(z.object({ description: zOptText(255) }), req.body);
  const file = req.file;
  if (!file) throw badRequest("Choose a file to upload");
  const ext = path.extname(file.originalname).toLowerCase();
  const rule = ALLOWED[ext];
  if (!rule || !rule.mime.includes(file.mimetype) || !rule.magic(file.buffer)) throw badRequest("Only PDF, JPG and PNG files are accepted");
  const ref = await assertCanAttach(user, entityType, entityId);
  const storedName = `${crypto.randomBytes(16).toString("hex")}${ext}`;
  await fs.promises.writeFile(path.join(uploadDir, storedName), file.buffer, { flag: "wx" });
  const safeName = file.originalname.replace(/[^\w.\- ()]/g, "_").slice(0, 200);
  const a = await prisma.attachment.create({
    data: { entityType, entityId, originalName: safeName, storedName, mimeType: file.mimetype, sizeBytes: file.size, description: description ?? null, uploadedById: user.id },
  });
  await audit(prisma, { userId: user.id, action: "ATTACHMENT_UPLOADED", module: entityType, recordId: ref, after: { attachmentId: a.id, file: safeName, size: file.size }, ip: req.ip });
  res.status(201).json(a);
});

attachmentsRouter.get("/:id/download", async (req, res) => {
  const user = userOf(req);
  const a = await prisma.attachment.findUnique({ where: { id: parse(zId, req.params.id) } });
  if (!a) throw notFound("Attachment not found");
  await assertCanView(user, a.entityType as Entity, a.entityId);
  const file = path.join(uploadDir, path.basename(a.storedName));
  if (!fs.existsSync(file)) throw notFound("The stored file is missing; contact the administrator");
  res.setHeader("Content-Type", a.mimeType);
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Content-Disposition", `${req.query.inline === "1" ? "inline" : "attachment"}; filename="${a.originalName.replace(/"/g, "")}"`);
  fs.createReadStream(file).pipe(res);
});
