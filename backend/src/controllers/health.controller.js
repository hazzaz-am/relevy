import { config } from "../config/env.js";

export class HealthController {
  static getHealth(req, res) {
    res.status(200).json({
      ok: true,
      mode: config.DEMO ? "demo" : "live",
      model: config.DEMO ? "demo-keywords" : config.MODEL,
      provider: config.DEMO ? "demo" : (config.isOpenRouter ? "openrouter" : "typesafe"),
    });
  }
}
