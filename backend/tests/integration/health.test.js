import { describe, it, expect } from "vitest";
import request from "supertest";
import app from "../../src/app.js";

describe("GET /health", () => {
  it("should return 200 with status information", async () => {
    const res = await request(app).get("/health");

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("ok", true);
    expect(res.body).toHaveProperty("mode");
    expect(res.body).toHaveProperty("model");
    expect(res.body).toHaveProperty("provider");
  });
});
