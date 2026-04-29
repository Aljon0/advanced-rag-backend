// backend/services/embedding.service.ts

import { generateEmbeddings } from "../utils/mistral.js";
import { TextChunk } from "./chunking.service.js";
import { AppError } from "../middleware/errorHandler.js";

// ─── Types ────────────────────────────────────────────────────────────────────
export interface EmbeddedChunk {
  content: string;
  pageNumber: number;
  chunkIndex: number;
  characterCount: number;
  embedding: number[];
}

// ─── Constants ────────────────────────────────────────────────────────────────
// Mistral allows up to 16384 tokens per embedding request
// Batching by 32 chunks keeps us safely under the limit
const BATCH_SIZE = 32;

// Delay between batches to respect rate limits (ms)
const BATCH_DELAY_MS = 200;

// ─── Delay Helper ─────────────────────────────────────────────────────────────
function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ─── Embed a Single Batch of Chunks ──────────────────────────────────────────
async function embedBatch(
  chunks: TextChunk[],
  batchNumber: number,
  totalBatches: number
): Promise<EmbeddedChunk[]> {
  console.log(
    `[Embedding] Processing batch ${batchNumber}/${totalBatches} ` +
    `(${chunks.length} chunks)`
  );

  const texts = chunks.map((chunk) => chunk.content);

  try {
    const embeddings = await generateEmbeddings(texts);

    // Validate we got back the right number of embeddings
    if (embeddings.length !== chunks.length) {
      throw new AppError(
        `Embedding count mismatch: expected ${chunks.length}, got ${embeddings.length}`,
        500,
        "EMBEDDING_MISMATCH"
      );
    }

    // Zip chunks with their embeddings
    return chunks.map((chunk, i) => ({
      content: chunk.content,
      pageNumber: chunk.pageNumber,
      chunkIndex: chunk.chunkIndex,
      characterCount: chunk.characterCount,
      embedding: embeddings[i],
    }));
  } catch (err) {
    // Re-throw AppErrors as-is
    if (err instanceof AppError) throw err;

    throw new AppError(
      `Failed to generate embeddings for batch ${batchNumber}: ${
        err instanceof Error ? err.message : "Unknown error"
      }`,
      500,
      "EMBEDDING_FAILED"
    );
  }
}

// ─── Main: Embed All Chunks in Batches ───────────────────────────────────────
export async function embedChunks(
  chunks: TextChunk[]
): Promise<EmbeddedChunk[]> {
  if (chunks.length === 0) {
    throw new AppError(
      "No chunks provided for embedding.",
      400,
      "NO_CHUNKS"
    );
  }

  const embeddedChunks: EmbeddedChunk[] = [];

  // ── Split chunks into batches ─────────────────────────────────────────────
  const batches: TextChunk[][] = [];
  for (let i = 0; i < chunks.length; i += BATCH_SIZE) {
    batches.push(chunks.slice(i, i + BATCH_SIZE));
  }

  const totalBatches = batches.length;

  console.log(
    `[Embedding] Starting embedding of ${chunks.length} chunks ` +
    `in ${totalBatches} batches`
  );

  // ── Process each batch sequentially ──────────────────────────────────────
  // Sequential (not parallel) to respect Mistral rate limits
  for (let i = 0; i < batches.length; i++) {
    const batch = batches[i];
    const batchNumber = i + 1;

    const embedded = await embedBatch(batch, batchNumber, totalBatches);
    embeddedChunks.push(...embedded);

    // Pause between batches (skip delay after last batch)
    if (i < batches.length - 1) {
      await delay(BATCH_DELAY_MS);
    }
  }

  console.log(
    `[Embedding] ✅ Successfully embedded ${embeddedChunks.length} chunks`
  );

  // ── Validate embedding dimensions ────────────────────────────────────────
  // Mistral-embed always returns 1024-dim vectors
  // This must match vector(1024) in your Supabase schema
  const expectedDimension = 1024;
  const actualDimension = embeddedChunks[0]?.embedding?.length;

  if (actualDimension !== expectedDimension) {
    throw new AppError(
      `Embedding dimension mismatch: expected ${expectedDimension}, ` +
      `got ${actualDimension}. Check your Supabase vector column size.`,
      500,
      "EMBEDDING_DIMENSION_MISMATCH"
    );
  }

  return embeddedChunks;
}

// ─── Stats Helper ─────────────────────────────────────────────────────────────
export function getEmbeddingStats(chunks: EmbeddedChunk[]): {
  total: number;
  dimension: number;
  batchesProcessed: number;
} {
  return {
    total: chunks.length,
    dimension: chunks[0]?.embedding?.length ?? 0,
    batchesProcessed: Math.ceil(chunks.length / BATCH_SIZE),
  };
}