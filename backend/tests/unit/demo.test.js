import { describe, it, expect } from "vitest";
import { demoScorePost } from "../../src/services/demo.service.js";

describe("demoScorePost", () => {
  it("should give high probability when keywords match topic", () => {
    const post = { text: "We just launched our new artificial intelligence and machine learning agent!" };
    const topics = ["ai", "crypto"];
    const result = demoScorePost(post, topics);

    expect(result.probs.ai).toBeGreaterThan(0.7);
    expect(result.probs.crypto).toBe(0.04);
  });

  it("should handle custom topics with fuzzy keyword extraction", () => {
    const post = { text: "A comprehensive guide to backend architecture and microservices" };
    const topics = ["architecture"];
    const result = demoScorePost(post, topics);

    expect(result.probs.architecture).toBeGreaterThan(0.5);
  });

  it("should return zero token usage", () => {
    const post = { text: "Some random text" };
    const result = demoScorePost(post, ["sports"]);
    expect(result.usage).toEqual({ input_tokens: 0, output_tokens: 0 });
  });
});
