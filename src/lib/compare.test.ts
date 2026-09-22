import {
  parseResults, compare, checksMatch, engineOf, project, band, InputError, type Result,
} from "./compare";

let pass = 0;
const fails: string[] = [];
function ok(name: string, cond: boolean) {
  if (cond) pass++; else fails.push(name);
}
function eq(name: string, a: unknown, b: unknown) {
  ok(`${name} (got ${JSON.stringify(a)}, want ${JSON.stringify(b)})`, Object.is(a, b));
}
function close(name: string, a: number, b: number, tol = 1e-9) {
  ok(`${name} (got ${a}, want ${b})`, Math.abs(a - b) <= tol);
}
function throws(name: string, fn: () => unknown) {
  try { fn(); fails.push(`${name} (did not throw)`); } catch { pass++; }
}

const CHECKS = { parse: -517987200, alloc: -1364279329, hash: -9880256, sort: 210640 };

const local: Result = {
  version: "1", label: "this browser", cores: 8,
  median: 280, best: 271, worst: 300, spread: 0.1,
  byWorkload: { parse: 70, alloc: 55, hash: 75, sort: 80 },
  checks: CHECKS,
  parallel: { oneThreadMs: 600, allThreadsMs: 1000, threads: 8, throughput: 40, speedup: 4 },
};

const runner = (over: Partial<Result> = {}): Result => ({
  ...local, label: "ubuntu-latest", cores: 2, median: 840,
  byWorkload: { parse: 210, alloc: 165, hash: 225, sort: 240 },
  parallel: { oneThreadMs: 1800, allThreadsMs: 2400, threads: 2, throughput: 10, speedup: 2 },
  ...over,
});

/* ── integrity: the refusals are the point ──────────────────────────────── */
{
  const r = compare(local, [runner({ checks: { ...CHECKS, sort: 999 } })]);
  eq("mismatched checksums refuse", r.ok, false);
  ok("refusal explains itself", !r.ok && /did not do the same work/.test(r.reason));
}
{
  const r = compare(local, [runner({ version: "2" })]);
  eq("mismatched suite version refuses", r.ok, false);
  ok("version refusal names both", !r.ok && /version 2/.test(r.reason) && /version 1/.test(r.reason));
}
eq("empty comparison refuses", compare(local, []).ok, false);
ok("identical checks match", checksMatch(CHECKS, { ...CHECKS }));
ok("a missing key does not match", !checksMatch(CHECKS, { parse: CHECKS.parse }));
ok("empty checks never match", !checksMatch({}, {}));

/* ── the ratio ──────────────────────────────────────────────────────────── */
{
  const r = compare(local, [runner()]);
  ok("a clean pair compares", r.ok);
  if (r.ok) {
    close("ratio is runner over local", r.ratio, 3);
    eq("one round is one round", r.rounds, 1);
    // Parallel is the other way round: throughput, so local over runner.
    close("parallel ratio uses throughput", r.parallelRatio!, 4);
    const sort = r.byWorkload.find((w) => w.id === "sort")!;
    close("per-workload ratio", sort.ratio, 3);
  }
}

/* ── rounds: the spread between jobs is the oversubscription claim ──────── */
{
  const r = compare(local, [runner({ median: 700 }), runner({ median: 840 }), runner({ median: 1120 })]);
  ok("three rounds compare", r.ok);
  if (r.ok) {
    eq("counts the rounds", r.rounds, 3);
    close("takes the median of rounds", r.runnerMedian, 840);
    close("between-rounds spread", r.betweenRounds, (1120 - 700) / 840);
    close("keeps the worst round", r.worstRound, 1120);
    close("keeps the best round", r.bestRound, 700);
  }
}

/* ── cross-engine honesty ───────────────────────────────────────────────── */
eq("chrome is v8", engineOf("Mozilla/5.0 (Macintosh) AppleWebKit/537.36 (KHTML) Chrome/141.0 Safari/537.36"), "v8");
eq("edge is v8", engineOf("Mozilla/5.0 Chrome/141.0 Safari/537.36 Edg/141.0"), "v8");
eq("safari is jsc", engineOf("Mozilla/5.0 (Macintosh) AppleWebKit/605.1.15 (KHTML) Version/18.0 Safari/605.1.15"), "jsc");
eq("firefox is spidermonkey", engineOf("Mozilla/5.0 (Macintosh; rv:130.0) Gecko/20100101 Firefox/130.0"), "spidermonkey");
{
  const r = compare(local, [runner()], "jsc");
  ok("still compares off-V8", r.ok);
  ok("but flags the engine", r.ok && r.crossEngine === "jsc");
  const v8 = compare(local, [runner()], "v8");
  ok("and stays quiet on V8", v8.ok && v8.crossEngine === null);
}

/* ── reading what was pasted ────────────────────────────────────────────── */
{
  const one = JSON.stringify(runner());
  eq("a bare object", parseResults(one).length, 1);
  eq("an array", parseResults(`[${one},${one}]`).length, 2);
  eq("marker-prefixed log lines", parseResults(`::BENCH::${one}\n::BENCH::${one}`).length, 2);
  eq("noise around the json", parseResults(`some log\n::BENCH::${one}\nDone in 4s`).length, 1);
  eq("several objects on their own lines", parseResults(`${one}\n${one}\n${one}`).length, 3);
  throws("empty input", () => parseResults("   "));
  throws("not json", () => parseResults("hello there"));
  throws("json of the wrong shape", () => parseResults('{"hello":"world"}'));
  ok("error is typed", (() => { try { parseResults(""); } catch (e) { return e instanceof InputError; } return false; })());
}

/* ── what the gap costs ─────────────────────────────────────────────────── */
{
  const p = project(4, 20, 3, 0.008);
  close("runner minutes", p.runnerMinutes, 12);
  close("extra per run", p.extraMinutesPerRun, 8);
  close("extra per month", p.extraMinutesPerMonth, 8 * 20 * 30);
  close("cost per month", p.extraCostPerMonth, 8 * 20 * 30 * 0.008);
  close("waiting hours", p.waitingHoursPerMonth, (8 * 20 * 30) / 60);
  const none = project(4, 20, 1, 0.008);
  close("a runner as fast as you costs nothing extra", none.extraCostPerMonth, 0);
  close("negative inputs clamp", project(-5, -5, 3, -1).extraCostPerMonth, 0);
}

eq("level band", band(1.2), "level");
eq("down band", band(2), "down");
eq("bad band", band(4), "bad");

console.log(fails.length ? `✗ ${fails.length} failed of ${pass + fails.length}` : `✓ ${pass} assertions pass`);
for (const f of fails) console.log("  ✗", f);
process.exit(fails.length ? 1 : 0);
