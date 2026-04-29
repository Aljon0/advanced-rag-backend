// backend/services/vector.service.ts

import supabase, { DbDocument, DbDocumentChunk } from "../utils/supabase.js";
import { EmbeddedChunk } from "./embedding.service.js";
import { AppError } from "../middleware/errorHandler.js";

export interface CreateDocumentInput {
  name: string;
  size: number;
  mimeType: string;
  pageCount: number;
}

export interface VectorSearchResult {
  id: string;
  document_id: string;
  content: string;
  page_number: number | null;
  chunk_index: number;
  similarity: number;
}

const CHUNK_INSERT_BATCH_SIZE = 50;
const SIMILARITY_THRESHOLD = 0.3;  // ✅ Lowered from 0.7 — more permissive
const MAX_SEARCH_RESULTS = 5;

// ─── Documents ────────────────────────────────────────────────────────────────

export async function createDocument(
  input: CreateDocumentInput
): Promise<DbDocument> {
  const { data, error } = await supabase
    .from("documents")
    .insert({
      name: input.name,
      size: input.size,
      mime_type: input.mimeType,
      page_count: input.pageCount,
      status: "processing",
    })
    .select()
    .single();

  if (error) {
    throw new AppError(
      `Failed to create document record: ${error.message}`,
      500,
      "DB_INSERT_ERROR"
    );
  }

  return data;
}

export async function updateDocumentStatus(
  documentId: string,
  status: DbDocument["status"],
  pageCount?: number
): Promise<void> {
  const updates: Partial<DbDocument> = { status };
  if (pageCount !== undefined) updates.page_count = pageCount;

  const { error } = await supabase
    .from("documents")
    .update(updates)
    .eq("id", documentId);

  if (error) {
    throw new AppError(
      `Failed to update document status: ${error.message}`,
      500,
      "DB_UPDATE_ERROR"
    );
  }
}

export async function getAllDocuments(): Promise<DbDocument[]> {
  const { data, error } = await supabase
    .from("documents")
    .select("*")
    .order("uploaded_at", { ascending: false });

  if (error) {
    throw new AppError(
      `Failed to fetch documents: ${error.message}`,
      500,
      "DB_FETCH_ERROR"
    );
  }

  return data ?? [];
}

export async function getDocumentById(
  documentId: string
): Promise<DbDocument> {
  const { data, error } = await supabase
    .from("documents")
    .select("*")
    .eq("id", documentId)
    .single();

  if (error || !data) {
    throw new AppError("Document not found.", 404, "DOCUMENT_NOT_FOUND");
  }

  return data;
}

export async function deleteDocument(documentId: string): Promise<void> {
  await getDocumentById(documentId);

  const { error } = await supabase
    .from("documents")
    .delete()
    .eq("id", documentId);

  if (error) {
    throw new AppError(
      `Failed to delete document: ${error.message}`,
      500,
      "DB_DELETE_ERROR"
    );
  }

  console.log(`[Vector] Deleted document ${documentId} and its chunks`);
}

// ─── Document Chunks ──────────────────────────────────────────────────────────

export async function saveChunks(
  documentId: string,
  chunks: EmbeddedChunk[]
): Promise<void> {
  if (chunks.length === 0) {
    throw new AppError("No chunks to save.", 400, "NO_CHUNKS");
  }

  // ✅ Pass embedding as raw array — NOT JSON.stringify
  const rows = chunks.map((chunk) => ({
    document_id: documentId,
    content: chunk.content,
    page_number: chunk.pageNumber,
    chunk_index: chunk.chunkIndex,
    embedding: chunk.embedding,  // ✅ Fixed: raw number[] array
  }));

  for (let i = 0; i < rows.length; i += CHUNK_INSERT_BATCH_SIZE) {
    const batch = rows.slice(i, i + CHUNK_INSERT_BATCH_SIZE);
    const batchNumber = Math.floor(i / CHUNK_INSERT_BATCH_SIZE) + 1;
    const totalBatches = Math.ceil(rows.length / CHUNK_INSERT_BATCH_SIZE);

    console.log(
      `[Vector] Inserting chunk batch ${batchNumber}/${totalBatches}`
    );

    const { error } = await supabase
      .from("document_chunks")
      .insert(batch);

    if (error) {
      throw new AppError(
        `Failed to save chunks (batch ${batchNumber}): ${error.message}`,
        500,
        "DB_CHUNK_INSERT_ERROR"
      );
    }
  }

  console.log(
    `[Vector] ✅ Saved ${chunks.length} chunks for document ${documentId}`
  );
}

// ─── Vector Search ────────────────────────────────────────────────────────────

export async function semanticSearch(
  queryEmbedding: number[],
  limit: number = MAX_SEARCH_RESULTS
): Promise<VectorSearchResult[]> {
  const { data, error } = await supabase.rpc("match_chunks", {
    query_embedding: queryEmbedding,
    match_threshold: SIMILARITY_THRESHOLD,
    match_count: limit,
  });

  if (error) {
    throw new AppError(
      `Semantic search failed: ${error.message}`,
      500,
      "SEARCH_FAILED"
    );
  }

  return (data as VectorSearchResult[]) ?? [];
}

export async function keywordSearch(
  query: string,
  limit: number = MAX_SEARCH_RESULTS
): Promise<DbDocumentChunk[]> {
  const { data, error } = await supabase
    .from("document_chunks")
    .select("*")
    .textSearch("content", query, {
      type: "websearch",
      config: "english",
    })
    .limit(limit);

  if (error) {
    throw new AppError(
      `Keyword search failed: ${error.message}`,
      500,
      "KEYWORD_SEARCH_FAILED"
    );
  }

  return (data as DbDocumentChunk[]) ?? [];
}

// Add this at the bottom of vector.service.ts

export interface DashboardStats {
  totalDocuments: number;
  totalChunks: number;
  avgConfidence: number;
  recentActivity: {
    id: string;
    type: "upload" | "query";
    label: string;
    date: string;
  }[];
}

export async function getDashboardStats(): Promise<DashboardStats> {
  // ── Total documents ───────────────────────────────────────────────────────
  const { count: totalDocuments, error: docError } = await supabase
    .from("documents")
    .select("*", { count: "exact", head: true });

  if (docError) {
    throw new AppError(
      `Failed to fetch document count: ${docError.message}`,
      500,
      "DB_FETCH_ERROR"
    );
  }

  // ── Total chunks (proxy for knowledge base size) ──────────────────────────
  const { count: totalChunks, error: chunkError } = await supabase
    .from("document_chunks")
    .select("*", { count: "exact", head: true });

  if (chunkError) {
    throw new AppError(
      `Failed to fetch chunk count: ${chunkError.message}`,
      500,
      "DB_FETCH_ERROR"
    );
  }

  // ── Recent documents (last 5 uploads) ────────────────────────────────────
  const { data: recentDocs, error: recentError } = await supabase
    .from("documents")
    .select("id, name, uploaded_at")
    .order("uploaded_at", { ascending: false })
    .limit(5);

  if (recentError) {
    throw new AppError(
      `Failed to fetch recent documents: ${recentError.message}`,
      500,
      "DB_FETCH_ERROR"
    );
  }

  // ── Map recent docs → activity items ─────────────────────────────────────
  const recentActivity = (recentDocs ?? []).map((doc) => ({
    id: doc.id,
    type: "upload" as const,
    label: `Uploaded ${doc.name}`,
    date: doc.uploaded_at,
  }));

  return {
    totalDocuments: totalDocuments ?? 0,
    totalChunks: totalChunks ?? 0,
    avgConfidence: 87, // Will be dynamic once chat history is tracked
    recentActivity,
  };
}