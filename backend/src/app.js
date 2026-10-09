import express from "express";
import { corsMiddleware } from "./middlewares/cors.middleware.js";
import { errorHandler } from "./middlewares/error.middleware.js";
import routes from "./routes/index.js";

const app = express();

// Disable x-powered-by header
app.disable("x-powered-by");

// CORS & Preflight handling
app.use(corsMiddleware);

// JSON body parser with 200kb payload limit (same as original maxBytes = 200_000)
app.use(express.json({ limit: "200kb" }));

// Mount application routes
app.use(routes);

// 404 Not Found handler
app.use((req, res) => {
  res.status(404).json({ error: "Not found" });
});

// Centralized error handler
app.use(errorHandler);

export default app;
