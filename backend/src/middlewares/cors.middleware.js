import cors from "cors";
import { config } from "../config/env.js";

const EXTENSION_ORIGIN_REGEX = /^chrome-extension:\/\/[a-p]{32}$/;

export const corsMiddleware = cors({
  origin: (origin, callback) => {
    // Requests without origin (like curl, automated health checks) are allowed
    if (!origin) {
      return callback(null, true);
    }

    if (config.ALLOWED_ORIGINS.length > 0) {
      return callback(null, config.ALLOWED_ORIGINS.includes(origin));
    }

    // Default: allow valid Chrome Extension origins
    if (EXTENSION_ORIGIN_REGEX.test(origin)) {
      return callback(null, true);
    }

    // Disallow other origins by default
    return callback(null, false);
  },
  methods: ["GET", "POST", "OPTIONS"],
  allowedHeaders: ["Content-Type", "X-Relevy-Install"],
});
