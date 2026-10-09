/*
 * Relevy content engine. Each site file calls Relevy.start(adapter).
 *
 * adapter = {
 *   site: "x" | "youtube" | "facebook",
 *   shouldRun(): boolean            // is this page a feed worth filtering?
 *   findPosts(): Element[]          // post elements currently in the DOM
 *   container(el): Element          // element to collapse / highlight
 *   id(el, text): string            // stable id for the post
 *   text(el): string                // text sent to Jev ("" = not loaded yet)
 *   isAd(el): boolean
 * }
 */
(function () {
  "use strict";
  const Core = globalThis.RelevyCore;
  const RETRY_AFTER_MS = 30000;
  const OVERRIDE_LIMIT = 2000;

  function start(adapter) {
    let settings = Core.mergeSettings();
    let learned = {};
    let overrides = {}; // postId -> "up" | "down"
    const revealed = new Set(); // "Show" clicked this session
    const posts = new Map(); // id -> entry
    const containerIds = new WeakMap(); // container -> id currently rendered in it
    let scanTimer = null;
    let inflight = false;

    /* ---------- storage ---------- */

    async function loadState() {
      const [{ settings: s }, local] = await Promise.all([
        chrome.storage.sync.get("settings"),
        chrome.storage.local.get(["learned", "overrides"]),
      ]);
      settings = Core.mergeSettings(s);
      learned = local.learned || {};
      overrides = local.overrides || {};
    }

    chrome.storage.onChanged.addListener((changes) => {
      if (changes.settings) settings = Core.mergeSettings(changes.settings.newValue);
      if (changes.learned) learned = changes.learned.newValue || {};
      if (changes.overrides) overrides = changes.overrides.newValue || {};
      renderAll();
      requestScores();
    });

    function enabled() {
      return settings.sites[adapter.site] !== false && adapter.shouldRun();
    }

    /* ---------- scanning ---------- */

    function scheduleScan() {
      if (scanTimer) return;
      scanTimer = setTimeout(() => {
        scanTimer = null;
        scan();
      }, 150);
    }

    function scan() {
      if (!enabled()) {
        posts.forEach((entry) => clear(entry.container));
        return;
      }
      for (const el of adapter.findPosts()) {
        const container = adapter.container(el) || el;
        const ad = adapter.isAd(el);
        const text = normalizeText(adapter.text(el));
        if (!ad && text.length < 3) continue; // not rendered yet, try next scan

        const id = adapter.id(el, text) || `h:${Core.hash(text)}`;
        if (containerIds.get(container) === id && posts.has(id)) continue;

        // The site recycled this element for a different post.
        if (containerIds.has(container)) clear(container);
        containerIds.set(container, id);

        const prev = posts.get(id);
        posts.set(id, {
          id, el, container, text, ad,
          probs: prev ? prev.probs : null,
          failedAt: 0,
        });
        render(posts.get(id));
      }
      // forget entries whose element left the page
      for (const [id, entry] of posts) {
        if (!entry.container.isConnected) posts.delete(id);
      }
      requestScores();
    }

    function normalizeText(t) {
      return String(t || "").replace(/\s+/g, " ").trim().slice(0, 1500);
    }

    /* ---------- scoring ---------- */

    function needsScores(entry, topics) {
      if (entry.ad && settings.hideAds) return false;
      if (!entry.text) return false;
      if (entry.failedAt && Date.now() - entry.failedAt < RETRY_AFTER_MS) return false;
      return !entry.probs || topics.some((t) => !(t in entry.probs));
    }

    async function requestScores() {
      if (inflight || !enabled()) return;
      const topics = Core.topicsOf(settings);
      if (topics.length === 0) return;

      const batch = Array.from(posts.values()).filter((e) => needsScores(e, topics)).slice(0, 40);
      if (batch.length === 0) return;

      inflight = true;
      try {
        const res = await chrome.runtime.sendMessage({
          type: "score",
          site: adapter.site,
          topics,
          posts: batch.map((e) => ({ id: e.id, text: e.text })),
        });
        if (!res || res.error) throw new Error((res && res.error) || "No response");
        for (const e of batch) {
          e.probs = Object.assign({}, e.probs, res.results[e.id]);
          render(e);
        }
      } catch (err) {
        // Fail open: never hide posts because the server is down.
        batch.forEach((e) => (e.failedAt = Date.now()));
        console.debug("[Relevy]", err.message);
      } finally {
        inflight = false;
      }
      // more may have arrived while we waited
      if (Array.from(posts.values()).some((e) => needsScores(e, topics))) setTimeout(requestScores, 50);
    }

    /* ---------- rendering ---------- */

    function verdictFor(entry) {
      const o = overrides[entry.id];
      if (entry.ad && settings.hideAds) {
        return { score: -1, verdict: "hide", reason: "sponsored post", ad: true };
      }
      if (!entry.probs && !o) return null; // unscored: leave untouched
      const result = Core.evaluate(entry.probs, settings, learned, entry.text);
      if (o === "up") return { ...result, verdict: "like", reason: "you marked this ▲" };
      if (o === "down") return { ...result, verdict: "hide", reason: "you marked this ▼" };
      return result;
    }

    function clear(container) {
      container.classList.remove("relevy-post", "relevy-collapsed", "relevy-removed", "relevy-liked");
      container.querySelectorAll(":scope > .relevy-bar, :scope > .relevy-badge").forEach((n) => n.remove());
    }

    function renderAll() {
      if (!enabled()) {
        posts.forEach((e) => clear(e.container));
        return;
      }
      posts.forEach(render);
    }

    function render(entry) {
      const c = entry.container;
      if (containerIds.get(c) !== entry.id) return;
      const v = verdictFor(entry);
      if (!v) {
        clear(c); // e.g. an ad after "Always hide ads" was switched off
        return;
      }

      c.classList.add("relevy-post");
      const hide = v.verdict === "hide" && !revealed.has(entry.id);
      c.classList.toggle("relevy-collapsed", hide && settings.hiddenMode === "collapse");
      c.classList.toggle("relevy-removed", hide && settings.hiddenMode === "remove");
      c.classList.toggle("relevy-liked", settings.highlight && v.verdict === "like" && !hide);

      ensureBar(entry).querySelector(".relevy-reason").textContent = v.reason;
      if (!v.ad && settings.showBadge) updateBadge(entry, v);
      else c.querySelector(":scope > .relevy-badge")?.remove();
    }

    function ensureBar(entry) {
      let bar = entry.container.querySelector(":scope > .relevy-bar");
      if (bar) return bar;
      bar = document.createElement("div");
      bar.className = "relevy-bar";
      bar.innerHTML =
        '<span class="relevy-bar-label">Hidden by Jev</span>' +
        '<span class="relevy-reason"></span>' +
        '<button type="button" class="relevy-show">Show</button>';
      bar.querySelector(".relevy-show").addEventListener("click", (ev) => {
        stop(ev);
        revealed.add(containerIds.get(entry.container));
        renderAll();
      });
      bar.addEventListener("click", stop);
      entry.container.prepend(bar);
      return bar;
    }

    function updateBadge(entry, v) {
      let badge = entry.container.querySelector(":scope > .relevy-badge");
      if (!badge) {
        badge = document.createElement("div");
        badge.className = "relevy-badge";
        badge.innerHTML =
          '<span class="relevy-score"></span>' +
          '<button type="button" class="relevy-up" aria-label="More like this" title="More like this">▲</button>' +
          '<button type="button" class="relevy-down" aria-label="Less like this" title="Less like this">▼</button>';
        badge.querySelector(".relevy-up").addEventListener("click", (ev) => feedback(ev, entry.container, "up"));
        badge.querySelector(".relevy-down").addEventListener("click", (ev) => feedback(ev, entry.container, "down"));
        badge.addEventListener("click", stop);
        entry.container.append(badge);
      }
      badge.querySelector(".relevy-score").textContent = `Jev ${Core.formatScore(v.score)}`;
      const o = overrides[entry.id];
      badge.querySelector(".relevy-up").classList.toggle("relevy-on", o === "up");
      badge.querySelector(".relevy-down").classList.toggle("relevy-on", o === "down");
    }

    function stop(ev) {
      ev.preventDefault();
      ev.stopPropagation();
    }

    /* ---------- feedback / learning ---------- */

    async function feedback(ev, container, dir) {
      stop(ev);
      const entry = posts.get(containerIds.get(container));
      if (!entry) return;
      const undo = overrides[entry.id] === dir;
      const nextOverrides = Object.assign({}, overrides);
      if (undo) delete nextOverrides[entry.id];
      else nextOverrides[entry.id] = dir;
      trimOverrides(nextOverrides);

      const amount = (dir === "up" ? 1 : -1) * (undo ? -1 : 1);
      const nextLearned = Core.applyFeedback(learned, entry.text, amount);
      // ▼ should hide the post right away, even if "Show" was clicked earlier.
      if (dir === "down" && !undo) revealed.delete(entry.id);

      overrides = nextOverrides;
      learned = nextLearned;
      render(entry);
      await chrome.storage.local.set({ overrides: nextOverrides, learned: nextLearned });
    }

    function trimOverrides(o) {
      const keys = Object.keys(o);
      for (let i = 0; i < keys.length - OVERRIDE_LIMIT; i++) delete o[keys[i]];
    }

    // Opening a link inside a post counts as a small ▲.
    document.addEventListener(
      "click",
      (ev) => {
        if (!settings.learnFromLinks || !enabled()) return;
        const link = ev.target.closest && ev.target.closest("a[href]");
        const container = link && link.closest(".relevy-post");
        if (!container || link.closest(".relevy-badge, .relevy-bar")) return;
        const entry = posts.get(containerIds.get(container));
        if (!entry || !entry.text) return;
        learned = Core.applyFeedback(learned, entry.text, 0.3);
        chrome.storage.local.set({ learned });
      },
      true
    );

    /* ---------- boot ---------- */

    document.documentElement.classList.add(`relevy-site-${adapter.site}`);
    loadState().then(() => {
      new MutationObserver(scheduleScan).observe(document.documentElement, {
        childList: true,
        subtree: true,
      });
      scan();
    });
  }

  globalThis.Relevy = { start };
})();
