// backend/routes/dashboard.routes.ts

import { Router } from "express";
import { getDashboard } from "../controllers/documents.controller";

const router = Router();

// GET /dashboard/stats
router.get("/stats", getDashboard);

export default router;