/// <reference lib="webworker" />
/**
 * The browser side of the harness.
 *
 * It exists so the suite does not run on the main thread: a benchmark that
 * blocks the page for three seconds cannot show its own progress, and a frozen
 * tab reads as a broken one. The workloads themselves are imported, never
 * reimplemented — that is the whole contract with the CI runner.
 */
import { runSuite, spread, parallelShare, PARALLEL_REPS, SUITE_VERSION } from "./bench.mjs";

type In = { cmd: "suite"; reps: number } | { cmd: "parallel" };

self.onmessage = (e: MessageEvent<In>) => {
  try {
    handle(e.data);
  } catch (err) {
    // A throw in here does not always reach the page's onerror, and a silent
    // worker is indistinguishable from a slow one. Say what happened.
    self.postMessage({ type: "failed", message: err instanceof Error ? err.message : String(err) });
  }
};

function handle(msg: In) {
  if (msg.cmd === "suite") {
    const out = runSuite({
      reps: msg.reps,
      onProgress: (done: number, total: number, ms: number) =>
        self.postMessage({ type: "progress", done, total, ms }),
    });
    self.postMessage({
      type: "suite",
      version: SUITE_VERSION,
      median: out.median,
      best: out.best,
      worst: out.worst,
      spread: spread(out.passes),
      byWorkload: out.byWorkload,
      checks: out.checks,
      passes: out.passes.map((p: { total: number }) => p.total),
    });
    return;
  }

  // One thread's share of the parallel phase. The main thread starts as many
  // of these as the machine claims to have and times the whole set.
  self.postMessage({ type: "parallel", check: parallelShare(), passes: PARALLEL_REPS });
}
