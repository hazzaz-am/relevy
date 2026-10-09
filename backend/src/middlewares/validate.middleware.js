/**
 * Reusable validation middleware factory using Zod.
 * Validates req.body and replaces it with parsed/sanitized output.
 *
 * @param {import("zod").ZodSchema} schema
 */
export function validateBody(schema) {
  return (req, res, next) => {
    const result = schema.safeParse(req.body);
    if (!result.success) {
      const firstIssue = result.error.issues[0];
      const errorMessage = firstIssue?.message || "Invalid request payload";
      return res.status(400).json({ error: errorMessage });
    }
    req.body = result.data;
    next();
  };
}
