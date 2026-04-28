// backend/controllers/chat.controller.ts

import { Request, Response, NextFunction } from "express";
import { ragAnswer } from "../services/rag.service";
import { AppError } from "../middleware/errorHandler";

// ─── Types ────────────────────────────────────────────────────────────────────
// Matches exactly: src/types/api.ts → AskQuestionRequest
interface AskQuestionBody {
  question: string;
  sessionId?: string;
}

// ─── Ask Question ─────────────────────────────────────────────────────────────
// POST /chat/ask
// Matches: askQuestion() in frontend/src/services/api.ts
export async function askQuestion(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const { question, sessionId } = req.body as AskQuestionBody;

    // ── Validate request body ─────────────────────────────────────────────
    if (!question) {
      throw new AppError(
        "Question is required.",
        400,
        "MISSING_QUESTION"
      );
    }

    if (typeof question !== "string") {
      throw new AppError(
        "Question must be a string.",
        400,
        "INVALID_QUESTION_TYPE"
      );
    }

    const trimmedQuestion = question.trim();

    if (trimmedQuestion.length === 0) {
      throw new AppError(
        "Question cannot be empty.",
        400,
        "EMPTY_QUESTION"
      );
    }

    if (trimmedQuestion.length > 1000) {
      throw new AppError(
        "Question is too long. Maximum 1000 characters allowed.",
        400,
        "QUESTION_TOO_LONG"
      );
    }

    console.log(
      `[Chat] Question received: "${trimmedQuestion.slice(0, 80)}${
        trimmedQuestion.length > 80 ? "..." : ""
      }"`
    );

    // ── Run RAG pipeline ──────────────────────────────────────────────────
    const ragResponse = await ragAnswer(trimmedQuestion, sessionId);

    // ── Return response matching AskQuestionResponse ──────────────────────
    // Matches exactly: src/types/api.ts → AskQuestionResponse
    res.status(200).json({
      answer: ragResponse.answer,
      citations: ragResponse.citations,
      sessionId: ragResponse.sessionId,
      confidence: ragResponse.confidence,
    });

    console.log(
      `[Chat] ✅ Response sent | ` +
      `Confidence: ${ragResponse.confidence}% | ` +
      `Citations: ${ragResponse.citations.length}`
    );
  } catch (err) {
    next(err);
  }
}