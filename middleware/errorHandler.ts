// backend/middleware/errorHandler.ts

import { Request, Response, NextFunction } from "express";

const errorWithCaptureStack = Error as ErrorConstructor & {
  captureStackTrace?: (targetObject: object, constructorOpt?: Function) => void;
};

// ─── Custom App Error Class ───────────────────────────────────────────────────
// Use this to throw errors with a specific HTTP status code anywhere in the app
export class AppError extends Error {
  public statusCode: number;
  public code?: string;

  constructor(message: string, statusCode: number, code?: string) {
    super(message);
    this.statusCode = statusCode;
    this.code = code;
    this.name = "AppError";

    // Maintain proper stack trace when the runtime supports it (V8/Node).
    errorWithCaptureStack.captureStackTrace?.(this, this.constructor);
  }
}

// ─── Global Error Handler Middleware ─────────────────────────────────────────
// Must have 4 parameters for Express to recognize it as an error handler
export function errorHandler(
  err: Error | AppError,
  _req: Request,
  res: Response,
  _next: NextFunction
): void {
  // Log the full error server-side for debugging
  console.error(`[ERROR] ${err.name}: ${err.message}`);
  const nodeEnv = (globalThis as { process?: { env?: { NODE_ENV?: string } } })
    .process?.env?.NODE_ENV;
  if (nodeEnv === "development") {
    console.error(err.stack);
  }

  // Handle known AppErrors (thrown intentionally)
  if (err instanceof AppError) {
    res.status(err.statusCode).json({
      message: err.message,
      code: err.code,
      status: err.statusCode,
    });
    return;
  }

  // Handle Multer file errors (too large, wrong type, etc.)
  if (err.name === "MulterError") {
    res.status(400).json({
      message: err.message,
      code: "FILE_UPLOAD_ERROR",
      status: 400,
    });
    return;
  }

  // Fallback: unknown/unexpected errors
  res.status(500).json({
    message: "An unexpected error occurred. Please try again.",
    code: "INTERNAL_SERVER_ERROR",
    status: 500,
  });
}