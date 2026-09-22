/**
 * Runs the suite on a GitHub-hosted runner and prints one JSON object.
 *
 * Nothing here touches the workloads; it only reports what machine it landed
 * on and hands the numbers back. The single-threaded suite is the comparable
 * figure; the parallel phase measures what the whole box can do at once.
 */
import os from "node:os";
import { Worker, isMainThread, parentPort, workerData } from "node:worker_threads";
import { fileURLToPath } from "node:url";
import { runSuite, spread, parallelShare, PARALLEL_REPS, SUITE_VERSION } from "./src/lib/bench.mjs";

if (!isMainThread) {
  parentPort.postMessage(parallelShare(workerData.reps));
} else {
  const self = fileURLToPath(import.meta.url);

  const parallel = (threads) =>
    new Promise((resolve, reject) => {
      const t0 = performance.now();
      let done = 0;
      const shares = [];
      for (let i = 0; i < threads; i++) {
        const w = new Worker(self, { workerData: { reps: PARALLEL_REPS } });
        w.on("message", (c) => { shares.push(c); });
        w.on("error", reject);
        w.on("exit", () => {
          if (++done === threads) {
            resolve({ threads, ms: performance.now() - t0, passes: threads * PARALLEL_REPS, shares });
          }
        });
      }
    });

  const cpus = os.cpus();
  const suite = runSuite({ reps: 7 });
  const one = await parallel(1);
  const many = await parallel(cpus.length);

  console.log("::BENCH::" + JSON.stringify({
    version: SUITE_VERSION,
    label: process.env.RUNNER_LABEL || "unknown",
    visibility: process.env.REPO_VISIBILITY || "unknown",
    round: Number(process.env.ROUND || 0),
    os: process.platform,
    arch: process.arch,
    node: process.versions.node,
    cpuModel: (cpus[0] && cpus[0].model || "").trim(),
    cores: cpus.length,
    memGB: +(os.totalmem() / 1024 ** 3).toFixed(1),
    median: +suite.median.toFixed(2),
    best: +suite.best.toFixed(2),
    worst: +suite.worst.toFixed(2),
    spread: +spread(suite.passes).toFixed(4),
    byWorkload: Object.fromEntries(Object.entries(suite.byWorkload).map(([k, v]) => [k, +v.toFixed(2)])),
    checks: suite.checks,
    parallel: {
      oneThreadMs: +one.ms.toFixed(2),
      allThreadsMs: +many.ms.toFixed(2),
      threads: many.threads,
      throughput: +((many.passes / many.ms) * 1000).toFixed(3),
      speedup: +(((many.passes / many.ms) / (one.passes / one.ms))).toFixed(3),
      // Every thread must land on the same share as the single thread did.
      // Compared elementwise rather than combined, because any commutative
      // combiner can cancel identical values and report agreement it never saw.
      check: many.shares.length === many.threads
        && many.shares.every((s) => s === one.shares[0]),
    },
    at: new Date().toISOString(),
  }));
}
