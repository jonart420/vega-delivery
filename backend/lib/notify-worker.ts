import { q } from "./db";
import { activateUpcoming, processQueue } from "./notify";

/**
 * Background worker: moves the tracking/notification window forward for running tours (safety net
 * besides the immediate trigger after each outcome) and sends queued messages with retries.
 * NOTIFY_WORKER_INTERVAL_MS (default 30000), NOTIFY_WORKER_DISABLED=true to turn it off.
 */

const g = globalThis as unknown as { __vdNotifyTimer?: NodeJS.Timeout; __vdNotifyBusy?: boolean };

async function tick() {
  if (g.__vdNotifyBusy) return;
  g.__vdNotifyBusy = true;
  try {
    const tours = await q<{ id: string }>("select id from tours where status = 'in_progress'");
    for (const t of tours) await activateUpcoming(t.id);
    await processQueue();
  } catch (e) {
    console.warn("[notify-worker]", (e as Error).message);
  } finally {
    g.__vdNotifyBusy = false;
  }
}

export function startNotifyWorker() {
  if (g.__vdNotifyTimer || process.env.NOTIFY_WORKER_DISABLED === "true") return;
  const interval = Math.max(5000, Number(process.env.NOTIFY_WORKER_INTERVAL_MS) || 30_000);
  g.__vdNotifyTimer = setInterval(tick, interval);
  g.__vdNotifyTimer.unref();
  setTimeout(tick, 10_000).unref();
  console.log(`[notify-worker] started (every ${interval / 1000} s)`);
}
