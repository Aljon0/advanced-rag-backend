// backend/routes/chat.routes.ts
import { Router } from "express";
import { askQuestion } from "../controllers/chat.controller.js";
const router = Router();
// ─── Routes ───────────────────────────────────────────────────────────────────
// POST /chat/ask
// Matches: askQuestion() → apiClient.post("/chat/ask", payload)
// Body: { question: string, sessionId?: string }
router.post("/ask", askQuestion);
export default router;
