(function () {
  "use strict";
  const Core = globalThis.RelevyCore;
  const $ = (sel) => document.querySelector(sel);

  let settings = Core.mergeSettings();
  let learned = {};

  const STRICTNESS_HINTS = {
    relaxed: "Hides only posts that clearly have nothing to do with your interests.",
    balanced: "Hides posts that don't match your interests. A good default.",
    strict: "Shows only posts that strongly match your interests.",
  };

  /* ---------- storage ---------- */

  async function load() {
    const [{ settings: s }, { learned: l }] = await Promise.all([
      chrome.storage.sync.get("settings"),
      chrome.storage.local.get("learned"),
    ]);
    settings = Core.mergeSettings(s);
    learned = l || {};
    renderAll();
  }

  function save() {
    renderAll();
    return chrome.storage.sync.set({ settings });
  }

  chrome.storage.onChanged.addListener((changes) => {
    if (changes.learned) {
      learned = changes.learned.newValue || {};
      renderLearned();
    }
  });

  /* ---------- topics ---------- */

  function findTopic(label) {
    const key = Core.normalizeTopic(label);
    const i = settings.interests.findIndex((t) => Core.normalizeTopic(t.label) === key);
    if (i >= 0) return { list: "interests", index: i };
    const h = settings.hides.findIndex((t) => Core.normalizeTopic(t.label) === key);
    if (h >= 0) return { list: "hides", index: h };
    return null;
  }

  function removeTopic(label) {
    const found = findTopic(label);
    if (found) settings[found.list].splice(found.index, 1);
  }

  function addTopic(kind, label, weight) {
    const clean = Core.normalizeTopic(label);
    if (!clean) return;
    removeTopic(clean); // a topic lives in one list only
    settings[kind === "show" ? "interests" : "hides"].push({ label: clean, weight });
    save();
  }

  function renderQuick() {
    const box = $("#quick-topics");
    box.replaceChildren();
    for (const label of Core.QUICK_TOPICS) {
      const found = findTopic(label);
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "chip" + (found ? (found.list === "interests" ? " interest" : " hide") : "");
      btn.textContent = label;
      btn.setAttribute("aria-pressed", String(!!found));
      btn.title = found
        ? found.list === "interests" ? "Marked as interest. Click to clear." : "Marked as not interested. Click to clear."
        : "Click for interest, Shift-click for not interested";
      btn.addEventListener("click", (ev) => {
        const wasList = found && found.list;
        removeTopic(label);
        if (ev.shiftKey) {
          if (wasList !== "hides") settings.hides.push({ label, weight: -3 });
        } else if (!wasList) {
          settings.interests.push({ label, weight: 2 });
        }
        save();
      });
      box.append(btn);
    }
  }

  function topicChip(topic, kind) {
    const chip = document.createElement("span");
    chip.className = `chip ${kind === "show" ? "interest" : "hide"}`;
    const w = topic.weight > 0 ? `+${topic.weight}` : `−${Math.abs(topic.weight)}`;
    chip.innerHTML = `<span class="label"></span><span class="weight">${w}</span>` +
      `<button type="button" class="remove" aria-label="Remove">×</button>`;
    chip.querySelector(".label").textContent = topic.label;
    chip.querySelector(".remove").setAttribute("aria-label", `Remove ${topic.label}`);
    chip.querySelector(".remove").addEventListener("click", () => {
      removeTopic(topic.label);
      save();
    });
    return chip;
  }

  function renderLists() {
    const show = $("#list-show");
    const hide = $("#list-hide");
    show.replaceChildren(...settings.interests.map((t) => topicChip(t, "show")));
    hide.replaceChildren(...settings.hides.map((t) => topicChip(t, "hide")));
    if (!settings.interests.length) show.innerHTML = '<span class="empty">Add a topic, or tap one above.</span>';
    if (!settings.hides.length) hide.innerHTML = '<span class="empty">Nothing hidden by topic yet.</span>';
  }

  function fillStrengths() {
    for (const kind of ["show", "hide"]) {
      const sel = $(`#strength-${kind}`);
      for (const s of Core.STRENGTHS[kind]) {
        const o = document.createElement("option");
        o.value = String(s.weight);
        o.textContent = s.label;
        if (s.id === "normal") o.selected = true;
        sel.append(o);
      }
      $(`#form-${kind}`).addEventListener("submit", (ev) => {
        ev.preventDefault();
        const input = $(`#input-${kind}`);
        // Allow "rust, climate tech" to add two topics at once.
        input.value.split(",").forEach((part) => addTopic(kind, part, Number(sel.value)));
        input.value = "";
        input.focus();
      });
    }
  }

  /* ---------- learned ---------- */

  function renderLearned() {
    const entries = Object.entries(learned).filter(([, v]) => Math.abs(v) >= 0.9);
    const up = entries.filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]).slice(0, 18);
    const down = entries.filter(([, v]) => v < 0).sort((a, b) => a[1] - b[1]).slice(0, 18);
    fillLearned($("#learned-up"), up, "interest");
    fillLearned($("#learned-down"), down, "hide");
  }

  function fillLearned(box, items, cls) {
    box.replaceChildren();
    if (!items.length) {
      box.innerHTML = '<span class="empty">Nothing yet</span>';
      return;
    }
    for (const [word] of items) {
      const chip = document.createElement("span");
      chip.className = `chip ${cls}`;
      chip.innerHTML = '<span class="label"></span><button type="button" class="remove">×</button>';
      chip.querySelector(".label").textContent = word;
      chip.querySelector(".remove").setAttribute("aria-label", `Forget ${word}`);
      chip.querySelector(".remove").addEventListener("click", () => {
        const next = Object.assign({}, learned);
        delete next[word];
        chrome.storage.local.set({ learned: next });
      });
      box.append(chip);
    }
  }

  $("#forget").addEventListener("click", async () => {
    if (!confirm("Forget everything Jev learned from your ▲ / ▼ clicks?")) return;
    await chrome.storage.local.set({ learned: {}, overrides: {} });
  });

  /* ---------- behavior ---------- */

  function renderBehavior() {
    document.querySelectorAll(".segmented").forEach((group) => {
      const key = group.dataset.setting;
      group.querySelectorAll("button").forEach((b) => {
        b.setAttribute("aria-checked", String(settings[key] === b.dataset.value));
      });
    });
    $("#strictness-hint").textContent = STRICTNESS_HINTS[settings.strictness] || "";
    document.querySelectorAll("input[data-setting]").forEach((i) => (i.checked = !!settings[i.dataset.setting]));
    document.querySelectorAll("input[data-site]").forEach((i) => (i.checked = settings.sites[i.dataset.site] !== false));
  }

  document.querySelectorAll(".segmented").forEach((group) => {
    group.addEventListener("click", (ev) => {
      const b = ev.target.closest("button[data-value]");
      if (!b) return;
      settings[group.dataset.setting] = b.dataset.value;
      save();
    });
  });
  document.querySelectorAll("input[data-setting]").forEach((i) =>
    i.addEventListener("change", () => {
      settings[i.dataset.setting] = i.checked;
      save();
    })
  );
  document.querySelectorAll("input[data-site]").forEach((i) =>
    i.addEventListener("change", () => {
      settings.sites = Object.assign({}, settings.sites, { [i.dataset.site]: i.checked });
      save();
    })
  );

  /* ---------- try a post ---------- */

  $("#try-run").addEventListener("click", async () => {
    const out = $("#try-result");
    const text = $("#try-text").value.trim() || $("#try-text").placeholder;
    const topics = Core.topicsOf(settings);
    if (!topics.length) {
      out.textContent = "Add at least one topic first.";
      return;
    }
    out.textContent = "Scoring…";
    const res = await chrome.runtime.sendMessage({ type: "score", site: "test", topics, posts: [{ id: "try", text }] });
    if (!res || res.error) {
      out.textContent = `Couldn't score it: ${(res && res.error) || "no response"}`;
      return;
    }
    const v = Core.evaluate(res.results.try, settings, learned, text);
    const verdict = v.verdict === "hide" ? `Hidden: ${v.reason}` : v.verdict === "like" ? "Highlighted" : "Shown";
    out.innerHTML = `<span class="score"></span><span class="${v.verdict}"></span>`;
    out.querySelector(".score").textContent = `Jev ${Core.formatScore(v.score)}`;
    out.querySelector(`.${v.verdict}`).textContent = verdict;
  });

  /* ---------- server ---------- */

  async function checkServer() {
    const status = $("#server-status");
    const banner = $("#server-banner");
    status.className = "status";
    status.textContent = "Checking…";
    const h = await chrome.runtime.sendMessage({ type: "health" });
    if (h && h.ok) {
      status.className = "status ok";
      status.textContent = h.mode === "demo"
        ? `Connected to ${h.serverUrl} in demo mode (keyword guesses, not Jev).`
        : `Connected to ${h.serverUrl}. Scoring with ${h.model}.`;
      banner.hidden = h.mode !== "demo";
      banner.className = "banner";
      banner.textContent = "Demo mode: posts are scored with simple keyword matching. Add a Jev API key to the server's .env to use the real model.";
    } else {
      status.className = "status bad";
      status.textContent = `${(h && h.error) || "Server unavailable"}. Posts are left untouched until it's back.`;
      banner.hidden = false;
      banner.className = "banner error";
      banner.textContent = "Relevy can't reach its server, so nothing is being filtered. Check the Server section below.";
    }
  }

  $("#form-server").addEventListener("submit", async (ev) => {
    ev.preventDefault();
    settings.serverUrl = $("#server-url").value.trim().replace(/\/+$/, "");
    await save();
    checkServer();
  });

  $("#clear-cache").addEventListener("click", async () => {
    await chrome.runtime.sendMessage({ type: "clearCache" });
    $("#server-status").textContent = "Saved scores cleared. Posts will be rescored as you scroll.";
  });

  /* ---------- render ---------- */

  function renderAll() {
    renderQuick();
    renderLists();
    renderLearned();
    renderBehavior();
    $("#server-url").value = settings.serverUrl;
  }

  fillStrengths();
  load().then(checkServer);
})();
