export function log(msg) {
  if (process.env.NODE_ENV === "test") return;
  console.log(`[${new Date().toISOString()}] ${msg}`);
}

export function logError(msg, err) {
  if (process.env.NODE_ENV === "test") return;
  console.error(`[${new Date().toISOString()}] ${msg}`, err || "");
}
