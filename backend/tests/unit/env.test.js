import { describe, it, expect } from "vitest";
import { config, resolveProvider } from "../../src/config/env.js";

describe("env configuration", () => {
  it("should export an immutable config object", () => {
    expect(config).toBeDefined();
    expect(Object.isFrozen(config)).toBe(true);
    expect(Object.isFrozen(config.LIMITS)).toBe(true);
    expect(Object.isFrozen(config.ALLOWED_ORIGINS)).toBe(true);
  });

  describe("resolveProvider", () => {
    it("should resolve demo mode when keys are empty or set to demo", () => {
      const result = resolveProvider({
        OPENROUTER_API_KEY: "",
        TYPESAFE_API_KEY: "demo",
        TYPESAFE_BASE_URL: "",
        TYPESAFE_API_URL: "",
        OPENROUTER_BASE_URL: "",
        JEV_MODEL: "",
        TYPESAFE_MODEL: "",
      });

      expect(result.demo).toBe(true);
      expect(result.apiKey).toBe("demo");
      expect(result.model).toBe("jev-latest");
    });

    it("should identify OpenRouter keys and set default OpenRouter base URL", () => {
      const result = resolveProvider({
        OPENROUTER_API_KEY: "sk-or-v1-abc123xyz",
        TYPESAFE_API_KEY: "",
        TYPESAFE_BASE_URL: "",
        TYPESAFE_API_URL: "",
        OPENROUTER_BASE_URL: "",
        JEV_MODEL: "anthropic/claude-3-opus",
        TYPESAFE_MODEL: "",
      });

      expect(result.demo).toBe(false);
      expect(result.isOpenRouter).toBe(true);
      expect(result.apiKey).toBe("sk-or-v1-abc123xyz");
      expect(result.baseUrl).toBe("https://openrouter.ai/api");
      expect(result.model).toBe("anthropic/claude-3-opus");
    });

    it("should normalize base URLs by removing trailing slashes and redundant /v1 suffixes", () => {
      const result = resolveProvider({
        OPENROUTER_API_KEY: "",
        TYPESAFE_API_KEY: "ts-key-123",
        TYPESAFE_BASE_URL: "https://custom-gateway.io/v1/systemone///",
        TYPESAFE_API_URL: "",
        OPENROUTER_BASE_URL: "",
        JEV_MODEL: "jev-1.12.0",
        TYPESAFE_MODEL: "",
      });

      expect(result.demo).toBe(false);
      expect(result.isOpenRouter).toBe(false);
      expect(result.baseUrl).toBe("https://custom-gateway.io");
      expect(result.model).toBe("jev-1.12.0");
    });
  });
});
