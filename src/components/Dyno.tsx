"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Gauge from "./Gauge";
import {
  parseResults, compare, project, band, engineOf, ENGINE_LABEL, InputError, RATES,
  type Result, type Engine,
} from "@/lib/compare";

type Phase = "idle" | "suite" | "parallel" | "done";
type Progress = { done: number; total: number; ms: number };

const REPS = 7;
const WORKLOAD_NOTE: Record<string, string> = {
  parse: "scanning source text",
  alloc: "objects and the collector",
  hash: "integer work over bytes",
  sort: "comparison sort",
};

export default function Dyno() {
  const [phase, setPhase] = useState<Phase>("idle");
  const [progress, setProgress] = useState<Progress | null>(null);
  const [local, setLocal] = useState<Result | null>(null);
  const [pasted, setPasted] = useState("");
  const [origin, setOrigin] = useState("");
  const [engine, setEngine] = useState<Engine>("v8");
  const [copied, setCopied] = useState(false);
  const [runError, setRunError] = useState<string | null>(null);
  const [localPaste, setLocalPaste] = useState("");
  const [parDone, setParDone] = useState<{ done: number; of: number } | null>(null);

  const [suiteMin, setSuiteMin] = useState(4);
  const [runsPerDay, setRunsPerDay] = useState(20);
  const [rateId, setRateId] = useState<string>("linux");

  const workers = useRef<Worker[]>([]);

  useEffect(() => {
    setOrigin(window.location.origin);
    setEngine(engineOf(navigator.userAgent));
    return () => { workers.current.forEach((w) => w.terminate()); };
  }, []);

  function spawn() {
    const w = new Worker(new URL("../lib/worker.ts", import.meta.url), { type: "module" });
    workers.current.push(w);
    return w;
  }

  function parallelPhase(n: number) {
    return new Promise<{ ms: number; passes: number }>((resolve, reject) => {
      const ws = Array.from({ length: n }, spawn);
      setParDone({ done: 0, of: n });
      let done = 0;
      let passes = 0;
      const t0 = performance.now();
      for (const w of ws) {
        w.onerror = (ev) => reject(new Error(`parallel worker failed: ${ev.message || "no message"}`));
        w.onmessage = (e: MessageEvent<{ passes: number; type?: string; message?: string }>) => {
          if (e.data.type === "failed") { reject(new Error(e.data.message ?? "worker failed")); return; }
          passes += e.data.passes;
          w.terminate();
          setParDone({ done: done + 1, of: n });
          if (++done === n) resolve({ ms: performance.now() - t0, passes });
        };
        w.postMessage({ cmd: "parallel" });
      }
    });
  }

  async function run() {
    setPhase("suite");
    setProgress(null);
    setLocal(null);
    setRunError(null);
    try {
      await measure();
    } catch (e) {
      // A worker that fails to start would otherwise leave the button spinning
      // forever with nothing on screen to explain it.
      setRunError(e instanceof Error ? e.message : String(e));
      setPhase("idle");
    }
  }

  async function measure() {

    const w = spawn();
    const suite = await new Promise<{
      version: string; median: number; best: number; worst: number; spread: number;
      byWorkload: Record<string, number>; checks: Record<string, number>;
    }>((resolve, reject) => {
      w.onerror = (ev) => reject(new Error(`suite worker failed: ${ev.message || "no message"}`));
      w.onmessage = (e: MessageEvent<{ type: string } & Record<string, never>>) => {
        const d = e.data as unknown as Progress & { type: string };
        if (d.type === "progress") setProgress({ done: d.done, total: d.total, ms: d.ms });
        else if (d.type === "failed") reject(new Error((d as unknown as { message: string }).message));
        else if (d.type === "suite") resolve(e.data as never);
      };
      w.postMessage({ cmd: "suite", reps: REPS });
    });
    w.terminate();

    setPhase("parallel");
    const threads = Math.max(1, navigator.hardwareConcurrency || 4);
    const one = await parallelPhase(1);
    const many = await parallelPhase(threads);

    setLocal({
      version: suite.version,
      label: "this browser",
      cores: threads,
      median: suite.median,
      best: suite.best,
      worst: suite.worst,
      spread: suite.spread,
      byWorkload: suite.byWorkload,
      checks: suite.checks,
      parallel: {
        oneThreadMs: one.ms,
        allThreadsMs: many.ms,
        threads,
        throughput: (many.passes / many.ms) * 1000,
        speedup: (many.passes / many.ms) / (one.passes / one.ms),
      },
    });
    setPhase("done");
  }

  /* The pasted runner result, and why it was rejected if it was. */
  const parsed = useMemo(() => {
    if (!pasted.trim()) return { results: [] as Result[], error: null as string | null };
    try {
      return { results: parseResults(pasted), error: null };
    } catch (e) {
      return { results: [], error: e instanceof InputError ? e.message : "Could not read that." };
    }
  }, [pasted]);

  /* A result from `node loaner.mjs` on this same machine, if one was pasted. */
  const localNode = useMemo(() => {
    if (!localPaste.trim()) return null;
    try { return parseResults(localPaste)[0] ?? null; } catch { return null; }
  }, [localPaste]);

  /* Node-to-node is the exact comparison, so it wins whenever it is available;
     the browser reading is the one that costs nothing to get. */
  const baseline = localNode ?? local;
  const baselineIsBrowser = !localNode && Boolean(local);

  /* With both in hand the page can show what the browser costs on this very
     machine, instead of asking anyone to take the caveat on trust. */
  const browserOverhead = localNode && local ? local.median / localNode.median : null;

  const comparison = useMemo(
    () => (baseline && parsed.results.length
      ? compare(baseline, parsed.results, baselineIsBrowser ? engine : "v8")
      : null),
    [baseline, parsed.results, engine, baselineIsBrowser]
  );

  const ratio = comparison?.ok ? comparison.ratio : null;
  const tone = ratio === null ? "var(--ink-mid)" : `var(--${band(ratio)})`;

  useEffect(() => {
    document.documentElement.style.setProperty("--gap", tone);
  }, [tone]);

  const rate = RATES.find((r) => r.id === rateId) ?? RATES[0];
  const cost = ratio !== null ? project(suiteMin, runsPerDay, ratio, rate.perMinute) : null;

  const command = `curl -fsSL ${origin || "https://loaner.vercel.app"}/runner.mjs -o loaner.mjs && node loaner.mjs`;

  async function copy() {
    try {
      await navigator.clipboard.writeText(command);
      setCopied(true);
      setTimeout(() => setCopied(false), 1400);
    } catch { /* clipboard blocked; the text is on screen to select */ }
  }

  const running = phase === "suite" || phase === "parallel";

  return (
    <div className="space-y-px">
      {/* ── 1. this machine ──────────────────────────────────────────── */}
      <section className="card p-6 sm:p-8">
        <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-2">
          <h2 className="plate">1 — the machine you are sitting at</h2>
          {local && <span className="plate">{local.cores} cores · {ENGINE_LABEL[engine]}</span>}
        </div>

        <div className="mt-5 flex flex-wrap items-center gap-4">
          <button
            onClick={run}
            disabled={running}
            className="border px-5 py-2.5 text-[13px] tracking-wide transition-colors disabled:opacity-60"
            style={{ borderColor: "var(--gap)", color: running ? "var(--ink-mid)" : "var(--ink)" }}
          >
            {phase === "idle" ? "run the suite" : running ? "running…" : "run again"}
          </button>

          {running && (
            <span className="plate running">
              {phase === "suite"
                ? `pass ${progress?.done ?? 0} of ${REPS}`
                : `parallel phase — ${parDone?.done ?? 0} of ${parDone?.of ?? 0} threads back`}
            </span>
          )}
          {phase === "idle" && !runError && (
            <span className="text-[13px] text-mid">About five seconds. Nothing leaves the page.</span>
          )}
        </div>

        {runError && (
          <p className="mt-4 border-l-2 pl-4 text-[13px] leading-relaxed text-mid" style={{ borderColor: "var(--bad)" }}>
            {runError}
          </p>
        )}

        {local && (
          <div className="mt-7 grid gap-px border border-line-soft bg-line-soft sm:grid-cols-3">
            <Cell k="median pass" v={`${local.median.toFixed(0)} ms`} note={`best ${local.best.toFixed(0)} · worst ${local.worst.toFixed(0)}`} />
            <Cell k="steadiness" v={`±${(local.spread * 100).toFixed(0)}%`} note="spread across passes" />
            <Cell
              k="all cores"
              v={`${local.parallel!.throughput.toFixed(1)}/s`}
              note={`${local.parallel!.speedup.toFixed(1)}× one thread`}
            />
          </div>
        )}

        {local && (
          <div className="mt-px grid gap-px border border-line-soft bg-line-soft sm:grid-cols-4">
            {Object.entries(local.byWorkload).map(([id, ms]) => (
              <Cell key={id} k={id} v={`${ms.toFixed(0)} ms`} note={WORKLOAD_NOTE[id] ?? ""} />
            ))}
          </div>
        )}

        {/* The browser figure is free but inexact. Node on this same machine is
            the like-for-like baseline, because the runner side is Node too. */}
        <div className="mt-7 border-t border-line-soft pt-5">
          <div className="plate">for an exact reading</div>
          <p className="mt-2 max-w-[62ch] text-[14px] leading-relaxed text-mid">
            A browser is not a fair stand-in for Node. On the machine this was built on, the same
            suite ran somewhere between <strong className="text-ink">4.5× and 15× slower</strong> in
            the browser than under Node on identical silicon — the range is not a typo, it varied
            that much between runs while Node did not move. Run the same command here and the
            comparison becomes Node against Node, with nothing left to argue about.
          </p>
          <textarea
            value={localPaste}
            onChange={(e) => setLocalPaste(e.target.value)}
            rows={2}
            spellCheck={false}
            placeholder="paste what `node loaner.mjs` printed on this machine"
            className="num mt-3 w-full resize-y border border-line bg-raised p-3 text-[12px] leading-relaxed text-ink outline-none placeholder:text-dim focus:border-gap"
          />
          {localNode && (
            <p className="mt-3 text-[13px] leading-relaxed text-mid">
              Baseline is now Node on this machine —{" "}
              <span className="num text-ink">{localNode.median.toFixed(0)} ms</span>
              {browserOverhead && (
                <>, and this browser read{" "}
                  <span className="num" style={{ color: "var(--gap)" }}>{browserOverhead.toFixed(1)}×</span>{" "}
                  slower than it on the same silicon. That gap is the browser, not the hardware,
                  which is exactly why it is no longer being used.</>
                )}
            </p>
          )}
        </div>
      </section>

      {/* ── 2. the runner ────────────────────────────────────────────── */}
      <section className="card p-6 sm:p-8">
        <h2 className="plate">2 — the machine you rent</h2>
        <p className="mt-3 max-w-[62ch] text-[14px] leading-relaxed text-mid">
          Add this as a step in your pipeline. It is the same file this page just ran, generated
          from the same source, and it prints one line.
        </p>

        <div className="mt-4 inset flex items-center justify-between gap-4 p-3">
          <code className="num overflow-x-auto whitespace-nowrap text-[12px] text-ink">{command}</code>
          <button onClick={copy} className="plate shrink-0 hover:text-ink">{copied ? "copied" : "copy"}</button>
        </div>

        <p className="mt-3 text-[13px] text-dim">
          Run it in three separate jobs rather than three times in one, and paste all three — that is
          the only way to see whether you get the same machine twice.
        </p>

        <textarea
          value={pasted}
          onChange={(e) => setPasted(e.target.value)}
          rows={4}
          spellCheck={false}
          placeholder="paste the ::BENCH:: line (or several)"
          className="mt-4 w-full resize-y border border-line bg-raised p-3 text-[12px] leading-relaxed text-ink outline-none num placeholder:text-dim focus:border-gap"
        />

        {parsed.error && (
          <p className="mt-3 border-l-2 pl-4 text-[13px] leading-relaxed text-mid" style={{ borderColor: "var(--bad)" }}>
            {parsed.error}
          </p>
        )}

        {parsed.results.length > 0 && (
          <div className="mt-4 border border-line-soft">
            {parsed.results.map((r, i) => (
              <div key={i} className="row flex flex-wrap items-baseline justify-between gap-x-4 px-4 py-2.5 text-[13px]">
                <span>
                  {r.label}
                  {r.round ? <span className="text-dim"> · round {r.round}</span> : null}
                  {r.visibility && r.visibility !== "unknown" ? <span className="text-dim"> · {r.visibility}</span> : null}
                </span>
                <span className="num text-mid">
                  {r.cores} cores · {r.median.toFixed(0)} ms
                  {r.cpuModel ? <span className="text-dim"> · {r.cpuModel}</span> : null}
                </span>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* ── 3. the gap ───────────────────────────────────────────────── */}
      <section className="card p-6 sm:p-8">
        <h2 className="plate">3 — the gap</h2>

        {comparison && !comparison.ok && (
          <p className="mt-4 border-l-2 pl-4 text-[14px] leading-relaxed text-mid" style={{ borderColor: "var(--bad)" }}>
            {comparison.reason}
          </p>
        )}

        <div className="mt-4 flex flex-col items-center gap-6 sm:flex-row sm:items-center sm:gap-10">
          <div className="shrink-0">
            <Gauge ratio={ratio} live={running} />
          </div>

          <div className="min-w-0 flex-1">
            {ratio === null ? (
              <p className="text-[14px] leading-relaxed text-mid">
                {!baseline
                  ? "Run the suite, then paste a runner result. Until both exist there is nothing to read."
                  : "Waiting on a runner result."}
              </p>
            ) : (
              <>
                <div className="dial text-[clamp(56px,14vw,116px)]" style={{ color: "var(--gap)" }}>
                  {ratio.toFixed(2)}×
                </div>
                <p className="mt-2 text-[14px] leading-relaxed text-mid">
                  longer for the runner to do the identical single-threaded work, against{" "}
                  <strong className="text-ink">
                    {baselineIsBrowser ? "this browser (indicative)" : "Node on your machine (exact)"}
                  </strong>
                  {comparison?.ok && comparison.parallelRatio !== null && (
                    <> — and <strong className="text-ink">{comparison.parallelRatio.toFixed(1)}×</strong> less
                    throughput with every core busy, which is the number a parallel test runner meets.</>
                  )}
                </p>
              </>
            )}
          </div>
        </div>

        {comparison?.ok && comparison.crossEngine && (
          <p className="mt-6 border-l-2 pl-4 text-[13px] leading-relaxed text-mid" style={{ borderColor: "var(--down)" }}>
            This browser runs {ENGINE_LABEL[comparison.crossEngine]} and the runner ran Node, which is V8.
            Part of that ratio is the engine rather than the machine. Chrome or Edge gives a like-for-like reading.
          </p>
        )}

        {comparison?.ok && (
          <>
            <div className="mt-8 space-y-2">
              <div className="plate mb-3">per workload</div>
              {comparison.byWorkload.map((w) => (
                <div key={w.id} className="flex items-center gap-4">
                  <span className="w-14 shrink-0 text-[13px]">{w.id}</span>
                  <div className="h-2 flex-1 bg-raised">
                    <div className="fill h-full" style={{ width: `${Math.min(100, (w.ratio / 6) * 100)}%`, background: "var(--gap)" }} />
                  </div>
                  <span className="num w-14 shrink-0 text-right text-[13px] text-mid">{w.ratio.toFixed(2)}×</span>
                </div>
              ))}
            </div>

            {comparison.rounds > 1 && (
              <div className="mt-8 inset p-4">
                <div className="plate">across {comparison.rounds} rounds</div>
                <p className="mt-2 text-[14px] leading-relaxed text-mid">
                  Fastest round <span className="num text-ink">{comparison.bestRound.toFixed(0)} ms</span>, slowest{" "}
                  <span className="num text-ink">{comparison.worstRound.toFixed(0)} ms</span> — a spread of{" "}
                  <span className="num" style={{ color: "var(--gap)" }}>{(comparison.betweenRounds * 100).toFixed(0)}%</span>{" "}
                  between jobs running identical work. Your machine varied {(baseline!.spread * 100).toFixed(0)}% across passes.
                </p>
              </div>
            )}
          </>
        )}
      </section>

      {/* ── 4. what it costs ─────────────────────────────────────────── */}
      <section className="card p-6 sm:p-8">
        <h2 className="plate">4 — what the gap costs</h2>
        <p className="mt-3 max-w-[62ch] text-[14px] leading-relaxed text-mid">
          The benchmark knows nothing about your tests, so this is driven by numbers you type. The
          rate is editable too: published prices go stale, and a stale price stated confidently is
          worse than no price.
        </p>

        <div className="mt-5 grid gap-px border border-line-soft bg-line-soft sm:grid-cols-3">
          <Field label="suite minutes, locally" value={suiteMin} onChange={setSuiteMin} step={0.5} />
          <Field label="runs per day" value={runsPerDay} onChange={setRunsPerDay} step={1} />
          <div className="bg-panel px-4 py-3">
            <div className="plate">rate · $/min</div>
            <div className="mt-2 flex gap-1">
              {RATES.map((r) => (
                <button key={r.id} onClick={() => setRateId(r.id)}
                  className="plate border px-2 py-1 transition-colors"
                  style={{
                    borderColor: rateId === r.id ? "var(--gap)" : "var(--line)",
                    color: rateId === r.id ? "var(--ink)" : "var(--ink-dim)",
                  }}>
                  {r.label}
                </button>
              ))}
            </div>
            <div className="num mt-2 text-[13px] text-mid">${rate.perMinute.toFixed(3)}/min</div>
          </div>
        </div>

        {cost ? (
          <div className="mt-px grid gap-px border border-line-soft bg-line-soft sm:grid-cols-3">
            <Cell k="on the runner" v={`${cost.runnerMinutes.toFixed(1)} min`} note={`+${cost.extraMinutesPerRun.toFixed(1)} per run`} tone />
            <Cell k="waiting, per month" v={`${cost.waitingHoursPerMonth.toFixed(0)} h`} note={`${cost.extraMinutesPerMonth.toFixed(0)} extra minutes`} tone />
            <Cell k="billed for the gap" v={`$${cost.extraCostPerMonth.toFixed(0)}`} note="per month, at the rate above" tone />
          </div>
        ) : (
          <p className="mt-5 text-[13px] text-dim">Needs a reading first.</p>
        )}
      </section>
    </div>
  );
}

function Cell({ k, v, note, tone }: { k: string; v: string; note?: string; tone?: boolean }) {
  return (
    <div className="bg-panel px-4 py-3">
      <div className="plate">{k}</div>
      <div className="num mt-1.5 text-[22px]" style={tone ? { color: "var(--gap)" } : undefined}>{v}</div>
      {note && <div className="mt-1 text-[12px] text-dim">{note}</div>}
    </div>
  );
}

function Field({ label, value, onChange, step }: {
  label: string; value: number; onChange: (n: number) => void; step: number;
}) {
  return (
    <div className="bg-panel px-4 py-3">
      <label className="plate block">{label}</label>
      <input
        type="number" min={0} step={step} value={value}
        onChange={(e) => onChange(Math.max(0, Number(e.target.value)))}
        className="num mt-1.5 w-full bg-transparent text-[22px] text-ink outline-none"
      />
    </div>
  );
}
