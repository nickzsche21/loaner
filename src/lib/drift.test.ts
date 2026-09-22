/**
 * The one invariant the whole site rests on.
 *
 * public/runner.mjs is generated from src/lib/bench.mjs. If it is ever stale,
 * the checksums stop matching and every comparison on the page turns into a
 * refusal — a failure that would look like a user error rather than a build
 * problem. So: regenerate, diff, and run the thing end to end.
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { runSuite, parallelShare } from "./bench.mjs";

const fails: string[] = [];
let pass = 0;
const ok = (name: string, cond: boolean) => { cond ? pass++ : fails.push(name); };

const before = readFileSync("public/runner.mjs", "utf8");
execFileSync("node", ["scripts/build-runner.mjs"], { stdio: "pipe" });
const after = readFileSync("public/runner.mjs", "utf8");
ok("public/runner.mjs is current with src/lib/bench.mjs", before === after);

const raw = execFileSync("node", ["public/runner.mjs"], { encoding: "utf8", timeout: 120000 });
const line = raw.split("\n").find((l) => l.startsWith("::BENCH::"));
ok("the runner prints a ::BENCH:: line", Boolean(line));

const out = JSON.parse(line!.slice("::BENCH::".length));
const here = runSuite({ reps: 1 });

ok("suite versions agree", out.version === here.version);
for (const [k, v] of Object.entries(here.checks as Record<string, number>)) {
  ok(`checksum matches for ${k} (browser ${v}, runner ${out.checks[k]})`, out.checks[k] === v);
}
ok("the runner reports its cores", typeof out.cores === "number" && out.cores > 0);
ok("the parallel phase agrees with the single thread", out.parallel.check === true);
// ...and that agreement has to mean something: a zero share would make every
// comparison trivially equal, which is how the first version of it passed.
ok("the parallel share is not degenerate", parallelShare() !== 0);

console.log(fails.length ? `✗ ${fails.length} failed of ${pass + fails.length}` : `✓ ${pass} assertions pass`);
for (const f of fails) console.log("  ✗", f);
process.exit(fails.length ? 1 : 0);
