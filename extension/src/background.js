/*
 * Relevy background worker.
 * Content scripts ask for topic probabilities for posts. This worker
 * dedupes, caches per (post, topic), batches, and calls the Relevy server.
 * The Jev API key lives only on the server.
 */
importScripts("lib/scoring.js");
const { hash, mergeSettings } = self.RelevyCore;

const BATCH_WINDOW_MS = 120;
const MAX_POSTS_PER_REQUEST = 20;
const CACHE_LIMIT = 8000;
const REQUEST_TIMEOUT_MS = 20000;

/* ---------- install / action ---------- */

chrome.runtime.onInstalled.addListener(async (details) => {
  const { installId } = await chrome.storage.local.get("installId");
  if (!installId) await chrome.storage.local.set({ installId: crypto.randomUUID() });
  if (details.reason === "install") chrome.runtime.openOptionsPage();
});

chrome.action.onClicked.addListener(() => chrome.runtime.openOptionsPage());

/* ---------- cache: key `${postHash}|${topic}` -> probability ---------- */

let cache = null;
let saveTimer = null;

async function loadCache() {
  if (cache) return cache;
  const { probCache } = await chrome.storage.local.get("probCache");
  cache = new Map(Object.entries(probCache || {}));
  return cache;
}

function scheduleSave() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(async () => {
    // Map keeps insertion order, so the oldest entries go first.
    while (cache.size > CACHE_LIMIT) cache.delete(cache.keys().next().value);
    await chrome.storage.local.set({ probCache: Object.fromEntries(cache) });
  }, 2000);
}

/* ---------- batching queue ---------- */

// postHash -> { text, site, topics:Set, waiters:[{resolve,reject}] }
const queue = new Map();
let flushTimer = null;

function enqueue(postHash, text, site, topics) {
  return new Promise((resolve, reject) => {
    let item = queue.get(postHash);
    if (!item) {
      item = { text, site, topics: new Set(), waiters: [] };
      queue.set(postHash, item);
    }
    topics.forEach((t) => item.topics.add(t));
    item.waiters.push({ resolve, reject });
    if (queue.size >= MAX_POSTS_PER_REQUEST) flush();
    else if (!flushTimer) flushTimer = setTimeout(flush, BATCH_WINDOW_MS);
  });
}

async function getConfig() {
  const [{ settings }, { installId }] = await Promise.all([
    chrome.storage.sync.get("settings"),
    chrome.storage.local.get("installId"),
  ]);
  const s = mergeSettings(settings);
  return { serverUrl: s.serverUrl.replace(/\/+$/, ""), installId };
}

async function flush() {
  clearTimeout(flushTimer);
  flushTimer = null;
  if (queue.size === 0) return;

  const items = Array.from(queue.entries()).slice(0, MAX_POSTS_PER_REQUEST);
  items.forEach(([h]) => queue.delete(h));
  if (queue.size > 0) flushTimer = setTimeout(flush, 0);

  const topics = new Set();
  items.forEach(([, it]) => it.topics.forEach((t) => topics.add(t)));

  try {
    const { serverUrl, installId } = await getConfig();
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), REQUEST_TIMEOUT_MS);
    const res = await fetch(`${serverUrl}/v1/score`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Relevy-Install": installId || "" },
      body: JSON.stringify({
        posts: items.map(([h, it]) => ({ id: h, text: it.text, site: it.site })),
        topics: Array.from(topics),
      }),
      signal: ctrl.signal,
    }).finally(() => clearTimeout(timer));

    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(body.error || `Server returned ${res.status}`);

    const c = await loadCache();
    for (const [h, it] of items) {
      const probs = (body.results && body.results[h]) || {};
      for (const [topic, p] of Object.entries(probs)) c.set(`${h}|${topic}`, p);
      it.waiters.forEach((w) => w.resolve());
    }
    scheduleSave();
  } catch (err) {
    const message = err.name === "AbortError" ? "Server timed out" : err.message;
    items.forEach(([, it]) => it.waiters.forEach((w) => w.reject(new Error(message))));
  }
}

/* ---------- public: score ---------- */

async function score({ posts, topics, site }) {
  const c = await loadCache();
  const pending = [];

  for (const post of posts) {
    const h = hash(post.text);
    const missing = topics.filter((t) => !c.has(`${h}|${t}`));
    if (missing.length) pending.push(enqueue(h, post.text, site, missing));
  }
  await Promise.all(pending);

  const results = {};
  for (const post of posts) {
    const h = hash(post.text);
    results[post.id] = {};
    for (const t of topics) {
      const p = c.get(`${h}|${t}`);
      if (typeof p === "number") results[post.id][t] = p;
    }
  }
  return { results };
}

async function health() {
  const { serverUrl } = await getConfig();
  try {
    const res = await fetch(`${serverUrl}/health`, { cache: "no-store" });
    const body = await res.json();
    return { ok: res.ok, ...body, serverUrl };
  } catch (err) {
    return { ok: false, error: `Can't reach ${serverUrl}`, serverUrl };
  }
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  const handlers = {
    score: () => score(msg),
    health: () => health(),
    clearCache: async () => {
      cache = new Map();
      await chrome.storage.local.remove("probCache");
      return { ok: true };
    },
  };
  const fn = handlers[msg && msg.type];
  if (!fn) return false;
  fn()
    .then(sendResponse)
    .catch((err) => sendResponse({ error: err.message }));
  return true; // async response
});
