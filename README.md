# Relevy

A Chrome extension that uses Jev (TypeSafe AI) to hide irrelevant posts on X, YouTube and Facebook, highlight the ones you care about, and learn from your ▲ / ▼ clicks.

```
extension/            Chrome extension (Manifest V3, plain JavaScript)
  src/lib/scoring.js    shared scoring rules, used everywhere
  src/background.js     batching, caching, calls the server
  src/content/core.js   finds posts, collapses/highlights, ▲ / ▼
  src/content/sites/    one adapter per site: x.js, youtube.js, facebook.js
  src/options/          settings page
backend/              Node server that holds the Jev API key
```

## Run it (demo mode, no API key needed)

1. Start the server (Node 20+):
   ```
   cd backend
   npm install
   npm start
   ```
   With no `.env` it runs in demo mode: posts are scored by keyword matching, so you can build and test everything offline.

2. Load the extension: open `chrome://extensions`, turn on Developer mode, click **Load unpacked**, pick the `extension` folder. The settings page opens.

3. Tap a few topics, then open x.com, youtube.com or facebook.com.

## Switch to real Jev

1. Get a key from the TypeSafe console.
2. In `backend/`, copy `.env.example` to `.env` and set `TYPESAFE_API_KEY=your-key`.
3. Restart the server. The settings page should say "Scoring with jev-latest".
4. Once results look right, pin a version (`JEV_MODEL=jev-1.13.0` or whatever is current). `jev-latest` changes with every release, which shifts scores.

You can also route through OpenRouter by setting `TYPESAFE_BASE_URL=https://openrouter.ai/api` and using your OpenRouter key.

## How scoring works

For each post the server sends Jev one request with a yes/no question per topic ("Is this post mainly about ai?"). Jev returns a probability for each. The extension then combines them:

- score = (sum of interest weight × probability − sum of hide weight × probability) / 3, plus a small nudge from learned words
- a hide topic pushing the score to −0.2 or lower hides the post ("about politics")
- otherwise, if you have interests and the score is under the strictness line (0.05 / 0.15 / 0.3), it's hidden ("doesn't match your interests")
- 0.45 or higher gets the accent bar
- ▲ / ▼ always win for that post, and also teach word weights stored locally

Scores are cached per post and topic in the extension and on the server, so changing a weight never costs an API call, and a viral post is only sent to Jev once for all your users. If the server is down, nothing is hidden.

## Before publishing to the Chrome Web Store

- **Host the backend** (the Dockerfile works on Fly, Railway, Render or a VPS) behind HTTPS.
- **Point the extension at it**: replace `https://api.relevy.example/*` in `manifest.json` `host_permissions` with your domain, and change `serverUrl` in `src/lib/scoring.js` `DEFAULT_SETTINGS`.
- **Lock CORS**: set `ALLOWED_ORIGINS=chrome-extension://<your-extension-id>` in the server `.env`.
- **Add real auth and billing**. Right now anyone who finds your server URL can use your Jev credits; the per-install rate limit only slows them down.
- **Write a privacy policy**. The store requires one because post text leaves the browser. Say what's sent (post text, a random install ID), that nothing is stored beyond an in-memory cache, and that it goes to TypeSafe for scoring.
- **Expect selector breakage**. Facebook especially changes its markup often; each site's selectors live in one file under `src/content/sites/`.
