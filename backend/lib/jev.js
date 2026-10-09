import { TypeSafeClient, noul, AuthenticationError, RateLimitError } from "@typesafe-ai/sdk";

/*
 * One Jev request per post: every topic becomes a yes/no (noul) question,
 * and Jev answers them all in parallel in a single call.
 * answers[name].noul is the probability of "yes", from 0 to 1.
 */
export function createJevScorer({ apiKey, model, baseURL, timeoutMs = 15000, isOpenRouter = false }) {
  const defaultHeaders = {};
  if (isOpenRouter || (baseURL && baseURL.includes("openrouter.ai"))) {
    defaultHeaders["HTTP-Referer"] = "http://localhost:8787";
    defaultHeaders["X-Title"] = "Relevy";
  }

  const client = new TypeSafeClient({
    apiKey,
    baseURL: baseURL || undefined,
    defaultModel: model,
    timeout: timeoutMs,
    defaultHeaders,
    retry: { maxRetries: 2 }, // SDK retries 408/429/5xx with backoff
  });

  return async function scorePost(post, topics) {
    const questions = {};
    topics.forEach((topic, i) => {
      questions[`t${i}`] = noul(`Is this social media post mainly about ${topic}?`, {
        true: `${topic} is a main subject of the post.`,
        false: `The post is about something else, or only mentions ${topic} in passing.`,
      });
    });

    try {
      const res = await client.systemOne({
        model,
        state: { platform: post.site || "social media", post: post.text },
        questions,
      });
      const out = {};
      topics.forEach((topic, i) => {
        const p = res.answers[`t${i}`]?.noul;
        if (typeof p === "number") out[topic] = Math.round(p * 1000) / 1000;
      });
      return { probs: out, usage: res.usage };
    } catch (err) {
      if (err instanceof AuthenticationError) {
        throw httpError(502, "API rejected the key. Check your OPENROUTER_API_KEY or TYPESAFE_API_KEY.");
      }
      if (err instanceof RateLimitError) {
        throw httpError(503, "API rate limit reached. Try again shortly.");
      }
      throw httpError(502, `Scoring request failed: ${err.message}`);
    }
  };
}

function httpError(status, message) {
  const e = new Error(message);
  e.status = status;
  return e;
}
