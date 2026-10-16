/**
 * Runs once when a server process starts (Next.js instrumentation hook).
 * Starts the PolyLingue reminder ticker (browser notifications) when VAPID
 * keys are configured; never in tests. The literal NEXT_RUNTIME check lets
 * the edge build drop the Node-only import.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    if (process.env.NODE_ENV === "test" || process.env.VITEST) return;
    const { startReminderTicker } = await import("@/lib/polylingue/push");
    startReminderTicker();
  }
}
