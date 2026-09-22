#!/usr/bin/env node
/* LOANER — the same workloads this page runs in your browser, run on your CI.
   Generated from src/lib/bench.mjs. Prints one JSON line prefixed ::BENCH::.
   Nothing is sent anywhere; it writes to stdout and exits. */

/**
 * The workloads. This file is the contract of the whole project: the *same
 * bytes* run under Node on a GitHub-hosted runner and in your browser. If the
 * two sides ran different code the comparison would mean nothing, so nothing
 * platform-specific is allowed in here — no `os`, no `window`, no imports.
 *
 * Everything is seeded and integer-only, and every workload returns a checksum.
 * The checksums are compared across platforms: if a runner and a browser report
 * different ones, they did not do the same work and the result is thrown away.
 */

const SUITE_VERSION = "1";

/** xorshift32. Integer-only, so it cannot drift between engines the way floats can. */
function rng(seed) {
  let s = seed | 0 || 1;
  return () => {
    s ^= s << 13; s |= 0;
    s ^= s >>> 17;
    s ^= s << 5; s |= 0;
    return s >>> 0;
  };
}

const IDENT = "abcdefghijklmnopqrstuvwxyz_$";
const PUNCT = "{}()[];,.+-*/=<>!&|:?";

/* ── parse ──────────────────────────────────────────────────────────────────
   Scanning source text character by character: what a bundler, a transpiler
   and a linter all spend most of their time doing. Branch-heavy, charCodeAt-
   heavy, and the workload most like the tools that actually fill CI minutes. */
function setupParse() {
  const r = rng(0x5eed1);
  const out = [];
  for (let i = 0; i < 130000; i++) {
    const k = r() % 5;
    if (k === 0) {
      let w = "";
      for (let j = 0, n = 3 + (r() % 9); j < n; j++) w += IDENT[r() % IDENT.length];
      out.push(w);
    } else if (k === 1) out.push(String(r() % 100000));
    else if (k === 2) out.push(PUNCT[r() % PUNCT.length]);
    else if (k === 3) out.push('"' + IDENT[r() % 26] + IDENT[r() % 26] + IDENT[r() % 26] + '"');
    else out.push(r() % 3 === 0 ? "\n" : " ");
  }
  return out.join("");
}

function runParse(src) {
  let idents = 0, nums = 0, punct = 0, strings = 0, sum = 0;
  for (let pass = 0; pass < 40; pass++) {
    let i = 0;
    const n = src.length;
    while (i < n) {
      const c = src.charCodeAt(i);
      if (c === 32 || c === 10) { i++; continue; }
      if (c >= 48 && c <= 57) {
        let v = 0;
        while (i < n) {
          const d = src.charCodeAt(i);
          if (d < 48 || d > 57) break;
          v = (v * 10 + (d - 48)) | 0; i++;
        }
        nums++; sum = (sum + v) | 0;
      } else if ((c >= 97 && c <= 122) || c === 95 || c === 36) {
        let h = 2166136261;
        while (i < n) {
          const d = src.charCodeAt(i);
          if (!((d >= 97 && d <= 122) || d === 95 || d === 36 || (d >= 48 && d <= 57))) break;
          h = Math.imul(h ^ d, 16777619); i++;
        }
        idents++; sum = (sum + h) | 0;
      } else if (c === 34) {
        i++;
        while (i < n && src.charCodeAt(i) !== 34) i++;
        i++; strings++; sum = (sum + 7) | 0;
      } else { punct++; sum = (sum ^ c) | 0; i++; }
    }
  }
  return (sum ^ idents ^ (nums << 3) ^ (punct << 7) ^ (strings << 11)) | 0;
}

/* ── alloc ──────────────────────────────────────────────────────────────────
   Short-lived objects and a Map that keeps growing: the shape of a test
   runner building fixtures, or any framework rebuilding a tree per case.
   This is the workload that leans on the garbage collector, and GC is where
   a memory-starved box tends to show its limits. */
function runAlloc() {
  const r = rng(0xa11c0c);
  const index = new Map();
  let live = [];
  let sum = 0;
  for (let i = 0; i < 1150000; i++) {
    const node = { id: i, key: (r() % 4096), tag: null, kids: null, w: r() % 1000 };
    node.tag = node.key & 7 ? "leaf" : "branch";
    if ((i & 15) === 0) node.kids = [node.w, node.w + 1, node.w + 2];
    live.push(node);
    const k = node.key;
    const bucket = index.get(k);
    if (bucket === undefined) index.set(k, 1); else index.set(k, bucket + 1);
    // Drop the batch on the floor periodically so the collector has work to do.
    if (live.length >= 2048) {
      for (let j = 0; j < live.length; j++) sum = (sum + live[j].w) | 0;
      live = [];
    }
  }
  for (const [k, v] of index) sum = (sum + Math.imul(k, v)) | 0;
  return sum | 0;
}

/* ── hash ───────────────────────────────────────────────────────────────────
   FNV-1a over bytes. Pure integer ALU with a predictable access pattern, so
   it isolates raw clock and memory bandwidth from allocator behaviour. This
   is the closest thing here to "how fast is one core, really". */
function setupHash() {
  const r = rng(0x4a5);
  const buf = new Uint8Array(1_400_000);
  for (let i = 0; i < buf.length; i++) buf[i] = r() & 0xff;
  return buf;
}

function runHash(buf) {
  let acc = 0;
  for (let pass = 0; pass < 40; pass++) {
    let h = 2166136261 ^ pass;
    for (let i = 0; i < buf.length; i++) h = Math.imul(h ^ buf[i], 16777619);
    acc = (acc ^ h) | 0;
  }
  return acc | 0;
}

/* ── sort ───────────────────────────────────────────────────────────────────
   Comparison sort over strings: resolving a module graph, ordering a lockfile,
   sorting test names. Mixed branchy work with a lot of pointer chasing. */
function setupSort() {
  const r = rng(0x507a7);
  const a = new Array(90000);
  for (let i = 0; i < a.length; i++) {
    let w = "";
    for (let j = 0, n = 6 + (r() % 10); j < n; j++) w += IDENT[r() % 26];
    a[i] = w;
  }
  return a;
}

function runSort(src) {
  let sum = 0;
  for (let pass = 0; pass < 2; pass++) {
    const a = src.slice();
    a.sort((x, y) => (x < y ? -1 : x > y ? 1 : 0));
    for (let i = 0; i < a.length; i += 997) {
      const s = a[i];
      for (let j = 0; j < s.length; j++) sum = (sum + s.charCodeAt(j)) | 0;
    }
  }
  return sum | 0;
}

const WORKLOADS = [
  { id: "parse", label: "parse", note: "scanning source text", setup: setupParse, run: runParse },
  { id: "alloc", label: "alloc", note: "objects and the collector", setup: null, run: runAlloc },
  { id: "hash", label: "hash", note: "integer work over bytes", setup: setupHash, run: runHash },
  { id: "sort", label: "sort", note: "comparison sort", setup: setupSort, run: runSort },
];

const now = () => (typeof performance !== "undefined" ? performance.now() : Date.now());

/**
 * One pass of every workload. Setup is deliberately outside the clock — we are
 * timing the work, not the construction of its input.
 */
function runPass(prepared) {
  const times = {};
  const checks = {};
  for (const w of WORKLOADS) {
    const input = prepared[w.id];
    const t0 = now();
    checks[w.id] = w.run(input);
    times[w.id] = now() - t0;
  }
  return { times, checks };
}

function prepare() {
  const prepared = {};
  for (const w of WORKLOADS) prepared[w.id] = w.setup ? w.setup() : undefined;
  return prepared;
}

/**
 * Repeats the suite and reports every pass rather than only the best.
 *
 * The spread between passes is not noise to be averaged away here — on a
 * shared machine it is the measurement. `median` is what gets compared;
 * `passes` is what shows whether the box was steady.
 *
 * @param {{ reps?: number, onProgress?: (done: number, total: number, ms: number) => void }} [opts]
 */
function runSuite({ reps = 5, onProgress } = {}) {
  const prepared = prepare();
  const passes = [];
  let checks = null;
  // Two untimed passes so the JIT has compiled and settled on the hot loops
  // before we look. One is not enough: the first pass still reoptimises.
  runPass(prepared);
  runPass(prepared);
  for (let i = 0; i < reps; i++) {
    const { times, checks: c } = runPass(prepared);
    checks = c;
    const total = WORKLOADS.reduce((n, w) => n + times[w.id], 0);
    passes.push({ times, total });
    if (onProgress) onProgress(i + 1, reps, total);
  }
  const totals = passes.map((p) => p.total);
  return {
    version: SUITE_VERSION,
    passes,
    checks,
    median: median(totals),
    best: Math.min(...totals),
    worst: Math.max(...totals),
    byWorkload: Object.fromEntries(
      WORKLOADS.map((w) => [w.id, median(passes.map((p) => p.times[w.id]))])
    ),
  };
}

function median(xs) {
  const a = [...xs].sort((x, y) => x - y);
  const m = a.length >> 1;
  return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
}

/** Spread as a share of the median — how much the same box varies run to run. */
function spread(passes) {
  const t = passes.map((p) => p.total);
  const m = median(t);
  return m > 0 ? (Math.max(...t) - Math.min(...t)) / m : 0;
}

/**
 * The unit of parallel work.
 *
 * Deliberately the hash workload: it needs no shared state, so each thread
 * builds its own input and nothing is transferred once running. The harness
 * around it *is* platform-specific — `worker_threads` on a runner, `Worker`
 * in a browser — but the work inside every thread is this same function, which
 * is the part that has to match.
 */
function hashUnit() {
  const buf = setupHash();
  return () => runHash(buf);
}

const PARALLEL_REPS = 4;

/**
 * One thread's share of the parallel phase, accumulator and all.
 *
 * It lives here rather than in each harness so the two cannot diverge, and it
 * mixes with multiply-accumulate rather than XOR on purpose. XOR looks like a
 * fine accumulator and is a trap here: the same checksum XOR-ed an even number
 * of times is zero, and `h ^ h+1 ^ h+2 ^ h+3` is zero for any h divisible by
 * four — which the hash checksum happens to be. Both made the integrity check
 * pass while checking nothing.
 */
function parallelShare(reps = PARALLEL_REPS) {
  const run = hashUnit();
  let c = 17;
  for (let i = 0; i < reps; i++) c = (Math.imul(c, 31) + run() + i) | 0;
  return c;
}

import os from "node:os";
import { Worker, isMainThread, parentPort, workerData } from "node:worker_threads";
import { fileURLToPath } from "node:url";

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
