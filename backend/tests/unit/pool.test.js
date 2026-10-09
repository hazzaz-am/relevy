import { describe, it, expect } from "vitest";
import { runPool } from "../../src/utils/pool.js";

describe("runPool", () => {
  it("should execute all jobs concurrently up to limit", async () => {
    let running = 0;
    let maxRunning = 0;
    const completed = [];

    const jobs = Array.from({ length: 10 }, (_, i) => async () => {
      running++;
      maxRunning = Math.max(maxRunning, running);
      await new Promise((r) => setTimeout(r, 10));
      completed.push(i);
      running--;
    });

    const error = await runPool(jobs, 3);
    expect(error).toBeNull();
    expect(completed.length).toBe(10);
    expect(maxRunning).toBeLessThanOrEqual(3);
  });

  it("should capture errors without terminating other jobs", async () => {
    const executed = [];
    const jobs = [
      async () => {
        executed.push(1);
      },
      async () => {
        executed.push(2);
        throw new Error("Job 2 failed");
      },
      async () => {
        executed.push(3);
      },
    ];

    const error = await runPool(jobs, 2);
    expect(error).toBeInstanceOf(Error);
    expect(error.message).toBe("Job 2 failed");
    expect(executed).toContain(1);
    expect(executed).toContain(2);
    expect(executed).toContain(3);
  });
});
