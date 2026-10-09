/*
 * Relevy shared core. Loaded by content scripts, the background worker
 * (importScripts) and the settings page. No DOM or chrome.* usage here,
 * so it can also be unit-tested in Node.
 */
(function (root) {
  "use strict";

  const STRENGTHS = {
    show: [
      { id: "slight", label: "Slight", weight: 1 },
      { id: "normal", label: "Normal", weight: 2 },
      { id: "strong", label: "Strong", weight: 3 },
    ],
    hide: [
      { id: "slight", label: "Slight", weight: -2 },
      { id: "normal", label: "Normal", weight: -3 },
      { id: "strong", label: "Strong", weight: -5 },
    ],
  };

  // Score below which a post that matches none of your interests is hidden.
  const STRICTNESS = {
    relaxed: 0.05,
    balanced: 0.15,
    strict: 0.3,
  };
  const LIKE_THRESHOLD = 0.45; // highlight at or above this
  const HIDE_TOPIC_THRESHOLD = -0.2; // hidden for matching a "hide" topic
  const LEARNED_FACTOR = 0.04;
  const LEARNED_CAP = 0.35;

  const QUICK_TOPICS = [
    "programming", "science", "space", "climate", "health", "finance",
    "investing", "design", "gaming", "music", "sports", "football",
    "basketball", "elections", "crypto", "nft", "memes", "giveaway",
    "true crime", "real estate", "travel", "food", "fitness", "parenting",
    "history",
  ];

  const DEFAULT_SETTINGS = {
    interests: [], // [{ label, weight }]
    hides: [], // [{ label, weight }] weight is negative
    hiddenMode: "collapse", // "collapse" | "remove"
    highlight: true,
    showBadge: true,
    learnFromLinks: true,
    hideAds: true,
    strictness: "balanced",
    sites: { x: true, youtube: true, facebook: true },
    serverUrl: "http://localhost:8787",
  };

  const STOPWORDS = new Set((
    "about above after again against also although always among another " +
    "anyone anything around away back became because become been before " +
    "being below best better between both came come could does doing done " +
    "down during each either else even ever every first from further gets " +
    "getting give given goes going gonna good have here look looks looking having here hers herself " +
    "himself into itself just keep know last least less like likely made make " +
    "makes many maybe more most much must myself need never next none nothing " +
    "only other others ours ourselves over own people post posts really right " +
    "said same says should show since some something still such sure take than " +
    "that thats their theirs them themselves then there these they thing things " +
    "think this those though through thus today together told took toward " +
    "under until upon very views want wants watch well went were what when " +
    "where whether which while whom whose will with within without would yeah " +
    "year years your yours yourself yourselves http https www com video videos " +
    "hours minutes ago week weeks days month months follow followers reply " +
    "replies repost reposts likes share shared comment comments sponsored"
  ).split(/\s+/));

  function clamp(n, lo, hi) {
    return Math.max(lo, Math.min(hi, n));
  }

  function normalizeTopic(label) {
    return String(label || "").toLowerCase().replace(/\s+/g, " ").trim().slice(0, 40);
  }

  function mergeSettings(stored) {
    const s = Object.assign({}, DEFAULT_SETTINGS, stored || {});
    s.sites = Object.assign({}, DEFAULT_SETTINGS.sites, (stored && stored.sites) || {});
    s.interests = Array.isArray(s.interests) ? s.interests : [];
    s.hides = Array.isArray(s.hides) ? s.hides : [];
    return s;
  }

  function topicsOf(settings) {
    const all = settings.interests.concat(settings.hides).map((t) => normalizeTopic(t.label));
    return Array.from(new Set(all.filter(Boolean)));
  }

  // FNV-1a 32-bit, returned as hex. Good enough for cache keys.
  function hash(text) {
    let h = 0x811c9dc5;
    const s = String(text);
    for (let i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 0x01000193);
    }
    return (h >>> 0).toString(16).padStart(8, "0");
  }

  function tokenize(text) {
    const words = String(text || "")
      .toLowerCase()
      .replace(/https?:\/\/\S+/g, " ")
      .replace(/[@#]/g, " ")
      .match(/[\p{L}][\p{L}\p{N}'-]{2,}/gu) || [];
    const out = new Set();
    for (const raw of words) {
      const w = raw.replace(/'s$/, "").replace(/^[-']+|[-']+$/g, "");
      if (w.length < 4 || w.length > 24 || STOPWORDS.has(w)) continue;
      out.add(w);
      if (out.size >= 40) break;
    }
    return Array.from(out);
  }

  function learnedBoost(text, learned) {
    if (!learned) return 0;
    let sum = 0;
    for (const w of tokenize(text)) {
      if (learned[w]) sum += learned[w];
    }
    return clamp(sum * LEARNED_FACTOR, -LEARNED_CAP, LEARNED_CAP);
  }

  /*
   * probs: { [topic]: probability 0..1 } from Jev
   * returns { score, verdict: "hide" | "like" | "neutral", reason }
   */
  function evaluate(probs, settings, learned, text) {
    probs = probs || {};
    let pos = 0;
    let neg = 0;
    let topHide = null;
    let topHideValue = 0;

    for (const t of settings.interests) {
      const p = probs[normalizeTopic(t.label)];
      if (typeof p === "number") pos += t.weight * p;
    }
    for (const t of settings.hides) {
      const p = probs[normalizeTopic(t.label)];
      if (typeof p !== "number") continue;
      const v = Math.abs(t.weight) * p;
      neg += v;
      if (v > topHideValue) {
        topHideValue = v;
        topHide = t.label;
      }
    }

    const raw = (pos - neg) / 3;
    const score = Math.round(clamp(raw + learnedBoost(text, learned), -1, 1) * 100) / 100;
    const threshold = STRICTNESS[settings.strictness] ?? STRICTNESS.balanced;

    if (topHide && score <= HIDE_TOPIC_THRESHOLD) {
      return { score, verdict: "hide", reason: `about ${topHide}` };
    }
    if (settings.interests.length > 0 && score < threshold) {
      return { score, verdict: "hide", reason: "doesn't match your interests" };
    }
    if (score >= LIKE_THRESHOLD) {
      return { score, verdict: "like", reason: "matches your interests" };
    }
    return { score, verdict: "neutral", reason: "" };
  }

  // Apply a ▲ (+1) / ▼ (-1) / link-open (+0.3) signal to the learned word map.
  function applyFeedback(learned, text, amount) {
    const next = Object.assign({}, learned || {});
    for (const w of tokenize(text)) {
      const v = Math.round(((next[w] || 0) + amount) * 100) / 100;
      if (Math.abs(v) < 0.05) delete next[w];
      else next[w] = clamp(v, -10, 10);
    }
    // keep the 400 strongest words
    const entries = Object.entries(next);
    if (entries.length > 400) {
      entries.sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]));
      return Object.fromEntries(entries.slice(0, 400));
    }
    return next;
  }

  function formatScore(score) {
    const s = Number(score || 0).toFixed(2);
    return score > 0 ? `+${s}` : s;
  }

  const api = {
    STRENGTHS, STRICTNESS, QUICK_TOPICS, DEFAULT_SETTINGS, LIKE_THRESHOLD,
    normalizeTopic, mergeSettings, topicsOf, hash, tokenize, evaluate,
    applyFeedback, learnedBoost, formatScore,
  };

  root.RelevyCore = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof globalThis !== "undefined" ? globalThis : self);
