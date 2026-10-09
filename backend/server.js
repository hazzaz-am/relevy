/*
 * Relevy server. The extension sends post text here; this server asks Jev
 * and returns a probability per (post, topic). The Jev API key never
 * leaves this machine.
 *
 *   GET  /health     -> { ok, mode: "live" | "demo", model }
 *   POST /v1/score   -> { results: { [postId]: { [topic]: probability } } }
 */
import http from "node:http";
import { readFileSync, existsSync } from "node:fs";
import { createHash } from "node:crypto";
import { demoScorePost } from "./lib/demo.js";

loadEnvFile(new URL("./.env", import.meta.url));

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
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || "").split(",").map((s) => s.trim()).filter(Boolean);
const RATE_LIMIT_POSTS_PER_MIN = Number(process.env.RATE_LIMIT_POSTS_PER_MIN || 300);
const CONCURRENCY = Number(process.env.JEV_CONCURRENCY || 8);
const TIMEOUT_SECONDS = Number(process.env.TYPESAFE_TIMEOUT || 0);
const TIMEOUT_MS = TIMEOUT_SECONDS > 0 ? TIMEOUT_SECONDS * 1000 : 15000;

const LIMITS = { posts: 25, topics: 30, textChars: 2000, topicChars: 40 };

const scorePost = DEMO
  ? demoScorePost
  : (await import("./lib/jev.js")).createJevScorer({
      apiKey: API_KEY,
      model: MODEL,
      baseURL: BASE_URL || undefined,
      timeoutMs: TIMEOUT_MS,
      isOpenRouter,
    });

/* ---------- shared cache: same viral post, same topic -> one Jev call ---------- */

const CACHE_MAX = 50000;
const cache = new Map();
function cacheGet(key) {
  if (!cache.has(key)) return undefined;
  const v = cache.get(key);
  cache.delete(key); // refresh LRU position
  cache.set(key, v);
  return v;
}
function cacheSet(key, v) {
  cache.set(key, v);
  if (cache.size > CACHE_MAX) cache.delete(cache.keys().next().value);
}

/* ---------- rate limit per install + IP ---------- */

const buckets = new Map();
function allow(key, cost) {
  const now = Date.now();
  let b = buckets.get(key);
  if (!b) b = { tokens: RATE_LIMIT_POSTS_PER_MIN, at: now };
  b.tokens = Math.min(RATE_LIMIT_POSTS_PER_MIN, b.tokens + ((now - b.at) / 60000) * RATE_LIMIT_POSTS_PER_MIN);
  b.at = now;
  const ok = b.tokens >= cost;
  if (ok) b.tokens -= cost;
  buckets.set(key, b);
  return ok;
}
setInterval(() => {
  const cutoff = Date.now() - 10 * 60000;
  for (const [k, b] of buckets) if (b.at < cutoff) buckets.delete(k);
}, 60000).unref();

/* ---------- handlers ---------- */

async function handleScore(req, res) {
  const body = await readJson(req);
  const posts = Array.isArray(body.posts) ? body.posts.slice(0, LIMITS.posts) : [];
  const topics = Array.from(new Set(
    (Array.isArray(body.topics) ? body.topics : [])
      .map((t) => String(t).toLowerCase().replace(/\s+/g, " ").trim().slice(0, LIMITS.topicChars))
      .filter(Boolean)
  )).slice(0, LIMITS.topics);

  if (!posts.length || !topics.length) return send(res, 400, { error: "Send at least one post and one topic." });

  const installId = String(req.headers["x-relevy-install"] || "anon").slice(0, 64);
  const ip = req.socket.remoteAddress || "";
  if (!allow(`${installId}|${ip}`, posts.length)) {
    return send(res, 429, { error: "Too many posts scored this minute. Slow down a little." });
  }

  const results = {};
  let jevCalls = 0;

  const jobs = posts.map((p) => async () => {
    const id = String(p.id || "").slice(0, 100);
    const text = String(p.text || "").slice(0, LIMITS.textChars);
    if (!id || !text.trim()) return;
    const textHash = createHash("sha1").update(text).digest("hex");
    const out = {};
    const missing = [];
    for (const t of topics) {
      const hit = cacheGet(`${textHash}|${t}`);
      if (hit === undefined) missing.push(t);
      else out[t] = hit;
    }
    if (missing.length) {
      jevCalls++;
      const { probs } = await scorePost({ text, site: String(p.site || body.site || "") }, missing);
      for (const [t, v] of Object.entries(probs)) {
        cacheSet(`${textHash}|${t}`, v);
        out[t] = v;
      }
    }
    results[id] = out;
  });

  const failure = await runPool(jobs, CONCURRENCY);
  // Partial success is fine: unscored posts are simply left visible.
  if (failure && Object.keys(results).length === 0) throw failure;
  log(`scored ${posts.length} posts x ${topics.length} topics (${jevCalls} ${DEMO ? "demo" : (isOpenRouter ? "OpenRouter" : "Jev")} calls)`);
  send(res, 200, { mode: DEMO ? "demo" : "live", results });
}

const server = http.createServer(async (req, res) => {
  cors(req, res);
  if (req.method === "OPTIONS") return res.writeHead(204).end();
  try {
    const url = new URL(req.url, "http://x");
    if (req.method === "GET" && url.pathname === "/health") {
      return send(res, 200, {
        ok: true,
        mode: DEMO ? "demo" : "live",
        model: DEMO ? "demo-keywords" : MODEL,
        provider: DEMO ? "demo" : (isOpenRouter ? "openrouter" : "typesafe"),
      });
    }
    if (req.method === "POST" && url.pathname === "/v1/score") return await handleScore(req, res);
    send(res, 404, { error: "Not found" });
  } catch (err) {
    log(`error: ${err.message}`);
    send(res, err.status || 500, { error: err.status ? err.message : "Server error" });
  }
});

server.listen(PORT, () => {
  const provider = DEMO
    ? "DEMO mode: keyword guesses, no API calls"
    : (isOpenRouter ? `live via OpenRouter, model ${MODEL}` : `live Jev, model ${MODEL}`);
  log(`Relevy server on http://localhost:${PORT} (${provider})`);
});

/* ---------- helpers ---------- */

function cors(req, res) {
  const origin = req.headers.origin || "";
  const isExtension = /^chrome-extension:\/\/[a-p]{32}$/.test(origin);
  const allowed = ALLOWED_ORIGINS.length ? ALLOWED_ORIGINS.includes(origin) : isExtension;
  if (allowed) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Vary", "Origin");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, X-Relevy-Install");
  }
}

function send(res, status, obj) {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(obj));
}

function readJson(req, maxBytes = 200_000) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on("data", (c) => {
      size += c.length;
      if (size > maxBytes) {
        const e = new Error("Request too large");
        e.status = 413;
        reject(e);
        req.destroy();
      } else chunks.push(c);
    });
    req.on("end", () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}"));
      } catch {
        const e = new Error("Body must be JSON");
        e.status = 400;
        reject(e);
      }
    });
    req.on("error", reject);
  });
}

async function runPool(jobs, size) {
  let i = 0;
  let firstError = null;
  const workers = Array.from({ length: Math.min(size, jobs.length) }, async () => {
    while (i < jobs.length) {
      const job = jobs[i++];
      try {
        await job();
      } catch (err) {
        firstError = firstError || err;
      }
    }
  });
  await Promise.all(workers);
  return firstError;
}

function loadEnvFile(url) {
  if (!existsSync(url)) return;
  for (const line of readFileSync(url, "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
}

function log(msg) {
  console.log(`[${new Date().toISOString()}] ${msg}`);
}
