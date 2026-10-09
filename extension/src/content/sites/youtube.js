/* Relevy adapter for YouTube (home, subscriptions, search, watch sidebar). */
(function () {
  "use strict";

  const ITEMS = [
    "ytd-rich-item-renderer",
    "ytd-video-renderer",
    "ytd-grid-video-renderer",
    "ytd-compact-video-renderer",
    "ytd-reel-item-renderer",
    "ytm-shorts-lockup-view-model",
  ].join(",");
  // Newer layout: yt-lockup-view-model, sometimes standalone in the sidebar.
  const LOCKUP = "yt-lockup-view-model";

  const AD_SELECTORS = [
    "ytd-ad-slot-renderer",
    "ytd-in-feed-ad-layout-renderer",
    "ytd-promoted-sparkles-web-renderer",
    "ytd-promoted-video-renderer",
    "ytd-display-ad-renderer",
    "ytd-search-pyv-renderer",
    "[class*='badge-style-type-ad']",
    "feed-ad-metadata-view-model",
  ].join(",");

  const adIds = new WeakMap();
  let adCounter = 0;

  function firstText(el, selector) {
    const n = el.querySelector(selector);
    return n ? (n.getAttribute("title") || n.textContent || "").trim() : "";
  }

  Relevy.start({
    site: "youtube",

    shouldRun() {
      return !/^\/(playlist|feed\/(history|library|playlists)|account)/.test(location.pathname);
    },

    findPosts() {
      const found = Array.from(document.querySelectorAll(ITEMS));
      document.querySelectorAll(LOCKUP).forEach((el) => {
        if (!el.closest(ITEMS)) found.push(el);
      });
      // Standalone ad slots outside a rich item (search results, sidebar).
      document.querySelectorAll("ytd-ad-slot-renderer").forEach((el) => {
        if (!el.closest(ITEMS)) found.push(el);
      });
      return found;
    },

    container(el) {
      return el;
    },

    id(el) {
      if (this.isAd(el)) {
        if (!adIds.has(el)) adIds.set(el, `yt-ad:${++adCounter}`);
        return adIds.get(el);
      }
      const link = el.querySelector('a[href*="watch?v="], a[href^="/shorts/"]');
      const href = link && link.getAttribute("href");
      if (!href) return "";
      const v = href.match(/[?&]v=([\w-]{6,})/) || href.match(/\/shorts\/([\w-]{6,})/);
      return v ? `yt:${v[1]}` : "";
    },

    text(el) {
      const title =
        firstText(el, "#video-title") ||
        firstText(el, ".yt-lockup-metadata-view-model__title") ||
        firstText(el, "h3");
      const channel =
        firstText(el, "ytd-channel-name #text") ||
        firstText(el, "#channel-name #text") ||
        firstText(el, ".yt-content-metadata-view-model__metadata-text");
      if (!title) return "";
      return channel ? `${title}\nChannel: ${channel}` : title;
    },

    isAd(el) {
      return el.matches(AD_SELECTORS) || !!el.querySelector(AD_SELECTORS);
    },
  });
})();
