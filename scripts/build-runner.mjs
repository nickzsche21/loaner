/**
 * Generates public/runner.mjs — the file people curl into their pipeline.
 *
 * It is *generated* from src/lib/bench.mjs rather than written alongside it,
 * because the moment the two drift the checksums stop matching and every
 * comparison the site makes becomes a refusal. One source, two outputs.
 */
import { readFile, writeFile } from "node:fs/promises";

const bench = await readFile(new URL("../src/lib/bench.mjs", import.meta.url), "utf8");
const harness = await readFile(new URL("../bench-node.mjs", import.meta.url), "utf8");

// Inline the workloads: strip the exports, drop the harness's import of them.
const inlined = bench.replace(/^export /gm, "");
const body = harness
  .replace(/^import \{[^}]*\} from "\.\/src\/lib\/bench\.mjs";\s*$/m, "")
  .replace(/^\/\*\*[\s\S]*?\*\/\s*/, "");

const out = `#!/usr/bin/env node
/* LOANER — the same workloads this page runs in your browser, run on your CI.
   Generated from src/lib/bench.mjs. Prints one JSON line prefixed ::BENCH::.
   Nothing is sent anywhere; it writes to stdout and exits. */

${inlined}
${body}`;

await writeFile(new URL("../public/runner.mjs", import.meta.url), out);
console.log(`public/runner.mjs — ${(out.length / 1024).toFixed(1)} KB`);
