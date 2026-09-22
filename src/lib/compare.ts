/**
 * Comparing a browser result with a runner result.
 *
 * The comparison is only meaningful if both sides did identical work on a
 * comparable engine, so most of what is here exists to *refuse* — mismatched
 * suite versions, mismatched checksums, and cross-engine pairings that would
 * report a JavaScript engine difference as a hardware one.
 */

export type Checks = Record<string, number>;

export type Parallel = {
  oneThreadMs: number;
  allThreadsMs: number;
  threads: number;
  throughput: number;
  speedup: number;
};

export type Result = {
  version: string;
  label: string;
  os?: string;
  arch?: string;
  cpuModel?: string;
  cores: number;
  memGB?: number;
  visibility?: string;
  round?: number;
  median: number;
  best: number;
  worst: number;
  spread: number;
  byWorkload: Record<string, number>;
  checks: Checks;
  parallel?: Parallel;
  at?: string;
};

export class InputError extends Error {}

/* ── engines ────────────────────────────────────────────────────────────────
   Node is V8. So is Chrome, and so is Edge. Safari is JavaScriptCore and
   Firefox is SpiderMonkey, and those run this suite at genuinely different
   speeds — comparing one of them against a runner measures the engine as much
   as the machine. The page says so rather than quietly reporting a ratio. */
export type Engine = "v8" | "jsc" | "spidermonkey" | "unknown";

export function engineOf(ua: string): Engine {
  if (/Edg\/|Chrome\/|Chromium\//.test(ua) && !/OPR\//.test(ua)) return "v8";
  if (/OPR\//.test(ua)) return "v8";
  if (/Firefox\//.test(ua)) return "spidermonkey";
  if (/Safari\//.test(ua) && !/Chrome\//.test(ua)) return "jsc";
  return "unknown";
}

export const ENGINE_LABEL: Record<Engine, string> = {
  v8: "V8",
  jsc: "JavaScriptCore",
  spidermonkey: "SpiderMonkey",
  unknown: "an unrecognised engine",
};

/* ── reading what was pasted ───────────────────────────────────────────────
   People paste one job, or several rounds at once, or the whole log line with
   the marker still on the front. All three are accepted; anything else is an
   error with a reason rather than a silent zero. */
export function parseResults(text: string): Result[] {
  const trimmed = text.trim();
  if (!trimmed) throw new InputError("Nothing pasted yet.");

  const found: unknown[] = [];
  const direct = tryJSON(trimmed);
  if (direct !== undefined) {
    if (Array.isArray(direct)) found.push(...direct);
    else found.push(direct);
  } else {
    // Line-oriented: a log with ::BENCH:: markers, or several objects pasted together.
    for (const line of trimmed.split("\n")) {
      const i = line.indexOf("{");
      if (i < 0) continue;
      const v = tryJSON(line.slice(i));
      if (v !== undefined) found.push(v);
    }
  }

  if (!found.length) throw new InputError("That is not JSON. Paste the line the command printed.");

  const results = found.map(asResult).filter((r): r is Result => r !== null);
  if (!results.length) {
    throw new InputError("That JSON is not a bench result — no median and no checks in it.");
  }
  return results;
}

function tryJSON(s: string): unknown {
  try { return JSON.parse(s); } catch { return undefined; }
}

function asResult(v: unknown): Result | null {
  if (!v || typeof v !== "object") return null;
  const o = v as Record<string, unknown>;
  if (typeof o.median !== "number" || typeof o.checks !== "object" || o.checks === null) return null;
  return {
    version: String(o.version ?? "?"),
    label: String(o.label ?? o.cpuModel ?? "runner"),
    os: o.os as string | undefined,
    arch: o.arch as string | undefined,
    cpuModel: o.cpuModel as string | undefined,
    cores: Number(o.cores ?? 0),
    memGB: o.memGB as number | undefined,
    visibility: o.visibility as string | undefined,
    round: o.round as number | undefined,
    median: Number(o.median),
    best: Number(o.best ?? o.median),
    worst: Number(o.worst ?? o.median),
    spread: Number(o.spread ?? 0),
    byWorkload: (o.byWorkload as Record<string, number>) ?? {},
    checks: o.checks as Checks,
    parallel: o.parallel as Parallel | undefined,
    at: o.at as string | undefined,
  };
}

/* ── integrity ─────────────────────────────────────────────────────────────
   A ratio between two machines that ran different work is worse than no
   ratio, because it looks like a measurement. */
export function checksMatch(a: Checks, b: Checks): boolean {
  const keys = Object.keys(a);
  if (!keys.length || keys.length !== Object.keys(b).length) return false;
  return keys.every((k) => (a[k] | 0) === (b[k] | 0));
}

export type Refusal = { ok: false; reason: string };
export type Comparison = {
  ok: true;
  /** How many times longer the runner takes on identical single-threaded work. */
  ratio: number;
  runner: Result;
  rounds: number;
  /** Median across rounds, and how far apart the rounds were. */
  runnerMedian: number;
  betweenRounds: number;
  worstRound: number;
  bestRound: number;
  parallelRatio: number | null;
  byWorkload: { id: string; ratio: number }[];
  crossEngine: Engine | null;
};

export function compare(local: Result, pasted: Result[], engine: Engine = "v8"): Comparison | Refusal {
  if (!pasted.length) return { ok: false, reason: "Nothing to compare against yet." };

  const bad = pasted.find((r) => r.version !== local.version);
  if (bad) {
    return {
      ok: false,
      reason: `That result came from suite version ${bad.version} and this page runs version ${local.version}. Re-run the command.`,
    };
  }

  const mismatched = pasted.find((r) => !checksMatch(local.checks, r.checks));
  if (mismatched) {
    return {
      ok: false,
      reason:
        "The checksums do not match, so the two sides did not do the same work. Nothing is comparable here and no ratio is shown.",
    };
  }

  const medians = pasted.map((r) => r.median).sort((a, b) => a - b);
  const runnerMedian = med(medians);
  const ratio = runnerMedian / local.median;

  const localPar = local.parallel?.throughput ?? 0;
  const runnerPar = med(pasted.map((r) => r.parallel?.throughput ?? 0).sort((a, b) => a - b));
  const parallelRatio = localPar > 0 && runnerPar > 0 ? localPar / runnerPar : null;

  const ids = Object.keys(local.byWorkload);
  const byWorkload = ids.map((id) => ({
    id,
    ratio: med(pasted.map((r) => r.byWorkload[id] ?? 0).sort((a, b) => a - b)) / (local.byWorkload[id] || 1),
  }));

  return {
    ok: true,
    ratio,
    runner: pasted[0],
    rounds: pasted.length,
    runnerMedian,
    betweenRounds: runnerMedian > 0 ? (medians[medians.length - 1] - medians[0]) / runnerMedian : 0,
    bestRound: medians[0],
    worstRound: medians[medians.length - 1],
    parallelRatio,
    byWorkload,
    crossEngine: engine === "v8" ? null : engine,
  };
}

function med(sorted: number[]): number {
  if (!sorted.length) return 0;
  const m = sorted.length >> 1;
  return sorted.length % 2 ? sorted[m] : (sorted[m - 1] + sorted[m]) / 2;
}

/* ── what the gap costs ────────────────────────────────────────────────────
   Deliberately driven by a suite length you type in, because the benchmark
   knows nothing about your tests. The rate is editable for the same reason:
   a hardcoded price goes stale and then the page is lying with confidence. */
export type Projection = {
  localMinutes: number;
  runnerMinutes: number;
  extraMinutesPerRun: number;
  extraMinutesPerMonth: number;
  extraCostPerMonth: number;
  waitingHoursPerMonth: number;
};

export function project(
  suiteMinutesLocal: number,
  runsPerDay: number,
  ratio: number,
  ratePerMinute: number
): Projection {
  const localMinutes = Math.max(0, suiteMinutesLocal);
  const runnerMinutes = localMinutes * ratio;
  const extra = runnerMinutes - localMinutes;
  const perMonth = extra * Math.max(0, runsPerDay) * 30;
  return {
    localMinutes,
    runnerMinutes,
    extraMinutesPerRun: extra,
    extraMinutesPerMonth: perMonth,
    extraCostPerMonth: perMonth * Math.max(0, ratePerMinute),
    waitingHoursPerMonth: perMonth / 60,
  };
}

/** Colour is an output here: it is the ratio, not a theme. */
export function band(ratio: number): "level" | "down" | "bad" {
  if (ratio < 1.5) return "level";
  if (ratio < 3) return "down";
  return "bad";
}

export const RATES = [
  { id: "linux", label: "Linux", perMinute: 0.008 },
  { id: "windows", label: "Windows", perMinute: 0.016 },
  { id: "macos", label: "macOS", perMinute: 0.08 },
] as const;
