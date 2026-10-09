import { createHash } from "node:crypto";
import { config } from "../config/env.js";
import { LruCache } from "../models/cache.model.js";
import { runPool } from "../utils/pool.js";
import { demoScorePost } from "./demo.service.js";
import { log } from "../utils/logger.js";

export class ScoringService {
  constructor(options = {}) {
    this.demo = options.demo !== undefined ? options.demo : config.DEMO;
    this.concurrency = options.concurrency || config.CONCURRENCY;
    this.cache = options.cache || new LruCache(50000);
    this.customScorer = options.scorer || null;
    this._scorerPromise = null;
  }

  async getScorer() {
    if (this.customScorer) return this.customScorer;
    if (this.demo) return demoScorePost;
    if (!this._scorerPromise) {
      this._scorerPromise = (async () => {
        const { createJevScorer } = await import("./jev.service.js");
        return createJevScorer({
          apiKey: config.API_KEY,
          model: config.MODEL,
          baseURL: config.BASE_URL,
          timeoutMs: config.TIMEOUT_MS,
          isOpenRouter: config.isOpenRouter,
        });
      })();
    }
    return this._scorerPromise;
  }

  hashText(text) {
    return createHash("sha1").update(text).digest("hex");
  }

  async scoreBatch({ posts, topics, defaultSite = "" }) {
    const scorer = await this.getScorer();
    const results = {};
    let backendCalls = 0;

    const jobs = posts.map((p) => async () => {
      const id = String(p.id || "").slice(0, 100);
      const text = String(p.text || "");
      if (!id || !text.trim()) return;

      const textHash = this.hashText(text);
      const out = {};
      const missing = [];

      for (const t of topics) {
        const hit = this.cache.get(`${textHash}|${t}`);
        if (hit === undefined) {
          missing.push(t);
        } else {
          out[t] = hit;
        }
      }

      if (missing.length) {
        backendCalls++;
        const site = String(p.site || defaultSite || "");
        const { probs } = await scorer({ text, site }, missing);
        for (const [t, v] of Object.entries(probs)) {
          this.cache.set(`${textHash}|${t}`, v);
          out[t] = v;
        }
      }

      results[id] = out;
    });

    const failure = await runPool(jobs, this.concurrency);
    // Partial success is fine: unscored posts are simply left untouched by extension.
    if (failure && Object.keys(results).length === 0) {
      throw failure;
    }

    log(
      `scored ${posts.length} posts x ${topics.length} topics (${backendCalls} ${
        this.demo ? "demo" : (config.isOpenRouter ? "OpenRouter" : "Jev")
      } calls)`
    );

    return {
      mode: this.demo ? "demo" : "live",
      results,
    };
  }
}

export const scoringService = new ScoringService();
