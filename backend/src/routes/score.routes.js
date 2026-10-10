import { Router } from "express";
import { ScoreController } from "../controllers/score.controller.js";
import { rateLimiterMiddleware } from "../middlewares/rateLimiter.middleware.js";
import { validateBody } from "../middlewares/validate.middleware.js";
import { scoreRequestSchema } from "../models/score.schema.js";

const router = Router();

router.post(
  "/v1/score",
  validateBody(scoreRequestSchema),
  rateLimiterMiddleware,
  ScoreController.scorePosts
);

export default router;
