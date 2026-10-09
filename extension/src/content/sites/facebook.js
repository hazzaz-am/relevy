/*
 * Relevy adapter for Facebook.
 * Facebook scrambles its CSS class names, so this relies only on ARIA roles,
 * aria-posinset and data-* attributes. Expect to revisit it when FB ships
 * layout changes.
 */
(function () {
  "use strict";

  const MESSAGE_SELECTORS = [
    '[data-ad-rendering-role="story_message"]',
    '[data-ad-preview="message"]',
    '[data-ad-comet-preview="message"]',
  ].join(",");

  const PERMALINK = /\/(posts|videos|reel|photos|permalink\.php|story\.php|groups\/[^/]+\/posts)\b|story_fbid=|fbid=/;
  const UI_WORDS = /^(like|comment|share|send|follow|reply|see more|see translation|all reactions:?|most relevant|write a comment.*|\d+[km]?( comments?| shares?)?)$/i;

  function isFeedPath() {
    return !/^\/(messages|marketplace|settings|notifications|events|gaming|watch\/live)/.test(location.pathname);
  }

  function cleanText(raw) {
    return String(raw || "")
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => l && !UI_WORDS.test(l))
      .join("\n");
  }

  Relevy.start({
    site: "facebook",

    shouldRun: isFeedPath,

    findPosts() {
      const found = new Set();
      document.querySelectorAll('[role="feed"] > div').forEach((el) => found.add(el));
      document.querySelectorAll("div[aria-posinset]").forEach((el) => {
        if (!el.closest('[role="feed"] > div')) found.add(el);
      });
      // Skip spacer / loading placeholders.
      return Array.from(found).filter((el) => el.querySelector('[role="article"], a[role="link"], h2, h3, h4'));
    },

    container(el) {
      return el;
    },

    id(el, text) {
      for (const a of el.querySelectorAll("a[href]")) {
        const href = a.getAttribute("href");
        if (PERMALINK.test(href)) return `fb:${href.split(/[?#]/)[0]}${(href.match(/(story_)?fbid=\d+/) || [""])[0]}`;
      }
      return ""; // core falls back to a hash of the text
    },

    text(el) {
      const author = el.querySelector("h2, h3, h4, strong");
      const messages = Array.from(el.querySelectorAll(MESSAGE_SELECTORS)).map((n) => n.innerText);
      let body = messages.join("\n");
      if (!body) body = cleanText(el.innerText).slice(0, 1200); // shared links, photos, reels
      return [author && author.innerText.trim(), body].filter(Boolean).join("\n");
    },

    isAd(el) {
      if (el.querySelector('a[href*="/ads/about"], a[aria-label="Sponsored"], [aria-label="Sponsored"]')) return true;
      // FB splits "Sponsored" into scrambled letters; check the header text only.
      const header = el.querySelector("h2, h3, h4");
      const scope = header ? header.parentElement.parentElement || header : el;
      return /\bSponsored\b/.test(scope.innerText || "");
    },
  });
})();
