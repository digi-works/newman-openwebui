/** Starts the durable job worker once per server process (M5.8). Not run for the edge runtime or without Digi's database. */
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs" && process.env.DIGI_DATABASE_URL) {
    const { startJobWorker } = await import("./lib/jobs/worker");
    startJobWorker();
  }
  // The platform instance loads Studio's starting catalogue (idempotent).
  if (process.env.NEXT_RUNTIME === "nodejs" && process.env.DIGI_ROLE === "platform" && process.env.STUDIO_DATABASE_URL) {
    const { ensureBuiltinCatalog } = await import("./lib/studio/catalog");
    await ensureBuiltinCatalog().catch((e) => console.error("studio catalogue failed", e.message));
  }
}
