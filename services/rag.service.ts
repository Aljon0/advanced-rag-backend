// backend/services/rag.service.ts

import { generateChatCompletion } from "../utils/mistral";
import { hybridSearch, SearchResult } from "./search.service";
import { AppError } from "../middleware/errorHandler";

// ─── Types ────────────────────────────────────────────────────────────────────

// Matches exactly: src/types/chat.ts → Citation
export interface RagCitation {
  documentId: string;
  documentName: string;
  snippet: string;
  pageNumber?: number;
  confidence: number;   // 0–100
}

// Matches exactly: src/types/api.ts → AskQuestionResponse
export interface RagResponse {
  answer: string;
  citations: RagCitation[];
  sessionId: string;
  confidence: number;   // 0–100
}

// ─── Constants ────────────────────────────────────────────────────────────────
const MAX_CONTEXT_CHUNKS = 5;
const SNIPPET_MAX_LENGTH = 300;   // Characters shown in citation snippet

// ─── Build System Prompt ──────────────────────────────────────────────────────
// Instructs Mistral how to behave and format its response
function buildSystemPrompt(): string {
  return `You are a precise and helpful AI assistant for a private knowledge base.
Your job is to answer questions strictly based on the provided document context.

STRICT RULES:
1. Only use information from the provided context chunks
2. If the context does not contain enough information, say so clearly
3. Never hallucinate or make up information
4. Always be concise and factual
5. Cite which document and page your answer comes from

RESPONSE FORMAT:
You must respond with a valid JSON object in this exact format:
{
  "answer": "Your detailed answer here based on the context",
  "confidence": <number between 0 and 100>,
  "citedChunks": [<chunk_index_1>, <chunk_index_2>]
}

Where:
- "answer" is your response to the question
- "confidence" is how confident you are based on context quality (0-100)
- "citedChunks" is an array of chunk indices (0-based) you used to answer`;
}

// ─── Build User Prompt ────────────────────────────────────────────────────────
// Formats context chunks + question into the user message
function buildUserPrompt(
  question: string,
  chunks: SearchResult[]
): string {
  const contextBlocks = chunks
    .map((chunk, index) =>
      `[CHUNK ${index}]
Document: ${chunk.documentName}
Page: ${chunk.pageNumber ?? "N/A"}
Content: ${chunk.content}`
    )
    .join("\n\n");

  return `CONTEXT:
${contextBlocks}

QUESTION: ${question}

Remember: Respond ONLY with a valid JSON object as specified.`;
}

// ─── Parse Mistral Response ───────────────────────────────────────────────────
// Safely parses the JSON response from Mistral
function parseMistralResponse(raw: string): {
  answer: string;
  confidence: number;
  citedChunks: number[];
} {
  try {
    // Strip markdown code fences if Mistral wraps in ```json ... ```
    const cleaned = raw
      .replace(/^```json\s*/i, "")
      .replace(/^```\s*/i, "")
      .replace(/```\s*$/i, "")
      .trim();

    const parsed = JSON.parse(cleaned);

    // Validate required fields
    if (typeof parsed.answer !== "string") {
      throw new Error("Missing answer field");
    }

    return {
      answer: parsed.answer,
      confidence: typeof parsed.confidence === "number"
        ? Math.min(100, Math.max(0, parsed.confidence))
        : 50,
      citedChunks: Array.isArray(parsed.citedChunks)
        ? parsed.citedChunks.filter((i: unknown) => typeof i === "number")
        : [],
    };
  } catch {
    // If JSON parsing fails, treat raw text as the answer
    console.warn("[RAG] Failed to parse JSON response, using raw text");
    return {
      answer: raw.trim(),
      confidence: 40,
      citedChunks: [],
    };
  }
}

// ─── Build Citations ──────────────────────────────────────────────────────────
function buildCitations(
  citedChunkIndices: number[],
  chunks: SearchResult[]
): RagCitation[] {
  const seen = new Set<string>();
  
  return citedChunkIndices
    .filter((index) => index >= 0 && index < chunks.length)
    .map((index) => {
      const chunk = chunks[index];
      return {
        documentId: chunk.documentId,
        documentName: chunk.documentName,
        snippet:
          chunk.content.slice(0, SNIPPET_MAX_LENGTH) +
          (chunk.content.length > SNIPPET_MAX_LENGTH ? "..." : ""),
        pageNumber: chunk.pageNumber ?? undefined,
        confidence: Math.round(chunk.score * 100),
      };
    })
    .filter((citation) => {
      // ✅ Was: `${citation.documentId}-${citation.pageNumber}` — too loose,
      //    same doc on different pages still duplicates the documentId key
      if (seen.has(citation.documentId)) return false;
      seen.add(citation.documentId);
      return true;
    });
}

// ─── Generate Session ID ──────────────────────────────────────────────────────
function generateSessionId(): string {
  return `session_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}

// ─── Main: RAG Pipeline ───────────────────────────────────────────────────────
export async function ragAnswer(
  question: string,
  sessionId?: string
): Promise<RagResponse> {
  if (!question || question.trim().length === 0) {
    throw new AppError("Question cannot be empty.", 400, "EMPTY_QUESTION");
  }

  console.log(`[RAG] Processing question: "${question}"`);

  // ── Step 1: Hybrid search for relevant chunks ─────────────────────────────
  const searchResults = await hybridSearch(question);

  if (searchResults.length === 0) {
    console.log("[RAG] No relevant chunks found");
    return {
      answer:
        "I could not find any relevant information in the knowledge base " +
        "to answer your question. Please try rephrasing or upload relevant documents.",
      citations: [],
      sessionId: sessionId ?? generateSessionId(),
      confidence: 0,
    };
  }

  // ── Step 2: Take top chunks for context ───────────────────────────────────
  const contextChunks = searchResults.slice(0, MAX_CONTEXT_CHUNKS);

  console.log(
    `[RAG] Using ${contextChunks.length} chunks as context`
  );

  // ── Step 3: Build prompts ─────────────────────────────────────────────────
  const systemPrompt = buildSystemPrompt();
  const userPrompt = buildUserPrompt(question, contextChunks);

  // ── Step 4: Call Mistral ──────────────────────────────────────────────────
  let rawResponse: string;
  try {
    rawResponse = await generateChatCompletion(systemPrompt, userPrompt);
  } catch (err) {
    throw new AppError(
      `AI generation failed: ${
        err instanceof Error ? err.message : "Unknown error"
      }`,
      500,
      "AI_GENERATION_FAILED"
    );
  }

  console.log("[RAG] Received response from Mistral");

  // ── Step 5: Parse response ────────────────────────────────────────────────
  const parsed = parseMistralResponse(rawResponse);

  // ── Step 6: Build citations ───────────────────────────────────────────────
  const citations = buildCitations(parsed.citedChunks, contextChunks);

  // ── Step 7: Assemble final response ──────────────────────────────────────
  const response: RagResponse = {
    answer: parsed.answer,
    citations,
    sessionId: sessionId ?? generateSessionId(),
    confidence: parsed.confidence,
  };

  console.log(
    `[RAG] ✅ Answer generated | ` +
    `Confidence: ${response.confidence}% | ` +
    `Citations: ${citations.length}`
  );

  return response;
}