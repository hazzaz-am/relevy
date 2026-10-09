import { existsSync, readFileSync } from "node:fs";

// Load .env from backend root if present
const envUrl = new URL("../../.env", import.meta.url);
if (existsSync(envUrl)) {
  if (typeof process.loadEnvFile === "function") {
    try {
      process.loadEnvFile(envUrl);
    } catch {
      loadEnvFallback(envUrl);
    }
  } else {
    loadEnvFallback(envUrl);
  }
}

function loadEnvFallback(url) {
  for (const line of readFileSync(url, "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (m && process.env[m[1]] === undefined) {
      process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
    }
  }
}

const PORT = Number(process.env.PORT || 8787);
const openRouterKey = (process.env.OPENROUTER_API_KEY || "").trim();
const typeSafeKey = (process.env.TYPESAFE_API_KEY || "").trim();

let rawBaseUrl = (
  process.env.TYPESAFE_BASE_URL ||
  process.env.TYPESAFE_API_URL ||
  process.env.OPENROUTER_BASE_URL ||
  ""
).trim();

let API_KEY = "";
let isOpenRouter = false;

if (openRouterKey && openRouterKey !== "demo") {
  API_KEY = openRouterKey;
  isOpenRouter = true;
} else if (typeSafeKey && typeSafeKey !== "demo") {
  API_KEY = typeSafeKey;
  if (typeSafeKey.startsWith("sk-or-") || (rawBaseUrl && rawBaseUrl.includes("openrouter.ai"))) {
    isOpenRouter = true;
  }
} else if (typeSafeKey === "demo" || openRouterKey === "demo") {
  API_KEY = "demo";
}

if (!rawBaseUrl && isOpenRouter) {
  rawBaseUrl = "https://openrouter.ai/api";
}

let BASE_URL = rawBaseUrl;
if (BASE_URL) {
  BASE_URL = BASE_URL.replace(/\/+$/, "");
  if (BASE_URL.endsWith("/v1/systemone")) {
    BASE_URL = BASE_URL.slice(0, -"/v1/systemone".length);
  } else if (BASE_URL.endsWith("/v1")) {
    BASE_URL = BASE_URL.slice(0, -"/v1".length);
  }
}

const MODEL = (process.env.JEV_MODEL || process.env.TYPESAFE_MODEL || "jev-latest").trim();
const DEMO = API_KEY === "" || API_KEY === "demo";
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

const RATE_LIMIT_POSTS_PER_MIN = Number(process.env.RATE_LIMIT_POSTS_PER_MIN || 300);
const CONCURRENCY = Number(process.env.JEV_CONCURRENCY || 8);
const TIMEOUT_SECONDS = Number(process.env.TYPESAFE_TIMEOUT || 0);
const TIMEOUT_MS = TIMEOUT_SECONDS > 0 ? TIMEOUT_SECONDS * 1000 : 15000;

export const config = {
  PORT,
  API_KEY,
  BASE_URL: BASE_URL || undefined,
  MODEL,
  DEMO,
  isOpenRouter,
  ALLOWED_ORIGINS,
  RATE_LIMIT_POSTS_PER_MIN,
  CONCURRENCY,
  TIMEOUT_MS,
  LIMITS: {
    posts: 25,
    topics: 30,
    textChars: 2000,
    topicChars: 40,
  },
};
