// backend/controllers/upload.controller.ts
import { validatePdfFile, extractTextFromPdf } from "../services/pdf.service.js";
import { chunkExtractedPages, getChunkingStats } from "../services/chunking.service.js";
import { embedChunks, getEmbeddingStats } from "../services/embedding.service.js";
import { createDocument, saveChunks, updateDocumentStatus, } from "../services/vector.service.js";
import { AppError } from "../middleware/errorHandler.js";
// ─── Upload + Process PDF ─────────────────────────────────────────────────────
// POST /documents/upload
// Matches: uploadFile() in frontend/src/services/api.ts
export async function uploadDocument(req, res, next) {
    let documentId = null;
    try {
        // ── Step 1: Validate uploaded file ──────────────────────────────────────
        if (!req.file) {
            throw new AppError("No file uploaded. Please attach a PDF file.", 400, "NO_FILE");
        }
        const file = req.file;
        validatePdfFile(file);
        console.log(`[Upload] Received file: "${file.originalname}" ` +
            `(${(file.size / 1024).toFixed(1)} KB)`);
        // ── Step 2: Create document record in DB (status: processing) ───────────
        const dbDocument = await createDocument({
            name: file.originalname,
            size: file.size,
            mimeType: file.mimetype,
            pageCount: 0, // Updated after extraction
        });
        documentId = dbDocument.id;
        console.log(`[Upload] Created document record: ${documentId}`);
        // ── Step 3: Extract text from PDF ────────────────────────────────────────
        const extractedData = await extractTextFromPdf(file.buffer);
        console.log(`[Upload] Extracted ${extractedData.totalPages} pages ` +
            `from "${file.originalname}"`);
        // ── Step 4: Chunk the extracted text ─────────────────────────────────────
        const chunks = chunkExtractedPages(extractedData.pages);
        const chunkStats = getChunkingStats(chunks);
        console.log(`[Upload] Chunking stats: ${chunkStats.total} chunks, ` +
            `avg ${chunkStats.avgCharacters} chars`);
        if (chunks.length === 0) {
            await updateDocumentStatus(documentId, "error");
            throw new AppError("No text content could be extracted from this PDF.", 422, "NO_CONTENT");
        }
        // ── Step 5: Generate embeddings ───────────────────────────────────────────
        const embeddedChunks = await embedChunks(chunks);
        const embeddingStats = getEmbeddingStats(embeddedChunks);
        console.log(`[Upload] Embedding stats: ${embeddingStats.total} vectors, ` +
            `${embeddingStats.dimension} dimensions`);
        // ── Step 6: Save chunks + embeddings to Supabase ──────────────────────────
        await saveChunks(documentId, embeddedChunks);
        // ── Step 7: Update document status to ready ───────────────────────────────
        await updateDocumentStatus(documentId, "ready", extractedData.totalPages);
        console.log(`[Upload] ✅ Document "${file.originalname}" fully processed`);
        // ── Step 8: Return response matching UploadFileResponse type ─────────────
        // Matches exactly: src/types/api.ts → UploadFileResponse
        res.status(201).json({
            document: {
                id: documentId,
                name: file.originalname,
                size: file.size,
                uploadedAt: dbDocument.uploaded_at,
                status: "ready",
                pageCount: extractedData.totalPages,
                mimeType: file.mimetype,
            },
            message: `"${file.originalname}" uploaded and processed successfully.`,
        });
    }
    catch (err) {
        // ── On any failure: mark document as error if it was created ─────────────
        if (documentId) {
            try {
                await updateDocumentStatus(documentId, "error");
                console.error(`[Upload] Marked document ${documentId} as error due to failure`);
            }
            catch (updateErr) {
                console.error("[Upload] Failed to update document status to error");
            }
        }
        next(err);
    }
}
