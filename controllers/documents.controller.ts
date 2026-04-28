// backend/controllers/documents.controller.ts

import { NextFunction, Request, Response } from "express";
import { AppError } from "../middleware/errorHandler";
import {
  deleteDocument,
  getAllDocuments,
  getDashboardStats,
  getDocumentById,
} from "../services/vector.service";

function getSingleParamValue(
  value: string | string[] | undefined,
  errorCode: string,
): string {
  if (typeof value === "string" && value.trim().length > 0) {
    return value;
  }

  if (Array.isArray(value) && value.length > 0 && value[0].trim().length > 0) {
    return value[0];
  }

  throw new AppError("Document ID is required.", 400, errorCode);
}

// ─── Get All Documents ────────────────────────────────────────────────────────
// GET /documents
// Matches: getDocuments() in frontend/src/services/api.ts
export async function getDocuments(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const dbDocuments = await getAllDocuments();

    // ── Map DB shape → frontend Document type ────────────────────────────────
    // Matches exactly: src/types/document.ts → Document
    const documents = dbDocuments.map((doc) => ({
      id: doc.id,
      name: doc.name,
      size: doc.size,
      uploadedAt: doc.uploaded_at,
      status: doc.status,
      pageCount: doc.page_count ?? undefined,
      mimeType: doc.mime_type,
    }));

    // ── Return response matching GetDocumentsResponse ─────────────────────
    // Matches exactly: src/types/api.ts → GetDocumentsResponse
    res.status(200).json({
      documents,
      total: documents.length,
    });
  } catch (err) {
    next(err);
  }
}

// ─── Get Single Document ──────────────────────────────────────────────────────
// GET /documents/:id
// Not in frontend api.ts but useful for future use
export async function getDocument(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const id = getSingleParamValue(req.params.id, "MISSING_DOCUMENT_ID");

    const doc = await getDocumentById(id);

    // ── Map DB shape → frontend Document type ────────────────────────────────
    res.status(200).json({
      id: doc.id,
      name: doc.name,
      size: doc.size,
      uploadedAt: doc.uploaded_at,
      status: doc.status,
      pageCount: doc.page_count ?? undefined,
      mimeType: doc.mime_type,
    });
  } catch (err) {
    next(err);
  }
}

// ─── Delete Document ──────────────────────────────────────────────────────────
// DELETE /documents/:id
// Matches: deleteDocument() in frontend/src/services/api.ts
export async function removeDocument(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const id = getSingleParamValue(req.params.id, "MISSING_DOCUMENT_ID");

    console.log(`[Documents] Deleting document: ${id}`);

    // deleteDocument() in vector.service.ts handles:
    // 1. Verifying document exists (throws 404 if not)
    // 2. Deleting document record
    // 3. Cascade deleting all associated chunks
    await deleteDocument(id);

    console.log(`[Documents] ✅ Document ${id} deleted successfully`);

    // 204 No Content — matches what frontend expects on successful delete
    res.status(204).send();
  } catch (err) {
    next(err);
  }
}

// ─── Dashboard Stats ───────────────────────────────────────────────────────────
// GET /dashboard/stats
export async function getDashboard(
  _req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const stats = await getDashboardStats();
    res.status(200).json(stats);
  } catch (err) {
    next(err);
  }
}
