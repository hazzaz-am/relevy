import { describe, it, expect } from "vitest";
import request from "supertest";
import app from "../../src/app.js";

describe("POST /v1/score", () => {
  it("should score posts against topics successfully", async () => {
    const payload = {
      posts: [
        { id: "post-1", text: "Building an awesome AI agent with Claude and Gemini", site: "x" },
        { id: "post-2", text: "Premier league live match highlights and scores", site: "x" },
      ],
      topics: ["ai", "football"],
    };

    const res = await request(app)
      .post("/v1/score")
      .set("X-Relevy-Install", "test-client-1")
      .send(payload);

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("mode");
    expect(res.body).toHaveProperty("results");
    expect(res.body.results["post-1"]).toBeDefined();
    expect(res.body.results["post-2"]).toBeDefined();
    expect(res.body.results["post-1"].ai).toBeGreaterThan(0.5);
  });

  it("should reject empty posts or empty topics with 400", async () => {
    const res = await request(app)
      .post("/v1/score")
      .send({ posts: [], topics: ["ai"] });

    expect(res.status).toBe(400);
    expect(res.body.error).toContain("Send at least one post and one topic.");
  });

  it("should return 404 on invalid route", async () => {
    const res = await request(app).get("/non-existent-route");
    expect(res.status).toBe(404);
    expect(res.body.error).toBe("Not found");
  });

  it("should support Chrome extension CORS origins", async () => {
    const fakeExtId = "chrome-extension://aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
    const res = await request(app)
      .get("/health")
      .set("Origin", fakeExtId);

    expect(res.headers["access-control-allow-origin"]).toBe(fakeExtId);
  });
});
