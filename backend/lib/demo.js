/*
 * Demo scorer used when no Jev API key is set (TYPESAFE_API_KEY=demo).
 * It guesses with keyword matching so you can build and test the whole
 * extension offline. It is much dumber than Jev: expect misses.
 */

const KEYWORDS = {
  ai: ["ai", "artificial intelligence", "llm", "gpt", "chatgpt", "openai", "claude", "anthropic", "gemini", "machine learning", "neural", "model", "agent", "agents", "mcp", "webmcp", "jev", "copilot", "deep learning"],
  startups: ["startup", "startups", "founder", "founders", "vc", "venture", "seed round", "series a", "fundraise", "funding", "yc", "y combinator", "saas", "mrr", "arr", "bootstrapped", "launch"],
  programming: ["code", "coding", "programming", "developer", "devs", "javascript", "typescript", "python", "rust", "golang", "java", "api", "github", "bug", "compiler", "react", "framework", "open source", "terminal", "cli", "deploy"],
  science: ["science", "research", "study", "physics", "chemistry", "biology", "scientists", "experiment", "paper"],
  space: ["space", "nasa", "spacex", "rocket", "orbit", "mars", "moon", "astronaut", "telescope", "galaxy"],
  climate: ["climate", "emissions", "carbon", "warming", "renewable", "solar", "wind power", "net zero"],
  health: ["health", "medical", "doctor", "disease", "sleep", "nutrition", "mental health", "hospital"],
  finance: ["finance", "money", "bank", "inflation", "interest rate", "fed", "economy", "budget", "debt"],
  investing: ["invest", "investing", "stocks", "stock", "portfolio", "etf", "dividend", "market", "shares"],
  design: ["design", "designer", "ui", "ux", "figma", "typography", "branding", "logo"],
  gaming: ["game", "gaming", "gamer", "playstation", "xbox", "nintendo", "steam", "esports", "fortnite"],
  music: ["music", "song", "album", "concert", "band", "rapper", "singer", "spotify", "tour"],
  sports: ["sports", "match", "league", "championship", "player", "team", "coach", "tournament", "cricket"],
  football: ["football", "soccer", "premier league", "goal", "messi", "ronaldo", "nfl", "fifa"],
  basketball: ["basketball", "nba", "lebron", "playoffs", "dunk"],
  elections: ["election", "elections", "vote", "voting", "ballot", "candidate", "polls", "campaign"],
  politics: ["politics", "political", "president", "congress", "senate", "parliament", "government", "minister", "democrat", "republican", "election", "policy"],
  crypto: ["crypto", "bitcoin", "btc", "ethereum", "eth", "blockchain", "token", "web3", "solana", "defi"],
  nft: ["nft", "nfts", "opensea", "mint"],
  memes: ["meme", "memes", "lol", "lmao", "funny"],
  giveaway: ["giveaway", "win a", "free", "retweet to win", "enter to win"],
  "true crime": ["true crime", "murder", "killer", "investigation", "detective", "case"],
  "real estate": ["real estate", "house", "housing", "mortgage", "rent", "property"],
  travel: ["travel", "trip", "flight", "hotel", "vacation", "destination"],
  food: ["food", "recipe", "cooking", "restaurant", "chef", "delicious"],
  fitness: ["fitness", "workout", "gym", "training", "run", "muscle"],
  parenting: ["parenting", "parent", "kids", "baby", "toddler", "mom", "dad"],
  history: ["history", "historical", "ancient", "century", "war", "empire"],
  movies: ["movie", "movies", "film", "trailer", "box office", "netflix", "actor", "cinema", "marvel", "oscars"],
  celebrity: ["celebrity", "celebrities", "kardashian", "taylor swift", "red carpet", "gossip", "dating rumors"],
};

function escape(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function keywordsFor(topic) {
  if (KEYWORDS[topic]) return KEYWORDS[topic];
  // Custom topic: the phrase itself, each longer word, and a plural/singular form.
  const words = topic.split(" ").filter((w) => w.length > 3);
  const forms = new Set([topic, ...words]);
  for (const w of [...forms]) forms.add(w.endsWith("s") ? w.slice(0, -1) : `${w}s`);
  return [...forms];
}

export function demoScorePost(post, topics) {
  const text = ` ${post.text.toLowerCase()} `;
  const probs = {};
  for (const topic of topics) {
    let hits = 0;
    for (const kw of keywordsFor(topic)) {
      const re = new RegExp(`(^|[^\\p{L}\\p{N}])${escape(kw)}([^\\p{L}\\p{N}]|$)`, "u");
      if (re.test(text)) hits++;
    }
    // 0 hits -> 0.04, 1 -> ~0.75, 2 -> ~0.94, 3+ -> ~0.99
    probs[topic] = hits === 0 ? 0.04 : Math.round((1 - Math.exp(-hits * 1.4)) * 1000) / 1000;
  }
  return { probs, usage: { input_tokens: 0, output_tokens: 0 } };
}
