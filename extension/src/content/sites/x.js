/* Relevy adapter for X / Twitter. */
(function () {
  "use strict";

  const SKIP_PATHS = /^\/(messages|settings|compose|i\/(flow|verified|premium))|\/status\/\d+/;

  Relevy.start({
    site: "x",

    // Filter timelines, not conversation threads or settings screens.
    shouldRun() {
      return !SKIP_PATHS.test(location.pathname);
    },

    findPosts() {
      return document.querySelectorAll('article[data-testid="tweet"]');
    },

    container(el) {
      return el.closest('[data-testid="cellInnerDiv"]') || el;
    },

    id(el) {
      const time = el.querySelector('a[href*="/status/"] time');
      const href = time && time.closest("a").getAttribute("href");
      const m = href && href.match(/\/status\/(\d+)/);
      return m ? `x:${m[1]}` : "";
    },

    text(el) {
      const parts = [];
      const name = el.querySelector('[data-testid="User-Name"]');
      if (name) parts.push(name.innerText.split("\n")[0]);
      el.querySelectorAll('[data-testid="tweetText"]').forEach((n) => parts.push(n.innerText));
      const card = el.querySelector('[data-testid="card.wrapper"]');
      if (card) parts.push(card.innerText);
      // Image-only posts: fall back to image descriptions.
      if (parts.length <= 1) {
        el.querySelectorAll('[data-testid="tweetPhoto"] img[alt]').forEach((img) => {
          if (img.alt && img.alt !== "Image") parts.push(img.alt);
        });
      }
      return parts.join("\n");
    },

    isAd(el) {
      // The "Ad" / "Promoted" label sits in the post header as its own span.
      // (placementTracking is NOT used: X also puts it on ordinary video posts.)
      for (const span of el.querySelectorAll("span")) {
        const t = span.textContent.trim();
        if ((t === "Ad" || t === "Promoted") && span.children.length === 0 &&
            !span.closest('[data-testid="tweetText"]')) return true;
      }
      return false;
    },
  });
})();
