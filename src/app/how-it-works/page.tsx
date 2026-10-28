import Link from "next/link";

export const metadata = {
  title: "How Perfect Play works",
};

export default function HowItWorksPage() {
  return (
    <div className="mx-auto max-w-3xl px-4 py-16 sm:px-6">
      <h1 className="text-2xl font-bold tracking-tight text-foreground sm:text-3xl">
        How Perfect Play works
      </h1>
      <p className="mt-4 text-sm text-muted">
        Perfect Play is a prediction competition: pick the Perfect Round. Get every pick right, go
        PERFECT, and take the entire pool. There are no points and no leaderboard — every outcome is
        a straight correct or incorrect.
      </p>

      <div className="mt-10 space-y-8">
        <section>
          <h2 className="text-base font-semibold text-foreground">1. Pick your players</h2>
          <p className="mt-2 text-sm text-muted">
            Choose one player from every game in the round: a try scorer for NRL, a goal scorer for
            AFL, a player to score 25+ points for NBA, or a touchdown scorer for NFL. There&apos;s no
            position restriction — any eligible player from either team.
          </p>
        </section>
        <section>
          <h2 className="text-base font-semibold text-foreground">2. Choose your entries</h2>
          <p className="mt-2 text-sm text-muted">
            Play 1, 5, or 10 entries. Buying more entries never means making more picks — you make
            one set of picks, once, and choose how many entries play with it.
          </p>
        </section>
        <section>
          <h2 className="text-base font-semibold text-foreground">3. Same picks</h2>
          <p className="mt-2 text-sm text-muted">
            Every entry in your package uses the exact same picks. If you buy 10 entries, all 10 use
            the same selections — never 10 different combinations. Each entry still settles and
            wins independently.
          </p>
        </section>
        <section>
          <h2 className="text-base font-semibold text-foreground">4. Go PERFECT</h2>
          <p className="mt-2 text-sm text-muted">
            Get every selection correct. Once a game finishes, your pick is settled: correct if that
            player hit the sport&apos;s required statistic, otherwise incorrect. One incorrect
            selection anywhere in the round means the entry is{" "}
            <span className="font-semibold text-foreground">not perfect</span> — there&apos;s no
            partial credit. Until every game in the round has finished, an entry sits at pending.
          </p>
        </section>
        <section>
          <h2 className="text-base font-semibold text-foreground">5. Take the pool</h2>
          <p className="mt-2 text-sm text-muted">
            An entry goes <span className="font-semibold text-brand">PERFECT</span> only once every
            selection in it is correct, and takes a share of the Prize Pool. If more than one entry
            goes PERFECT, the Prize Pool is split evenly between every PERFECT entry — a customer
            holding several PERFECT entries gets that many shares.
          </p>
        </section>
        <section>
          <h2 className="text-base font-semibold text-foreground">6. No PERFECT?</h2>
          <p className="mt-2 text-sm text-muted">
            If no entry goes PERFECT, the Prize Pool rolls over to the next applicable competition
            for that sport.
          </p>
        </section>
        <section id="rules">
          <h2 className="text-base font-semibold text-foreground">Every sport is a separate competition</h2>
          <p className="mt-2 text-sm text-muted">
            NRL, AFL, NBA and NFL each run as their own $5-entry competition, with their own
            entries, results, and prize pool — enter one for $5, or all of them. They&apos;re never
            combined: an entry in one sport only affects that sport&apos;s results.
          </p>
        </section>
        <section>
          <h2 className="text-base font-semibold text-foreground">Where the data comes from</h2>
          <p className="mt-2 text-sm text-muted">
            Perfect Play never fabricates results. Every pick is settled from real statistics data.
            Until a live data source is connected, rounds without that data are clearly marked as
            unavailable rather than shown with invented results.
          </p>
        </section>
        <section>
          <h2 className="text-base font-semibold text-foreground">Eligibility &amp; responsible play</h2>
          <p className="mt-2 text-sm text-muted">
            Eligibility and participation requirements apply. Licensed operator details will appear
            here. Final terms are subject to regulatory and legal approval. See{" "}
            <Link href="/terms" className="text-brand hover:underline">
              Terms &amp; Conditions
            </Link>{" "}
            for full detail.
          </p>
        </section>
      </div>
    </div>
  );
}
