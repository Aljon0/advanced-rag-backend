// backend/routes/documents.routes.ts

import { Router } from "express";
import multer from "multer";
import { uploadDocument } from "../controllers/upload.controller.js";
import {
  getDocuments,
  getDocument,
  removeDocument,
} from "../controllers/documents.controller.js";

const router = Router();

// ─── Multer Configuration ─────────────────────────────────────────────────────
// Using memoryStorage so file buffer is available directly in req.file.buffer
// This avoids writing temp files to disk
const storage = multer.memoryStorage();

const upload = multer({
  storage,
  limits: {
    fileSize: 50 * 1024 * 1024,   // 50MB max — matches pdf.service.ts
    files: 1,                      // Only one file per request
  },
  fileFilter: (_req, file, callback) => {
    // Only allow PDF files at the Multer level
    if (file.mimetype === "application/pdf") {
      callback(null, true);
    } else {
      callback(
        new Error("Invalid file type. Only PDF files are allowed.")
      );
    }
  },
});

// ─── Routes ───────────────────────────────────────────────────────────────────

// POST /documents/upload
// Matches: uploadFile() → apiClient.post("/documents/upload", formData)
router.post(
  "/upload",
  upload.single("file"),   // "file" matches formData.append("file", file)
  uploadDocument
);

// GET /documents
// Matches: getDocuments() → apiClient.get("/documents")
router.get(
  "/",
  getDocuments
);

// GET /documents/:id
// For future document preview feature
router.get(
  "/:id",
  getDocument
);

// DELETE /documents/:id
// Matches: deleteDocument() → apiClient.delete(`/documents/${id}`)
router.delete(
  "/:id",
  removeDocument
);

export default router;