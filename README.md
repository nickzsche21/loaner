# LOANER

**How slow is the machine you rent?**

The same four workloads run on your machine and on your CI runner, and the dial reads the gap.

---

## Why measure rather than assert

“AI coding has made CI a bottleneck” reached the HN front page with roughly as many comments as
points. Underneath the argument about agents, the same complaint kept surfacing:

> “I wonder why larger companies don’t use self hosted github runners… tests will run faster than
> on any hosted platform.”

> “all CI providers I’ve had the pleasure of working with have gnarly performance profiles for the
> boxes they provide… the people who sell me the CI coordination software also sell me the minutes.”

> “self-hosted runners are basement bin servers on clearly massively oversubscribed machines.”

Three assertions, one conviction: the rented box is slow and you never get the same one twice. In
two hundred comments **nobody posted a number**, and the vendors selling faster runners each
advertise a multiple against a baseline none of them publishes. So this measures it.

## How it works

`src/lib/bench.mjs` holds four workloads chosen because they are the shapes that fill CI minutes —
scanning source text, churning objects through the collector, hashing bytes, sorting strings. It is
seeded, integer-only, and every workload returns a checksum.

That one file runs on both sides. `public/runner.mjs` is **generated** from it (`npm run prebuild`),
never written alongside it, because the moment the two drift the checksums stop matching and every
comparison becomes a refusal. A test asserts the generated file is current and that a real
subprocess run agrees with the in-process one.

```bash
curl -fsSL https://<site>/runner.mjs -o loaner.mjs && node loaner.mjs
```

## The thing I got wrong

The plan was: run it in your browser, run it on your runner, compare. A footnote would cover
sandboxing.

Measured, the footnote was the story. On the machine this was built on, Node held steady at about
**272 ms** across every run. The browser, same silicon and same code, gave **1,211 ms** once and
**3,997 ms** another time — between **4.5× and 15× slower**, varying by a factor of three between
runs while Node did not move. The per-workload spread was wider still: sorting strings matched Node
almost exactly, hashing bytes ran **eleven times** slower.

A browser-against-runner ratio would have blamed the hardware for the browser, and inconsistently.
So the exact path is **Node against Node** — the identical file on both machines — and the browser
reading stays, labelled indicative, because it costs nothing and makes the page something other than
an empty box. Paste a local Node result and the page switches baselines and tells you what your
browser was costing.

## What it refuses to do

- **Mismatched checksums** — no ratio. Two machines that ran different work produce a number that
  looks exactly like a measurement, which is what makes it worse than nothing.
- **Mismatched suite versions** — no ratio.
- **Off-V8 browsers** — still compares, but names the engine on the reading rather than folding it
  into the ratio.

The parallel integrity check originally passed while checking nothing: XOR-ing one thread's checksum
an even number of times is zero, and `h ^ h+1 ^ h+2 ^ h+3` is zero for any `h` divisible by four —
which this checksum is. It now mixes with multiply-accumulate and compares shares elementwise.

## What it is not

A benchmark is not your test suite. A 3× reading means this box does *this work* 3× slower; your
pipeline also waits on the network, on Docker layers and on a cold cache, and none of that is here.
The cost projection is driven by numbers you type, and the per-minute rate is editable, because a
stale price stated confidently is worse than no price.

```bash
npm install
npm test      # 55 assertions, including the generated-runner drift guard
npm run dev
```

`ci/bench.yml` is a workflow that runs the suite across a matrix of hosted runners and rounds. It
lives outside `.github/workflows` because the token that pushed this repo lacks the `workflow`
scope; move it there to use it.

Nothing leaves your browser. MIT.
