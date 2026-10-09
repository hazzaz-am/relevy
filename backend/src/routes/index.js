import { Router } from "express";
import healthRoutes from "./health.routes.js";
import scoreRoutes from "./score.routes.js";

const router = Router();

router.use(healthRoutes);
router.use(scoreRoutes);

export default router;
