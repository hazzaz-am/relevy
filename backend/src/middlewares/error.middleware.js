import { logError } from "../utils/logger.js";

export function errorHandler(err, req, res, next) {
  logError(`Unhandled error on ${req.method} ${req.url}:`, err.message);

  if (err.type === "entity.too.large" || err.status === 413) {
    return res.status(413).json({ error: "Request too large" });
  }

  if (err.type === "entity.parse.failed" || (err instanceof SyntaxError && err.status === 400)) {
    return res.status(400).json({ error: "Body must be JSON" });
  }

  const status = err.status && typeof err.status === "number" ? err.status : 500;
  const message = status < 500 || err.status ? err.message : "Server error";

  res.status(status).json({ error: message });
}
