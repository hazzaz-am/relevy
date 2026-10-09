import { z } from "zod";
import { config } from "../config/env.js";

const { LIMITS } = config;

export const postItemSchema = z.object({
  id: z.coerce.string().min(1, "Post id is required").max(100),
  text: z.coerce.string().min(1, "Post text is required").max(LIMITS.textChars),
  site: z.coerce.string().optional().default(""),
});

export const scoreRequestSchema = z.object({
  posts: z
    .array(postItemSchema)
    .min(1, "Send at least one post and one topic.")
    .max(LIMITS.posts),
  topics: z
    .array(z.coerce.string())
    .min(1, "Send at least one post and one topic.")
    .transform((topics) => {
      const normalized = topics
        .map((t) => t.toLowerCase().replace(/\s+/g, " ").trim().slice(0, LIMITS.topicChars))
        .filter(Boolean);
      return Array.from(new Set(normalized)).slice(0, LIMITS.topics);
    })
    .refine((topics) => topics.length > 0, {
      message: "Send at least one post and one topic.",
    }),
  site: z.coerce.string().optional().default(""),
});
