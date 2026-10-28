import Link from "next/link";
import { Bell, CheckCircle2, ShieldCheck, Trophy, TrendingUp, Wallet2 } from "lucide-react";
import { getSportByCode } from "@/lib/data/sports";
import { getCurrentSeason, listSeasons } from "@/lib/data/seasons";
import { listRounds, type Round } from "@/lib/data/rounds";
import { listGamesForRound } from "@/lib/data/games";
import { getCompetitionForRound } from "@/lib/data/competitions";
import { computeFirstGameKickoff, getEffectiveCompetitionState, hasFirstGameKickedOff, type EffectiveCompetitionState } from "@/lib/competitions/lifecycle";
import { RoundCard } from "@/components/round-card";
import { CustomerSidebar } from "@/components/customer-sidebar";
import { AccountBar } from "@/components/account-bar";
import { Countdown } from "@/components/countdown";
import { DateChip } from "@/components/date-chip";
import { getCurrentUserForPage } from "@/lib/auth/require";
import { getBalance } from "@/lib/data/wallet";
import { formatAuDateTime, formatAudCents } from "@/lib/utils/format";
import { SPORTS, type SportConfig } from "@/lib/sports/config";

interface SportRoundData {
  round: Round;
  gamesCount: number;
  entryFeeCents: number | null;
  effectiveState: EffectiveCompetitionState | null;
  prizePoolVisible: boolean;
  currentPrizePoolCents: number | null;
  firstGameKickoff: Date | null;
}

interface SportData {
  sport: SportConfig;
  rounds: SportRoundData[];
}

async function loadSportData(sport: SportConfig): Promise<SportData> {
  const sportResult = await getSportByCode(sport.code);
  if (sportResult.status === "unavailable" || !sportResult.data) return { sport, rounds: [] };

  const currentSeasonResult = await getCurrentSeason(sportResult.data.id);
  let season = currentSeasonResult.status === "ok" ? currentSeasonResult.data : null;
  if (!season) {
    const seasons = await listSeasons(sportResult.data.id);
    season = seasons.status === "ok" ? (seasons.data[0] ?? null) : null;
  }
  if (!season) return { sport, rounds: [] };

  const roundsResult = await listRounds(season.id);
  if (roundsResult.status === "unavailable" || roundsResult.data.length === 0) return { sport, rounds: [] };

  const rounds = await Promise.all(
    roundsResult.data.map(async (round): Promise<SportRoundData> => {
      const [competitionResult, gamesResult] = await Promise.all([
        getCompetitionForRound(sportResult.data!.id, round.id),
        listGamesForRound(round.id),
      ]);
      const games = gamesResult.status === "ok" ? gamesResult.data : [];
      const competition = competitionResult.status === "ok" ? competitionResult.data : null;
      const firstGameKickoff = computeFirstGameKickoff(games);
      const prizePoolVisible = hasFirstGameKickedOff(firstGameKickoff);
      return {
        round,
        gamesCount: games.length,
        entryFeeCents: competition?.entryFeeCents ?? null,
        effectiveState: competition ? getEffectiveCompetitionState(competition) : null,
        prizePoolVisible,
        currentPrizePoolCents: competition && prizePoolVisible ? competition.prizeAmountCents + competition.rolloverInCents : null,
        firstGameKickoff,
      };
    }),
  );

  return { sport, rounds };
}

/** The round this sport's card should reflect — mirrors the mobile Home screen's pickFeaturedRound exactly, so both platforms surface the same round for the same sport. */
function pickFeaturedRound(rounds: SportRoundData[]): SportRoundData | null {
  if (rounds.length === 0) return null;
  const upcoming = rounds.find((r) => !r.effectiveState || r.effectiveState === "open" || r.effectiveState === "not_yet_open");
  return upcoming ?? rounds[rounds.length - 1];
}

function cutoffTime(r: SportRoundData): number {
  return r.firstGameKickoff?.getTime() ?? Infinity;
}

function isOpenish(r: SportRoundData): boolean {
  return !r.effectiveState || r.effectiveState === "open" || r.effectiveState === "not_yet_open";
}

/** "revealed at kickoff" -> "REVEALED AT KICKOFF" for badge/pill contexts. */
function revealPill(sport: SportConfig): string {
  return sport.revealPhrase.toUpperCase();
}

export default async function Home() {
  const sportDataList = await Promise.all(Object.values(SPORTS).map((sport) => loadSportData(sport)));

  const featuredPerSport = sportDataList.map(({ sport, rounds }) => ({ sport, round: pickFeaturedRound(rounds) }));
  let featured: { sport: SportConfig; round: SportRoundData } | null = null;
  for (const entry of featuredPerSport) {
    if (!entry.round || !isOpenish(entry.round)) continue;
    if (!featured || cutoffTime(entry.round) < cutoffTime(featured.round)) featured = { sport: entry.sport, round: entry.round };
  }
  if (!featured) {
    const fallback = featuredPerSport.find((e) => e.round);
    if (fallback?.round) featured = { sport: fallback.sport, round: fallback.round };
  }

  const upcoming = sportDataList
    .flatMap(({ sport, rounds }) =>
      rounds
        .filter((r) => isOpenish(r) && !(featured && sport.code === featured.sport.code && r.round.id === featured.round.round.id))
        .map((r) => ({ sport, data: r })),
    )
    .sort((a, b) => cutoffTime(a.data) - cutoffTime(b.data))
    .slice(0, 4);

  return (
    <>
      {/* ============================== MOBILE / TABLET ============================== */}
      <div className="lg:hidden">
        <div className="mx-auto flex max-w-6xl items-center justify-end px-4 pt-4 sm:px-6">
          <span className="flex h-10 w-10 items-center justify-center rounded-full border border-border bg-surface text-muted">
            <Bell className="h-4 w-4" strokeWidth={1.75} />
          </span>
        </div>

        <section className="relative overflow-hidden bg-grid">
          <div className="pointer-events-none absolute inset-0 bg-gradient-to-b from-brand-soft via-transparent to-background" />
          <div className="relative mx-auto max-w-6xl px-4 py-16 sm:px-6 sm:py-24">
            <div className="max-w-2xl">
              <h1 className="text-4xl font-extrabold uppercase leading-tight tracking-tight text-foreground sm:text-6xl">
                Go Perfect.
                <br />
                <span className="text-brand-text">Take the entire pool.</span>
              </h1>
              <p className="mt-6 max-w-xl text-sm text-muted sm:text-base">
                No entries go perfect, pool rolls over to the following week. More than one entry goes perfect, split
                the pool evenly.
              </p>
              <div className="mt-8 flex flex-wrap items-center gap-3">
                {Object.values(SPORTS).map((s) => (
                  <Link
                    key={s.code}
                    href={`/${s.slug}`}
                    className="rounded-lg border border-brand/30 bg-brand-soft px-5 py-2.5 text-sm font-semibold text-brand-text transition-colors hover:border-brand hover:bg-brand hover:text-white"
                  >
                    Play {s.name} — $5
                  </Link>
                ))}
              </div>
            </div>
          </div>
        </section>

        <section className="mx-auto max-w-6xl px-4 py-16 sm:px-6">
          <div className="mb-6 flex items-baseline justify-between">
            <h2 className="text-xs font-bold uppercase tracking-wider text-foreground">Choose a Sport</h2>
            <Link href="/how-it-works" className="text-xs font-medium text-brand-text hover:underline">
              How it works &rarr;
            </Link>
          </div>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {featuredPerSport.map(({ sport, round }) => (
              <Link
                key={sport.code}
                href={`/${sport.slug}`}
                className="group rounded-xl border border-border bg-surface p-5 transition-colors hover:border-brand/30"
              >
                <span className="inline-flex h-10 w-10 items-center justify-center rounded-lg border border-brand/30 bg-brand-soft text-xs font-extrabold text-brand-text">
                  {sport.code.toUpperCase()}
                </span>
                <p className="mt-4 text-sm font-semibold text-foreground group-hover:text-brand-text">{sport.name}</p>
                <p className="mt-1 text-xs text-muted">
                  {round ? (round.round.name ?? `Round ${round.round.roundNumber}`) : "No rounds yet"}
                </p>
                {round && (
                  <p className="mt-2 text-xs text-muted-2">
                    {round.gamesCount} {round.gamesCount === 1 ? "game" : "games"}
                  </p>
                )}
                {round && round.prizePoolVisible && round.currentPrizePoolCents !== null ? (
                  <p className="mt-1 text-sm font-bold text-brand-text">{formatAudCents(round.currentPrizePoolCents)}</p>
                ) : (
                  <p className="mt-1 inline-block rounded border border-border bg-surface-raised px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-muted">
                    {revealPill(sport)}
                  </p>
                )}
              </Link>
            ))}
          </div>
        </section>

        {featured && (
          <section className="mx-auto max-w-6xl px-4 pb-16 sm:px-6">
            <div className="rounded-2xl border border-brand/30 bg-surface p-6 sm:p-8">
              <div className="flex flex-wrap items-start justify-between gap-6">
                <div className="flex items-start gap-4">
                  <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg border border-brand/30 bg-brand-soft text-xs font-extrabold text-brand-text">
                    {featured.sport.code.toUpperCase()}
                  </span>
                  <div>
                    <p className="text-lg font-bold text-foreground">
                      {featured.sport.name} — {featured.round.round.name ?? `Round ${featured.round.round.roundNumber}`}
                    </p>
                    <p className="mt-1 text-xs text-muted">
                      {featured.round.gamesCount} {featured.round.gamesCount === 1 ? "game" : "games"}
                      {featured.round.firstGameKickoff && ` · Picks lock ${formatAuDateTime(featured.round.firstGameKickoff)}`}
                    </p>
                  </div>
                </div>
                {featured.round.firstGameKickoff && !featured.round.prizePoolVisible && (
                  <Countdown target={featured.round.firstGameKickoff} />
                )}
              </div>
              <div className="mt-6 flex flex-wrap items-end justify-between gap-6">
                <div>
                  <p className="text-xs uppercase tracking-wide text-muted">Prize Pool</p>
                  {featured.round.prizePoolVisible && featured.round.currentPrizePoolCents !== null ? (
                    <p className="text-2xl font-extrabold text-brand-text">{formatAudCents(featured.round.currentPrizePoolCents)}</p>
                  ) : (
                    <p className="mt-1 inline-block rounded border border-border bg-surface-raised px-2 py-1 text-xs font-bold uppercase tracking-wide text-muted">
                      {revealPill(featured.sport)}
                    </p>
                  )}
                </div>
                <Link
                  href={`/${featured.sport.slug}/rounds/${featured.round.round.id}/enter`}
                  className="rounded-lg bg-brand px-5 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-brand-strong"
                >
                  Make Your Picks &rarr;
                </Link>
              </div>
            </div>
          </section>
        )}

        <section className="mx-auto max-w-6xl px-4 pb-16 sm:px-6">
          <div className="grid gap-4 sm:grid-cols-2">
            <Link
              href="/how-it-works"
              className="flex items-center gap-4 rounded-xl border border-border bg-surface p-5 transition-colors hover:border-brand/30"
            >
              <Trophy className="h-5 w-5 text-brand-text" strokeWidth={1.75} />
              <div>
                <p className="text-sm font-semibold text-foreground">How it Works</p>
                <p className="text-xs text-muted">Simple. Pick. Play. Go Perfect.</p>
              </div>
            </Link>
            <Link
              href="/how-it-works#rules"
              className="flex items-center gap-4 rounded-xl border border-border bg-surface p-5 transition-colors hover:border-brand/30"
            >
              <Wallet2 className="h-5 w-5 text-brand-text" strokeWidth={1.75} />
              <div>
                <p className="text-sm font-semibold text-foreground">Rules &amp; FAQ</p>
                <p className="text-xs text-muted">Every sport, its own separate pool.</p>
              </div>
            </Link>
          </div>
        </section>

        {upcoming.length > 0 && (
          <section className="mx-auto max-w-6xl px-4 pb-20 sm:px-6">
            <div className="mb-6 flex items-baseline justify-between">
              <h2 className="text-xs font-bold uppercase tracking-wider text-foreground">Upcoming Competitions</h2>
            </div>
            <div className="space-y-3">
              {upcoming.map(({ sport, data }) => (
                <RoundCard
                  key={`${sport.code}-${data.round.id}`}
                  round={data.round}
                  sportSlug={sport.slug}
                  gamesTotal={data.gamesCount}
                  prizePoolVisible={data.prizePoolVisible}
                  currentPrizePoolCents={data.currentPrizePoolCents}
                  revealPhrase={revealPill(sport)}
                />
              ))}
            </div>
          </section>
        )}

        <section className="mx-auto max-w-6xl px-4 pb-20 sm:px-6">
          <div className="grid gap-6 sm:grid-cols-3">
            <div className="rounded-xl border border-border bg-surface p-6">
              <ShieldCheck className="h-5 w-5 text-brand-text" strokeWidth={1.75} />
              <h3 className="mt-4 text-sm font-semibold text-foreground">Pick one player, every game</h3>
              <p className="mt-2 text-sm text-muted">
                For every game in the round, pick the one player you think will score — a try scorer for NRL, a goal
                scorer for AFL, 25+ points for NBA, a touchdown scorer for NFL. Any position, any player from either
                team.
              </p>
            </div>
            <div className="rounded-xl border border-border bg-surface p-6">
              <TrendingUp className="h-5 w-5 text-brand-text" strokeWidth={1.75} />
              <h3 className="mt-4 text-sm font-semibold text-foreground">Get every pick right</h3>
              <p className="mt-2 text-sm text-muted">
                Your pick needs to score for that game to be Perfect. There are no points and no leaderboard —
                it&apos;s a straight correct or incorrect on every selection.
              </p>
            </div>
            <div className="rounded-xl border border-border bg-surface p-6">
              <CheckCircle2 className="h-5 w-5 text-brand-text" strokeWidth={1.75} />
              <h3 className="mt-4 text-sm font-semibold text-foreground">Go PERFECT. Take the entire pool.</h3>
              <p className="mt-2 text-sm text-muted">
                Get every game in the round PERFECT and your entry takes the entire pool. More than one PERFECT
                entry? The pool is split evenly. Miss one pick anywhere in the round, and it isn&apos;t PERFECT.
              </p>
            </div>
          </div>
        </section>
      </div>

      {/* ================================= DESKTOP ================================= */}
      <div className="hidden lg:block lg:pl-60">
        <CustomerSidebar />

        <div className="flex justify-end px-8 pt-6">
          <AccountBar />
        </div>

        {/* Hero */}
        <section className="relative mx-8 mt-4 overflow-hidden rounded-2xl border border-border bg-grid">
          <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_top_right,rgba(215,38,28,0.14),transparent_60%)]" />
          <div className="pointer-events-none absolute inset-0 bg-gradient-to-r from-background via-background/70 to-transparent" />
          <div className="relative px-10 py-14">
            <h1 className="text-5xl font-extrabold uppercase leading-[1.05] tracking-tight text-foreground xl:text-6xl">
              Go Perfect.
              <br />
              <span className="text-brand-text">Take the entire pool.</span>
            </h1>
            <p className="mt-5 max-w-md text-sm text-muted">
              No entries go perfect, pool rolls over to the following week. More than one entry goes perfect, split
              the pool evenly.
            </p>
          </div>
        </section>

        {/* Choose a sport + promo */}
        <section className="px-8 pt-10">
          <h2 className="text-xs font-bold uppercase tracking-wider text-foreground">Choose a Sport</h2>
          <div className="mt-4 grid grid-cols-5 gap-4">
            {featuredPerSport.map(({ sport, round }) => (
              <Link
                key={sport.code}
                href={`/${sport.slug}`}
                className="group flex flex-col items-center rounded-xl border border-border bg-surface px-4 py-6 text-center transition-colors hover:border-brand/30"
              >
                <span className="flex h-12 w-12 items-center justify-center rounded-lg border border-brand/30 bg-brand-soft text-sm font-extrabold text-brand-text">
                  {sport.code.toUpperCase()}
                </span>
                <p className="mt-4 text-sm font-bold text-foreground group-hover:text-brand-text">{sport.name}</p>
                <p className="mt-1 text-xs text-muted">
                  {round ? (round.round.name ?? `Round ${round.round.roundNumber}`) : "No rounds yet"}
                </p>
                {round && round.prizePoolVisible && round.currentPrizePoolCents !== null ? (
                  <p className="mt-3 text-lg font-extrabold text-brand-text">{formatAudCents(round.currentPrizePoolCents)}</p>
                ) : (
                  <p className="mt-3 rounded border border-border bg-surface-raised px-2 py-1 text-[10px] font-bold uppercase tracking-wide text-muted">
                    {revealPill(sport)}
                  </p>
                )}
                {round && !(round.prizePoolVisible && round.currentPrizePoolCents !== null) && (
                  <p className="mt-1 text-[11px] text-muted-2">Prize Pool</p>
                )}
              </Link>
            ))}
            <Link
              href="/how-it-works"
              className="flex flex-col justify-center rounded-xl border border-brand/30 bg-gradient-to-br from-brand-soft to-transparent px-5 py-6"
            >
              <p className="text-base font-extrabold uppercase leading-snug text-foreground">
                One Pick
                <br />
                From Every Game.
                <br />
                <span className="text-brand-text">Win Big.</span>
              </p>
              <span className="mt-4 text-xs font-bold text-brand-text">Learn More &rarr;</span>
            </Link>
          </div>
        </section>

        {/* Featured competition + side cards */}
        {featured && (
          <section className="grid grid-cols-3 gap-4 px-8 pt-8">
            <div className="relative col-span-2 overflow-hidden rounded-2xl border border-brand/30 bg-surface p-8">
              <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_bottom,rgba(215,38,28,0.10),transparent_65%)]" />
              <div className="relative flex flex-wrap items-start justify-between gap-6">
                <div className="flex items-start gap-4">
                  <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg border border-brand/30 bg-brand-soft text-xs font-extrabold text-brand-text">
                    {featured.sport.code.toUpperCase()}
                  </span>
                  <div>
                    <p className="text-lg font-bold text-foreground">
                      {featured.sport.name} — {featured.round.round.name ?? `Round ${featured.round.round.roundNumber}`}
                    </p>
                    <p className="mt-1 text-xs uppercase tracking-wide text-muted">
                      {featured.round.gamesCount} {featured.round.gamesCount === 1 ? "game" : "games"} · picks lock
                      soon
                    </p>
                  </div>
                </div>
                {featured.round.firstGameKickoff && !featured.round.prizePoolVisible && (
                  <Countdown target={featured.round.firstGameKickoff} />
                )}
              </div>
              <div className="relative mt-8 flex flex-wrap items-end justify-between gap-6">
                <div>
                  <p className="text-xs uppercase tracking-wide text-muted">Prize Pool</p>
                  {featured.round.prizePoolVisible && featured.round.currentPrizePoolCents !== null ? (
                    <p className="text-4xl font-extrabold text-brand-text">{formatAudCents(featured.round.currentPrizePoolCents)}</p>
                  ) : (
                    <p className="mt-1 inline-block rounded border border-border bg-surface-raised px-2 py-1 text-xs font-bold uppercase tracking-wide text-muted">
                      {revealPill(featured.sport)}
                    </p>
                  )}
                </div>
                <Link
                  href={`/${featured.sport.slug}/rounds/${featured.round.round.id}/enter`}
                  className="rounded-full bg-brand px-8 py-3.5 text-sm font-bold text-white transition-colors hover:bg-brand-strong"
                >
                  Make Your Picks &rarr;
                </Link>
              </div>
            </div>

            <div className="flex flex-col gap-4">
              <Link
                href="/how-it-works"
                className="flex items-center gap-4 rounded-xl border border-border bg-surface p-5 transition-colors hover:border-brand/30"
              >
                <Trophy className="h-5 w-5 shrink-0 text-brand-text" strokeWidth={1.75} />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-bold uppercase text-foreground">How it Works</p>
                  <p className="text-xs text-muted">Simple. Pick. Play. Go Perfect.</p>
                </div>
              </Link>
              <AccountWalletCard />
            </div>
          </section>
        )}

        {/* Upcoming competitions */}
        {upcoming.length > 0 && (
          <section className="px-8 py-10">
            <div className="mb-4 flex items-baseline justify-between">
              <h2 className="text-xs font-bold uppercase tracking-wider text-foreground">Upcoming Competitions</h2>
              <Link href="/nrl" className="text-xs font-bold text-brand-text hover:underline">
                View All &rarr;
              </Link>
            </div>
            <div className="grid grid-cols-4 gap-4">
              {upcoming.map(({ sport, data }) => (
                <Link
                  key={`${sport.code}-${data.round.id}`}
                  href={`/${sport.slug}/rounds/${data.round.id}`}
                  className="flex flex-col rounded-xl border border-border bg-surface p-4 transition-colors hover:border-brand/30"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-brand/30 bg-brand-soft text-[10px] font-extrabold text-brand-text">
                        {sport.code.toUpperCase()}
                      </span>
                      <div>
                        <p className="text-sm font-bold text-foreground">
                          {sport.name} – {data.round.name ?? `Round ${data.round.roundNumber}`}
                        </p>
                        <p className="text-xs text-muted">
                          {data.gamesCount} {data.gamesCount === 1 ? "game" : "games"}
                        </p>
                      </div>
                    </div>
                    {data.round.startDate && <DateChip date={new Date(data.round.startDate)} />}
                  </div>
                  <div className="mt-3">
                    {data.prizePoolVisible && data.currentPrizePoolCents !== null ? (
                      <p className="text-sm font-bold text-brand-text">{formatAudCents(data.currentPrizePoolCents)}</p>
                    ) : (
                      <p className="inline-block rounded border border-border bg-surface-raised px-2 py-1 text-[10px] font-bold uppercase tracking-wide text-muted">
                        {revealPill(sport)}
                      </p>
                    )}
                  </div>
                </Link>
              ))}
            </div>
          </section>
        )}
      </div>
    </>
  );
}

async function AccountWalletCard() {
  const user = await getCurrentUserForPage();
  let balanceCents: number | null = null;
  if (user) {
    const result = await getBalance(user.id);
    if (result.status === "ok") balanceCents = result.data;
  }

  return (
    <Link
      href="/how-it-works"
      className="flex items-center gap-4 rounded-xl border border-border bg-surface p-5 transition-colors hover:border-brand/30"
    >
      <Wallet2 className="h-5 w-5 shrink-0 text-brand-text" strokeWidth={1.75} />
      <div className="min-w-0 flex-1">
        <p className="text-sm font-bold uppercase text-foreground">My Wallet</p>
        <p className="text-xs font-bold text-brand-text">{balanceCents !== null ? formatAudCents(balanceCents) : "Log in to view balance"}</p>
      </div>
    </Link>
  );
}
