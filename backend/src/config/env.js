import { existsSync, readFileSync } from "node:fs";
import { z } from "zod";

/**
 * Safe .env file loader with comment stripping.
 * Uses native process.loadEnvFile when available, with a resilient fallback.
 */
function loadEnv() {
  const envUrl = new URL("../../.env", import.meta.url);
  if (!existsSync(envUrl)) return;

  if (typeof process.loadEnvFile === "function") {
    try {
      process.loadEnvFile(envUrl);
      return;
    } catch {
      // Fallback to manual parser below if native loader throws
    }
  }

  const content = readFileSync(envUrl, "utf8");
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;

    // Strip trailing inline comments: KEY=VALUE # comment -> KEY=VALUE
    const cleanLine = line.replace(/\s+#.*$/, "");
    const match = cleanLine.match(/^([A-Z0-9_]+)\s*=\s*(.*?)$/);
    if (match && process.env[match[1]] === undefined) {
      process.env[match[1]] = match[2].replace(/^["']|["']$/g, "").trim();
    }
  }
}

loadEnv();

const sanitizeNumber = (defaultValue, min = 1, max = 65535) =>
  z.preprocess(
    (val) => (val === "" || val === undefined || val === null ? defaultValue : val),
    z.coerce.number().int().min(min).max(max).default(defaultValue)
  );

// Strict Zod schema for environment variables
const envSchema = z.object({
  PORT: sanitizeNumber(8787, 1, 65535),
  OPENROUTER_API_KEY: z.string().trim().default(""),
  TYPESAFE_API_KEY: z.string().trim().default(""),
  TYPESAFE_BASE_URL: z.string().trim().default(""),
  TYPESAFE_API_URL: z.string().trim().default(""),
  OPENROUTER_BASE_URL: z.string().trim().default(""),
  JEV_MODEL: z.string().trim().default(""),
  TYPESAFE_MODEL: z.string().trim().default(""),
  ALLOWED_ORIGINS: z.string().default(""),
  RATE_LIMIT_POSTS_PER_MIN: sanitizeNumber(300, 1, 100000),
  JEV_CONCURRENCY: sanitizeNumber(8, 1, 64),
  TYPESAFE_TIMEOUT: z.preprocess(
    (val) => (val === "" || val === undefined || val === null ? 0 : val),
    z.coerce.number().min(0).default(0)
  ),
});

const parsedEnv = envSchema.parse(process.env);

/**
 * Pure function to resolve API provider configuration
 * @param {z.infer<typeof envSchema>} env
 */
export function resolveProvider(env) {
  const openRouterKey = env.OPENROUTER_API_KEY;
  const typeSafeKey = env.TYPESAFE_API_KEY;
  let rawUrl = (
    env.TYPESAFE_BASE_URL ||
    env.TYPESAFE_API_URL ||
    env.OPENROUTER_BASE_URL ||
    ""
  ).trim();

  let apiKey = "";
  let isOpenRouter = false;

  if (openRouterKey && openRouterKey !== "demo") {
    apiKey = openRouterKey;
    isOpenRouter = true;
  } else if (typeSafeKey && typeSafeKey !== "demo") {
    apiKey = typeSafeKey;
    if (typeSafeKey.startsWith("sk-or-") || rawUrl.includes("openrouter.ai")) {
      isOpenRouter = true;
    }
  } else if (typeSafeKey === "demo" || openRouterKey === "demo") {
    apiKey = "demo";
  }

  if (!rawUrl && isOpenRouter) {
    rawUrl = "https://openrouter.ai/api";
  }

  // Normalize base URL
  let baseUrl = rawUrl.replace(/\/+$/, "");
  if (baseUrl.endsWith("/v1/systemone")) {
    baseUrl = baseUrl.slice(0, -"/v1/systemone".length);
  } else if (baseUrl.endsWith("/v1")) {
    baseUrl = baseUrl.slice(0, -"/v1".length);
  }

  return {
    apiKey,
    isOpenRouter,
    baseUrl: baseUrl || undefined,
    demo: apiKey === "" || apiKey === "demo",
    model: env.JEV_MODEL || env.TYPESAFE_MODEL || "jev-latest",
  };
}

const provider = resolveProvider(parsedEnv);

// Immutable, frozen application configuration
export const config = Object.freeze({
  PORT: parsedEnv.PORT,
  API_KEY: provider.apiKey,
  BASE_URL: provider.baseUrl,
  MODEL: provider.model,
  DEMO: provider.demo,
  isOpenRouter: provider.isOpenRouter,
  ALLOWED_ORIGINS: Object.freeze(
    parsedEnv.ALLOWED_ORIGINS.split(",")
      .map((s) => s.trim())
      .filter(Boolean)
  ),
  RATE_LIMIT_POSTS_PER_MIN: parsedEnv.RATE_LIMIT_POSTS_PER_MIN,
  CONCURRENCY: parsedEnv.JEV_CONCURRENCY,
  TIMEOUT_MS: parsedEnv.TYPESAFE_TIMEOUT > 0 ? parsedEnv.TYPESAFE_TIMEOUT * 1000 : 15000,
  LIMITS: Object.freeze({
    posts: 25,
    topics: 30,
    textChars: 2000,
    topicChars: 40,
  }),
});
