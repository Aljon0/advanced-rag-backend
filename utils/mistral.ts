// backend/utils/mistral.ts

import * as MistralSDK from "@mistralai/mistralai";
import dotenv from "dotenv";

dotenv.config();

// ─── Validate Environment Variable ───────────────────────────────────────────
const MISTRAL_API_KEY = process.env.MISTRAL_API_KEY;

if (!MISTRAL_API_KEY) {
  throw new Error("Missing environment variable: MISTRAL_API_KEY");
}

// ─── Mistral Client Singleton ─────────────────────────────────────────────────
const mistral = new (MistralSDK as { Mistral: new (config: { apiKey: string }) => any })
  .Mistral({ apiKey: MISTRAL_API_KEY });

// ─── Embedding Model Config ───────────────────────────────────────────────────
// mistral-embed outputs 1024-dimensional vectors
// Must match the vector(1024) column in your Supabase table
const EMBEDDING_MODEL = "mistral-embed";

// ─── LLM Model Config ─────────────────────────────────────────────────────────
// Used for generating RAG answers
const CHAT_MODEL = "mistral-small-latest";

// ─── Generate Embeddings ──────────────────────────────────────────────────────
// Accepts a single string or an array of strings (batch)
// Returns an array of number[] vectors
export async function generateEmbeddings(
  inputs: string | string[]
): Promise<number[][]> {
  const inputArray = Array.isArray(inputs) ? inputs : [inputs];

  const response = await mistral.embeddings.create({
    model: EMBEDDING_MODEL,
    inputs: inputArray,
  });

  // Extract the embedding vectors from the response
  return response.data.map((item) => item.embedding);
}

// ─── Generate Single Embedding ────────────────────────────────────────────────
// Convenience wrapper for embedding a single string
export async function generateEmbedding(input: string): Promise<number[]> {
  const embeddings = await generateEmbeddings([input]);
  return embeddings[0];
}

// ─── Generate Chat Completion ─────────────────────────────────────────────────
// Used in RAG: send context + question, get AI answer back
export async function generateChatCompletion(
  systemPrompt: string,
  userMessage: string
): Promise<string> {
  const response = await mistral.chat.complete({
    model: CHAT_MODEL,
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user",   content: userMessage  },
    ],
    temperature: 0.2,   // Low temp = more factual, less creative
    maxTokens: 1024,
  });

  const content = response.choices?.[0]?.message?.content;

  if (!content) {
    throw new Error("No response received from Mistral AI");
  }

  // content can be string | ContentChunk[] — normalize to string
  if (typeof content === "string") {
    return content;
  }

  // If it's an array of chunks, extract and join text parts
  return content
    .map((chunk) => ("text" in chunk ? chunk.text : ""))
    .join("");
}

export { EMBEDDING_MODEL, CHAT_MODEL };
export default mistral;