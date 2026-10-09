import app from "./app.js";
import { config } from "./config/env.js";
import { log } from "./utils/logger.js";

const server = app.listen(config.PORT, () => {
  const provider = config.DEMO
    ? "DEMO mode: keyword guesses, no API calls"
    : config.isOpenRouter
      ? `live via OpenRouter, model ${config.MODEL}`
      : `live Jev, model ${config.MODEL}`;

  log(`Relevy server listening on http://localhost:${config.PORT} (${provider})`);
});

export default server;
