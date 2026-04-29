// backend/services/pdf.service.ts

import { PDFParse } from "pdf-parse";
import { AppError } from "../middleware/errorHandler.js";

// ─── Types ────────────────────────────────────────────────────────────────────
export interface ExtractedPage {
  pageNumber: number;
  content: string;
}

export interface ExtractedPdfData {
  pages: ExtractedPage[];
  totalPages: number;
  rawText: string;
}

// ─── Constants ────────────────────────────────────────────────────────────────
const MAX_FILE_SIZE_MB = 50;
const MAX_FILE_SIZE_BYTES = MAX_FILE_SIZE_MB * 1024 * 1024;
const ALLOWED_MIME_TYPES = ["application/pdf"];

// ─── Validate File ────────────────────────────────────────────────────────────
export function validatePdfFile(
  file: Express.Multer.File
): void {
  if (!ALLOWED_MIME_TYPES.includes(file.mimetype)) {
    throw new AppError(
      "Invalid file type. Only PDF files are allowed.",
      400,
      "INVALID_FILE_TYPE"
    );
  }

  if (file.size > MAX_FILE_SIZE_BYTES) {
    throw new AppError(
      `File too large. Maximum size is ${MAX_FILE_SIZE_MB}MB.`,
      400,
      "FILE_TOO_LARGE"
    );
  }
}

// ─── Extract Text from PDF Buffer ────────────────────────────────────────────
export async function extractTextFromPdf(
  buffer: Buffer
): Promise<ExtractedPdfData> {
  const parser = new PDFParse({ data: buffer });

  try {
    const textResult = await parser.getText();
    const pages: ExtractedPage[] = textResult.pages
      .map((page) => ({
        pageNumber: page.num,
        content: page.text.trim(),
      }))
      .filter((page) => page.content.length > 0);

    // Fallback: if page-level extraction failed, use raw text
    if (pages.length === 0 && textResult.text) {
      pages.push({
        pageNumber: 1,
        content: textResult.text.trim(),
      });
    }

    if (!textResult.text || textResult.text.trim().length === 0) {
      throw new AppError(
        "Could not extract text from PDF. The file may be scanned or image-based.",
        422,
        "PDF_EXTRACTION_FAILED"
      );
    }

    console.log(
      `[PDF] Extracted ${pages.length} pages, ` +
      `${textResult.text.length} characters total`
    );

    return {
      pages,
      totalPages: textResult.total,
      rawText: textResult.text,
    };
  } catch (err) {
    // Re-throw AppErrors as-is
    if (err instanceof AppError) throw err;

    throw new AppError(
      "Failed to parse PDF file. Please ensure the file is not corrupted.",
      422,
      "PDF_PARSE_ERROR"
    );
  } finally {
    await parser.destroy();
  }
}