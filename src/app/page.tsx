import Dyno from "@/components/Dyno";

export default function Page() {
  return (
    <main className="mx-auto max-w-3xl px-5 py-14 sm:py-20">
      <header>
        <h1 className="dial text-[clamp(44px,11vw,84px)]">LOANER</h1>
        <p className="mt-3 max-w-[54ch] text-[17px] leading-snug text-mid">
          How slow is the machine you rent?
        </p>
      </header>

      <section className="mt-12 max-w-[64ch] space-y-4 text-[15px] leading-relaxed text-mid">
        <p>
          “AI coding has made CI a bottleneck” reached the front page of Hacker News with roughly as
          many comments as points. Underneath the argument about agents, the same complaint kept
          surfacing, from people who had clearly been living with it:
        </p>

        <figure className="space-y-3 border-l-2 border-line py-1 pl-5 text-ink">
          <blockquote className="text-[14.5px] leading-relaxed">
            “I wonder why larger companies don’t use self hosted github runners… tests will run
            faster than on any hosted platform.”
          </blockquote>
          <blockquote className="text-[14.5px] leading-relaxed">
            “all CI providers I’ve had the pleasure of working with have gnarly performance profiles
            for the boxes they provide… the people who sell me the CI coordination software also
            sell me the minutes.”
          </blockquote>
          <blockquote className="text-[14.5px] leading-relaxed">
            “self-hosted runners are basement bin servers on clearly massively oversubscribed
            machines.”
          </blockquote>
        </figure>

        <p>
          Three people, three assertions, one shared conviction: the rented box is slow and you
          never get the same one twice. In a thread of two hundred comments{" "}
          <strong className="text-ink">nobody posted a number</strong>. Search further and you find
          vendors selling faster runners, each advertising a multiple against a baseline none of
          them publishes.
        </p>

        <p className="text-ink">
          So this measures it. The same four workloads run in your browser and on your runner, and
          the dial reads the difference.
        </p>
      </section>

      <div className="mt-12">
        <Dyno />
      </div>

      {/* The caveats belong on the instrument, not in a footnote nobody reads. */}
      <section className="mt-12 max-w-[64ch] space-y-4 border-t border-line pt-8 text-[14px] leading-relaxed text-mid">
        <h2 className="plate">what this is not</h2>
        <p>
          <strong className="text-ink">A benchmark is not your test suite.</strong> These four
          workloads — scanning source, churning objects, hashing bytes, sorting strings — are the
          shapes that fill CI minutes, but your pipeline also waits on the network, on Docker layers
          and on a cold dependency cache, and none of that is measured here. A 3× reading means this
          box does this work 3× slower. It does not mean your build takes 3× longer.
        </p>
        <p>
          <strong className="text-ink">A browser is not a fair stand-in for Node.</strong> This was
          meant to be a footnote about sandboxing and background tabs. Measured, it was not small.
          On the machine this was built on, Node held steady at about{" "}
          <span className="num text-ink">272 ms</span> across every run. The browser, on the same
          silicon running the same code, gave <span className="num text-ink">1,211 ms</span> once
          and <span className="num text-ink">3,997 ms</span> another time — somewhere between{" "}
          <strong className="text-ink">4.5× and 15× slower</strong>, depending on nothing the page
          could see. The per-workload spread was wider still: sorting strings matched Node almost
          exactly, while hashing bytes ran eleven times slower.
        </p>
        <p>
          So a browser-against-runner ratio would blame the hardware for the browser, by a factor it
          cannot pin down. That is why the exact path is <strong className="text-ink">Node against
          Node</strong> — the identical file on both machines — and why a browser reading is labelled
          indicative everywhere it is used.
        </p>
        <p>
          <strong className="text-ink">Engines differ too.</strong> The runner side is Node, which is
          V8. Chrome and Edge are V8; Safari and Firefox are not. When a browser reading is the
          baseline the page names the engine on the result rather than folding it into the ratio —
          and paste a local Node result and the question stops mattering.
        </p>
        <p>
          <strong className="text-ink">Checksums are enforced.</strong> Every workload returns one,
          and if the two sides disagree the comparison is refused instead of shown. A ratio between
          machines that ran different work looks exactly like a measurement, which is what makes it
          worse than nothing.
        </p>
      </section>

      <footer className="mt-10 flex flex-wrap items-baseline justify-between gap-x-6 gap-y-2 border-t border-line pt-6">
        <span className="plate">no account · no upload · nothing leaves the page</span>
        <a href="https://github.com/nickzsche21/loaner" className="plate hover:text-ink">source</a>
      </footer>
    </main>
  );
}
