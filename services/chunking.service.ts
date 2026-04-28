// backend/services/chunking.service.ts

import { ExtractedPage } from "./pdf.service";

// ─── Types ────────────────────────────────────────────────────────────────────
export interface TextChunk {
  content: string;
  pageNumber: number;
  chunkIndex: number;
  characterCount: number;
}

// ─── Constants ────────────────────────────────────────────────────────────────
// Tuned for Mistral embeddings + RAG quality
const CHUNK_SIZE = 512;        // Target characters per chunk
const CHUNK_OVERLAP = 100;     // Overlap between chunks to preserve context
const MIN_CHUNK_SIZE = 50;     // Discard chunks smaller than this

// ─── Split Text Into Sentences ────────────────────────────────────────────────
// Naive but effective sentence splitter
function splitIntoSentences(text: string): string[] {
  return text
    .split(/(?<=[.!?])\s+/)   // Split after punctuation
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

// ─── Chunk a Single Page's Text ───────────────────────────────────────────────
function chunkPageText(
  text: string,
  pageNumber: number,
  startingChunkIndex: number
): TextChunk[] {
  const sentences = splitIntoSentences(text);
  const chunks: TextChunk[] = [];

  let currentChunk = "";
  let chunkIndex = startingChunkIndex;

  for (let i = 0; i < sentences.length; i++) {
    const sentence = sentences[i];

    // If adding this sentence exceeds chunk size, save current and start new
    if (
      currentChunk.length + sentence.length > CHUNK_SIZE &&
      currentChunk.length > 0
    ) {
      // Save the current chunk
      if (currentChunk.trim().length >= MIN_CHUNK_SIZE) {
        chunks.push({
          content: currentChunk.trim(),
          pageNumber,
          chunkIndex,
          characterCount: currentChunk.trim().length,
        });
        chunkIndex++;
      }

      // ── Overlap: start next chunk with tail of current ──────────────────
      // Walk back through sentences to fill overlap window
      const overlapSentences: string[] = [];
      let overlapLength = 0;

      for (let j = i - 1; j >= 0; j--) {
        const s = sentences[j];
        if (overlapLength + s.length > CHUNK_OVERLAP) break;
        overlapSentences.unshift(s);
        overlapLength += s.length;
      }

      currentChunk = overlapSentences.join(" ") + " " + sentence;
    } else {
      // Keep building current chunk
      currentChunk = currentChunk
        ? currentChunk + " " + sentence
        : sentence;
    }
  }

  // ── Push the final remaining chunk ───────────────────────────────────────
  if (currentChunk.trim().length >= MIN_CHUNK_SIZE) {
    chunks.push({
      content: currentChunk.trim(),
      pageNumber,
      chunkIndex,
      characterCount: currentChunk.trim().length,
    });
  }

  return chunks;
}

// ─── Main: Chunk All Pages ────────────────────────────────────────────────────
export function chunkExtractedPages(pages: ExtractedPage[]): TextChunk[] {
  const allChunks: TextChunk[] = [];
  let globalChunkIndex = 0;

  for (const page of pages) {
    if (!page.content || page.content.trim().length < MIN_CHUNK_SIZE) {
      continue; // Skip empty or near-empty pages
    }

    const pageChunks = chunkPageText(
      page.content,
      page.pageNumber,
      globalChunkIndex
    );

    allChunks.push(...pageChunks);
    globalChunkIndex += pageChunks.length;
  }

  console.log(
    `[Chunking] Created ${allChunks.length} chunks ` +
    `from ${pages.length} pages`
  );

  return allChunks;
}

// ─── Stats Helper (for debugging/logging) ────────────────────────────────────
export function getChunkingStats(chunks: TextChunk[]): {
  total: number;
  avgCharacters: number;
  minCharacters: number;
  maxCharacters: number;
} {
  if (chunks.length === 0) {
    return { total: 0, avgCharacters: 0, minCharacters: 0, maxCharacters: 0 };
  }

  const lengths = chunks.map((c) => c.characterCount);

  return {
    total: chunks.length,
    avgCharacters: Math.round(
      lengths.reduce((a, b) => a + b, 0) / lengths.length
    ),
    minCharacters: Math.min(...lengths),
    maxCharacters: Math.max(...lengths),
  };
}