// backend/utils/supabase.ts

import { createClient, SupabaseClient } from "@supabase/supabase-js";
import dotenv from "dotenv";

dotenv.config();

// ─── Validate Environment Variables ──────────────────────────────────────────
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL) {
  throw new Error("Missing environment variable: SUPABASE_URL");
}

if (!SUPABASE_SERVICE_ROLE_KEY) {
  throw new Error("Missing environment variable: SUPABASE_SERVICE_ROLE_KEY");
}

// ─── Database Types ───────────────────────────────────────────────────────────
// Mirrors exactly what's in your Supabase tables
export interface DbDocument {
  id: string;
  name: string;
  size: number;
  mime_type: string;
  page_count: number | null;
  status: "uploading" | "processing" | "ready" | "error";
  uploaded_at: string;
}

export interface DbDocumentChunk {
  id: string;
  document_id: string;
  content: string;
  page_number: number | null;
  chunk_index: number;
  embedding: number[] | null;
  created_at: string;
}

// ─── Supabase Client Singleton ────────────────────────────────────────────────
const supabase: SupabaseClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: {
    persistSession: false,   // Backend doesn't need session persistence
    autoRefreshToken: false,
  },
});

export default supabase;