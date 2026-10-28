/**
 * Perfect Play database schema.
 *
 * Sports-data hierarchy: Sport -> Season -> Round -> Game -> Teams -> Players -> Player game stats.
 *
 * Competition hierarchy: Competition (sport-scoped, e.g. "Perfect Play NRL") -> Entry (a user's
 * paid entry into one round of that competition) -> Selection (a game within that entry, with
 * the user's 2 picked players) -> per-selection result -> overall entry result. Perfect Play has
 * no points system: every outcome is the tri-state pending/correct/incorrect (per selection) or
 * pending/perfect/not_perfect (per entry), computed by application logic (see src/lib/perfect2),
 * never stored as an opinion.
 */
import {
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  serial,
  text,
  timestamp,
  date,
  unique,
  varchar,
} from "drizzle-orm/pg-core";

/* -------------------------------------------------------------------------- */
/* Sports & competition structure                                             */
/* -------------------------------------------------------------------------- */

export const sports = pgTable("sports", {
  id: serial("id").primaryKey(),
  /** Stable machine key, e.g. "nrl" | "afl". Used to look up the calculation rule. */
  code: varchar("code", { length: 16 }).notNull().unique(),
  name: text("name").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const seasons = pgTable(
  "seasons",
  {
    id: serial("id").primaryKey(),
    sportId: integer("sport_id")
      .notNull()
      .references(() => sports.id, { onDelete: "cascade" }),
    year: integer("year").notNull(),
    label: text("label").notNull(),
    isCurrent: boolean("is_current").notNull().default(false),
    /** ID from the upstream sports-data provider, once connected — the idempotent sync key. */
    externalId: varchar("external_id", { length: 64 }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique("seasons_sport_year_unique").on(t.sportId, t.year),
    unique("seasons_external_id_unique").on(t.externalId),
  ],
);

export const teams = pgTable(
  "teams",
  {
    id: serial("id").primaryKey(),
    sportId: integer("sport_id")
      .notNull()
      .references(() => sports.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    shortName: varchar("short_name", { length: 8 }).notNull(),
    slug: varchar("slug", { length: 64 }).notNull(),
    primaryColor: varchar("primary_color", { length: 16 }),
    logoUrl: text("logo_url"),
    /** ID from the upstream sports-data provider, once connected — the idempotent sync key. */
    externalId: varchar("external_id", { length: 64 }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique("teams_sport_slug_unique").on(t.sportId, t.slug),
    unique("teams_external_id_unique").on(t.externalId),
  ],
);

export const roundStatusValues = ["upcoming", "in_progress", "completed"] as const;
export type RoundStatus = (typeof roundStatusValues)[number];

export const rounds = pgTable(
  "rounds",
  {
    id: serial("id").primaryKey(),
    seasonId: integer("season_id")
      .notNull()
      .references(() => seasons.id, { onDelete: "cascade" }),
    roundNumber: integer("round_number").notNull(),
    name: text("name"),
    startDate: date("start_date"),
    endDate: date("end_date"),
    status: varchar("status", { length: 16 }).notNull().default("upcoming").$type<RoundStatus>(),
    /** ID from the upstream sports-data provider, once connected — the idempotent sync key. */
    externalId: varchar("external_id", { length: 64 }),
    /**
     * Phase 22: marks this round as a sport's rolling "schedule pool" rather than a real
     * customer-facing Perfect Play round — synced-but-not-yet-curated real games land here
     * (see src/lib/data/schedule-pool.ts) until an admin assigns them into a real round.
     * Never used for entries; false/unused for NRL/AFL, which use every game in a round.
     */
    isSchedulePool: boolean("is_schedule_pool").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique("rounds_season_number_unique").on(t.seasonId, t.roundNumber),
    unique("rounds_external_id_unique").on(t.externalId),
  ],
);

/**
 * "postponed"/"cancelled" added in Phase 22 (NBA) — a real game can genuinely not happen
 * as scheduled. Neither is ever treated as "final": settlement never infers a result from
 * a game that didn't happen (see src/lib/perfect2/settle.ts's "void" selection result and
 * docs/phase22-nba-integration.md's admin resolution process).
 */
export const gameStatusValues = ["scheduled", "live", "final", "postponed", "cancelled"] as const;
export type GameStatus = (typeof gameStatusValues)[number];

export const games = pgTable(
  "games",
  {
    id: serial("id").primaryKey(),
    roundId: integer("round_id")
      .notNull()
      .references(() => rounds.id, { onDelete: "cascade" }),
    homeTeamId: integer("home_team_id")
      .notNull()
      .references(() => teams.id),
    awayTeamId: integer("away_team_id")
      .notNull()
      .references(() => teams.id),
    kickoff: timestamp("kickoff", { withTimezone: true }),
    venue: text("venue"),
    status: varchar("status", { length: 16 }).notNull().default("scheduled").$type<GameStatus>(),
    homeScore: integer("home_score"),
    awayScore: integer("away_score"),
    externalId: varchar("external_id", { length: 64 }),
    /** Phase 22: which Perfect Play round "slot" this game was curated into (e.g. "thursday"). Null/unused for NRL/AFL. */
    slotLabel: varchar("slot_label", { length: 16 }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique("games_external_id_unique").on(t.externalId),
    // listGamesForRound's WHERE roundId = X is the single hottest read in the app — hit on
    // every entry creation, every round page view, and every settlement run. Confirmed via
    // EXPLAIN (Phase 23I load audit) that this was a Seq Scan with no index at all before
    // this fix; trivial at today's row counts but grows linearly with every game ever
    // synced, across every sport/season, forever.
    index("games_round_id_idx").on(t.roundId),
  ],
);

/**
 * NBA/NFL automated 8-game round selection — one row per (sportId, seasonId, roundNumber)
 * being built, created the moment an admin generates a selection, BEFORE the real `rounds`
 * row exists. This deliberate separation is what lets an admin review a generated
 * selection without it being customer-visible yet: the real round (and its games'
 * `roundId` reassignment out of the schedule pool — see schedule-pool.ts) is only ever
 * created at LOCK time, reusing the exact same createRound/assignCandidatesToRound path
 * the existing manual round-builder already uses. NRL/AFL never use this table — their
 * round-shape is unconstrained (round-shape.ts), so "randomly pick exactly 8" doesn't
 * apply to them, and their existing manual admin flow is completely untouched.
 *
 * The (sportId, seasonId, roundNumber) unique constraint IS the idempotency/concurrency
 * mechanism: a second "generate" call for the same round is a plain insert conflict, so
 * the caller re-reads and returns the row that already exists instead of generating a
 * second seed/selection (see src/lib/data/auto-round-selection.ts).
 */
export const gameSelectionStatusValues = ["generated", "locked"] as const;
export type GameSelectionStatus = (typeof gameSelectionStatusValues)[number];

export const roundGameSelections = pgTable(
  "round_game_selections",
  {
    id: serial("id").primaryKey(),
    sportId: integer("sport_id")
      .notNull()
      .references(() => sports.id, { onDelete: "cascade" }),
    seasonId: integer("season_id")
      .notNull()
      .references(() => seasons.id, { onDelete: "cascade" }),
    roundNumber: integer("round_number").notNull(),
    /** Always "auto" today — kept as a field (not a hardcoded assumption) in case a future sport needs a different mode. */
    mode: varchar("mode", { length: 16 }).notNull().default("auto"),
    /** Hex-encoded cryptographically-random seed (crypto.randomBytes) — the audit trail for exactly how the 8 games were chosen. Never derived from anything client-supplied. */
    seed: varchar("seed", { length: 64 }).notNull(),
    /** The locked-in selected game IDs (always length 8) — the round's authoritative game list once this row is read, independent of later schedule resyncs. */
    selectedGameIds: jsonb("selected_game_ids").notNull().$type<number[]>(),
    /**
     * For day-bucketed sports only (NBA today — see round-shape.ts's roundDays): the
     * Sydney-local calendar date of the Thursday that starts this selection's single
     * Thursday-Sunday window. Null for sports with no day shape (NFL). This is what lets
     * every round be pinned to exactly one real calendar week — never a scattered mix of
     * games from different weeks/months — and lets the generator cheaply find "the next
     * week after whatever the previous round used" without re-deriving it from game rows
     * every time. See src/lib/data/auto-round-selection.ts.
     */
    weekStartDate: date("week_start_date"),
    status: varchar("status", { length: 16 }).notNull().default("generated").$type<GameSelectionStatus>(),
    generatedAt: timestamp("generated_at", { withTimezone: true }).notNull().defaultNow(),
    generatedByUserId: integer("generated_by_user_id").references(() => users.id, { onDelete: "set null" }),
    lockedAt: timestamp("locked_at", { withTimezone: true }),
    lockedByUserId: integer("locked_by_user_id").references(() => users.id, { onDelete: "set null" }),
    /** Set only once locked — the real, now-customer-visible round this selection became. */
    roundId: integer("round_id").references(() => rounds.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique("round_game_selections_sport_season_round_unique").on(t.sportId, t.seasonId, t.roundNumber),
    // Defense-in-depth: two rounds for the same sport/season can never claim the same
    // Thursday-Sunday week. Postgres unique indexes never treat multiple NULLs as
    // duplicates, so this is a no-op for NFL (always null) and only bites for NBA.
    unique("round_game_selections_sport_season_week_unique").on(t.sportId, t.seasonId, t.weekStartDate),
  ],
);

/* -------------------------------------------------------------------------- */
/* Players, lineups & statistics                                              */
/* -------------------------------------------------------------------------- */

export const players = pgTable(
  "players",
  {
    id: serial("id").primaryKey(),
    sportId: integer("sport_id")
      .notNull()
      .references(() => sports.id, { onDelete: "cascade" }),
    /** Current team; historical team for a given game lives on game_lineups. */
    teamId: integer("team_id").references(() => teams.id, { onDelete: "set null" }),
    firstName: text("first_name").notNull(),
    lastName: text("last_name").notNull(),
    /** Primary/nominal position, e.g. "Winger", "Fullback". */
    position: varchar("position", { length: 32 }),
    externalId: varchar("external_id", { length: 64 }),
    /** Headshot/profile image URL from the sports-data provider, when it supplies one. */
    photoUrl: text("photo_url"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [unique("players_external_id_unique").on(t.externalId)],
);

/**
 * The named position a player took the field in for a specific game. Perfect Play selections
 * are NOT restricted by position — this data is for display only (showing users who's on
 * the field and what they play) and for determining which players are eligible to be
 * selected for a given game (anyone listed here, starting or interchange).
 */
export const gameLineups = pgTable(
  "game_lineups",
  {
    id: serial("id").primaryKey(),
    gameId: integer("game_id")
      .notNull()
      .references(() => games.id, { onDelete: "cascade" }),
    teamId: integer("team_id")
      .notNull()
      .references(() => teams.id),
    playerId: integer("player_id")
      .notNull()
      .references(() => players.id, { onDelete: "cascade" }),
    /** Position played in this specific game, e.g. "Winger", "Fullback", "Interchange". */
    position: varchar("position", { length: 32 }).notNull(),
    /** Nullable/unknown by default — only ever set when a provider actually reports a real starting-lineup signal. No current provider does pre-game, so this is null for NBA rather than a fabricated true (see nba-espn-provider.ts). */
    isStarting: boolean("is_starting"),
    /** Real provider-reported injury designation (OUT/DOUBTFUL/QUESTIONABLE/DAY_TO_DAY/PROBABLE) or null when none is reported — never fabricated. OUT is the only value that excludes a player from the eligible-player picker (src/lib/data/games.ts); every other value is display-only. */
    injuryStatus: varchar("injury_status", { length: 16 }),
    jumperNumber: integer("jumper_number"),
  },
  (t) => [unique("game_lineups_game_player_unique").on(t.gameId, t.playerId)],
);

/**
 * Per-player, per-game statistics. Common counting stats get dedicated columns for
 * fast, typed queries; `stats` holds any sport-specific extras without a migration.
 */
export const playerGameStats = pgTable(
  "player_game_stats",
  {
    id: serial("id").primaryKey(),
    gameId: integer("game_id")
      .notNull()
      .references(() => games.id, { onDelete: "cascade" }),
    playerId: integer("player_id")
      .notNull()
      .references(() => players.id, { onDelete: "cascade" }),
    teamId: integer("team_id")
      .notNull()
      .references(() => teams.id),
    tries: integer("tries").notNull().default(0),
    goals: integer("goals").notNull().default(0),
    /** Points — NBA's required stat (Phase 22), same "first-class dedicated column" treatment as tries/goals. */
    points: integer("points").notNull().default(0),
    /** Touchdowns — NFL's required stat (Phase 23F), same "first-class dedicated column" treatment as tries/goals/points. */
    touchdowns: integer("touchdowns").notNull().default(0),
    /** Sport-specific stats that don't warrant a dedicated column (e.g. AFL disposals). */
    stats: jsonb("stats").$type<Record<string, number>>(),
  },
  (t) => [unique("player_game_stats_game_player_unique").on(t.gameId, t.playerId)],
);

/* -------------------------------------------------------------------------- */
/* Users                                                                      */
/* -------------------------------------------------------------------------- */

export const users = pgTable("users", {
  id: serial("id").primaryKey(),
  email: varchar("email", { length: 320 }).notNull().unique(),
  name: text("name"),
  /**
   * First-party password hash — `scrypt` salt:hash hex, see src/lib/auth/password.ts.
   * Nullable so a future external-provider-only user (no first-party password) can still
   * exist. Never store or log the plaintext password anywhere.
   */
  passwordHash: varchar("password_hash", { length: 255 }),
  /** Set once an external auth provider (e.g. Sign in with Apple, Google) is wired up. */
  authProviderId: varchar("auth_provider_id", { length: 128 }),
  /**
   * Internal-operator flag for the admin dashboard (Phase 18) — reuses the existing
   * users/sessions authentication system rather than a second one. Defaults false for
   * every row; nobody is an admin unless explicitly set directly in the database.
   */
  isAdmin: boolean("is_admin").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/**
 * Opaque bearer session tokens — shared by the web app (as an httpOnly cookie) and the
 * mobile app (stored in Expo SecureStore, sent as an Authorization: Bearer header). Only
 * a SHA-256 hash of the token is ever stored, so a database read alone can't be used to
 * impersonate a session. See src/lib/auth/session.ts.
 */
export const sessions = pgTable("sessions", {
  id: serial("id").primaryKey(),
  userId: integer("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  tokenHash: varchar("token_hash", { length: 64 }).notNull().unique(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
});

/* -------------------------------------------------------------------------- */
/* Competitions, entries & selections                                        */
/*                                                                            */
/* Perfect Play is a prediction competition, not a stats dashboard: for a paid  */
/* entry into one round, a user picks 2 players per game (try scorers for    */
/* NRL, goal kickers for AFL — see src/lib/perfect2). There is no points     */
/* system anywhere in this model — every result is the tri-state             */
/* pending/correct/incorrect or pending/perfect/not_perfect.                 */
/* -------------------------------------------------------------------------- */

export const competitionStatusValues = ["open", "closed", "settled"] as const;
export type CompetitionStatus = (typeof competitionStatusValues)[number];

/**
 * One row per sport-scoped competition INSTANCE for a single round (e.g. "Perfect Play NRL —
 * Round 5"). NRL and AFL are always separate rows here — never combined into one
 * competition — and each round gets its own row, so a $5 entry is always scoped to one
 * specific round of one specific sport's competition. `seasonId` is intentionally not
 * duplicated here: it's already reachable via `roundId -> rounds.seasonId`.
 */
export const competitions = pgTable(
  "competitions",
  {
    id: serial("id").primaryKey(),
    sportId: integer("sport_id")
      .notNull()
      .references(() => sports.id, { onDelete: "cascade" }),
    roundId: integer("round_id")
      .notNull()
      .references(() => rounds.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    entryFeeCents: integer("entry_fee_cents").notNull().default(500),
    /**
     * Configurable BASE prize for this competition — never hardcoded in application
     * logic, and its meaning is unchanged by Phase 19: this is always the configured
     * amount, never a total that includes rollover. Current prize pool = this +
     * rolloverInCents (see src/lib/perfect2/prize.ts / src/lib/data/settlement.ts).
     */
    prizeAmountCents: integer("prize_amount_cents").notNull().default(6000),
    /** open = accepting entries, closed = round underway/no new entries, settled = every game final. */
    status: varchar("status", { length: 16 }).notNull().default("open").$type<CompetitionStatus>(),
    opensAt: timestamp("opens_at", { withTimezone: true }),
    /** When entries stop being accepted — typically the round's earliest kickoff. */
    closesAt: timestamp("closes_at", { withTimezone: true }),

    /* ---- Phase 19: prize pool / rollover (all additive, all read-only from the client) ---- */

    /** Rollover this competition RECEIVED from the previous same-sport competition, if any. Set once, at creation. */
    rolloverInCents: integer("rollover_in_cents").notNull().default(0),
    /** Rollover this competition PRODUCED (only meaningful once prizeSettledAt is set): 0 if it had winners, else the whole pool. */
    rolloverOutCents: integer("rollover_out_cents").notNull().default(0),
    /** True once rolloverOutCents has actually been pulled into the next same-sport competition's rolloverInCents — prevents double-claiming. */
    rolloverClaimed: boolean("rollover_claimed").notNull().default(false),
    /** Authoritative winner count, persisted at settlement — not recomputed from entries afterward. */
    winnerCount: integer("winner_count").notNull().default(0),
    /** Total actually awarded to winners (0 if none) — sum of every winning entry's prizeAllocationCents. */
    awardedAmountCents: integer("awarded_amount_cents").notNull().default(0),
    /** Idempotency gate for prize settlement specifically (separate from `status`, which governs result settlement). Null until settled once; never recalculated after. */
    prizeSettledAt: timestamp("prize_settled_at", { withTimezone: true }),

    /**
     * Phase 23E — commercial-economics MODELING layer only, entirely separate from the
     * real prizeAmountCents/rollover fields above. Null = inherit the global
     * platform_settings default (see getPrizePoolAllocationBps,
     * src/lib/data/platform-settings.ts); a non-null value here overrides it for this one
     * competition. Basis points (6000 = 60.00%) for deterministic integer-safe math — see
     * src/lib/perfect2/commercial.ts. Never read by settlement/payout logic; purely a
     * business-reporting figure shown on the admin dashboard/competition detail.
     */
    prizePoolAllocationBps: integer("prize_pool_allocation_bps"),

    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [unique("competitions_sport_round_unique").on(t.sportId, t.roundId)],
);

/**
 * pending = not yet paid (no real payment provider connected — see src/lib/payments);
 * paid = a real charge succeeded; failed = a real charge attempt was declined/errored;
 * cancelled = the user abandoned payment; refunded = a paid entry was later refunded.
 * Plain varchar column, no DB constraint — this array is the only source of truth for
 * valid values, so extending it (as done here for Phase 16's payment abstraction) never
 * requires a migration.
 */
export const paymentStatusValues = ["pending", "paid", "failed", "cancelled", "refunded"] as const;
export type PaymentStatus = (typeof paymentStatusValues)[number];

export const entryResultValues = ["pending", "perfect", "not_perfect"] as const;
export type EntryResult = (typeof entryResultValues)[number];

/**
 * A user's paid entry into one competition (already scoped to one sport + one round).
 * Entries never span sports or rounds — one entry, one competition instance.
 *
 * Phase 23: a user may now hold MULTIPLE independent entries in the same competition (up
 * to the configured max — see platform_settings' max_entries_per_round, enforced
 * atomically in src/lib/data/entry-packages.ts), each with its own selections and its own
 * independent UPCOMING/LIVE/WINNER/FAILED outcome. The old one-entry-per-user-per-
 * competition UNIQUE constraint is gone (replaced by a plain index for the same lookup
 * performance, since the constraint itself is exactly what a multi-entry product must NOT
 * have) — the cap is enforced in application logic, not the schema, because "exactly how
 * many" is a configurable business rule, not a structural invariant.
 */
export const competitionEntries = pgTable(
  "competition_entries",
  {
    id: serial("id").primaryKey(),
    competitionId: integer("competition_id")
      .notNull()
      .references(() => competitions.id, { onDelete: "cascade" }),
    userId: integer("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    paymentStatus: varchar("payment_status", { length: 16 })
      .notNull()
      .default("pending")
      .$type<PaymentStatus>(),
    paidAmountCents: integer("paid_amount_cents"),
    /** Overall entry outcome — tri-state, computed by application logic. No points. */
    result: varchar("result", { length: 16 }).notNull().default("pending").$type<EntryResult>(),
    /** This entry's share of its competition's prize pool — 0 unless result="perfect" and the competition has settled. Set once, immutable after (see src/lib/data/settlement.ts). */
    prizeAllocationCents: integer("prize_allocation_cents").notNull().default(0),
    enteredAt: timestamp("entered_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("competition_entries_competition_user_idx").on(t.competitionId, t.userId),
    // Serves listEntriesForUser's "all my entries across every competition" query, which
    // filters and sorts by userId alone — the compound index above has userId as its
    // second column so it can't serve that lookup; without this, that query is a full
    // table scan at the target volumes (tens of thousands of entrants per round).
    index("competition_entries_user_entered_idx").on(t.userId, t.enteredAt),
  ],
);

/**
 * "void" added in Phase 22 — an admin-only resolution for a selection Perfect Play cannot
 * honestly settle as correct/incorrect (the player was ruled out/never played, or the
 * game was postponed/cancelled). Never inferred automatically from missing data; only set
 * via an explicit admin action (see src/lib/data/void.ts). Settlement treats a void
 * selection as never causing an entry to fail — see settleGameSelection/settleEntry in
 * src/lib/perfect2/settle.ts for the exact (documented, changeable) resolution rule.
 */
export const selectionResultValues = ["pending", "correct", "incorrect", "void"] as const;
export type SelectionResult = (typeof selectionResultValues)[number];

/**
 * One row per game within an entry, holding the user's player pick(s) for that game.
 *
 * Phase 23F changed every sport from 2 picks/game to 1 ("pick the perfect round" — see
 * SportSelectionConfig.selectionsPerGame in src/lib/perfect2/types.ts). selectedPlayer2Id
 * / player2Result are kept as NULLABLE (not removed) so historical 2-pick entries stay
 * exactly as they were persisted and readable unchanged; every entry created after
 * Phase 23F simply leaves them null. Never reinterpret a historical row's slot 2 as
 * "removed" — it's still a real, settled pick for entries created before this change.
 * Selections are never restricted by position — any player may be picked, eligible for
 * that specific game (see game_lineups), from either team.
 */
export const entrySelections = pgTable(
  "entry_selections",
  {
    id: serial("id").primaryKey(),
    entryId: integer("entry_id")
      .notNull()
      .references(() => competitionEntries.id, { onDelete: "cascade" }),
    gameId: integer("game_id")
      .notNull()
      .references(() => games.id, { onDelete: "cascade" }),
    selectedPlayer1Id: integer("selected_player_1_id")
      .notNull()
      .references(() => players.id),
    /** Null for every Phase 23F+ (1-pick) entry. Set only on historical 2-pick entries. */
    selectedPlayer2Id: integer("selected_player_2_id").references(() => players.id),
    /** Per-player outcome — correct once that player hits the sport's required stat (>=1 try/goal/touchdown, or the NBA points threshold). */
    player1Result: varchar("player_1_result", { length: 16 })
      .notNull()
      .default("pending")
      .$type<SelectionResult>(),
    /** Null (not "pending") when there's no second selection at all — see selectedPlayer2Id. */
    player2Result: varchar("player_2_result", { length: 16 }).$type<SelectionResult>(),
  },
  (t) => [
    unique("entry_selections_entry_game_unique").on(t.entryId, t.gameId),
    // gameId is the SECOND column of the compound unique above, so a lookup by gameId
    // alone (voidPendingSelectionsForGame, src/lib/data/void.ts — now auto-triggered on
    // every provider resync that detects a game newly cancelled) couldn't use it and was
    // a full table scan (confirmed via EXPLAIN, Phase 23I load audit). entryId-only
    // lookups (settlement's per-entry fetch) are unaffected — entryId is already the
    // leading column.
    index("entry_selections_game_id_idx").on(t.gameId),
  ],
);

/* -------------------------------------------------------------------------- */
/* Payment transactions (Phase 20)                                            */
/*                                                                            */
/* Durable, append-oriented payment history — separate from                  */
/* competition_entries.paymentStatus (which reflects only "this entry's       */
/* current state"). One user+competition can accumulate several rows here    */
/* over time (a failed attempt, then a successful retry, then eventually a   */
/* refund) — something 2 scalar columns on the entry row can't represent.    */
/* No real payment provider is connected; see src/lib/payments.              */
/* -------------------------------------------------------------------------- */

export const transactionTypeValues = ["payment", "refund"] as const;
export type TransactionType = (typeof transactionTypeValues)[number];

export const paymentTransactions = pgTable(
  "payment_transactions",
  {
    id: serial("id").primaryKey(),
    userId: integer("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    /** Null until the entry actually exists — a failed/cancelled attempt never gets one, since no entry is created in that case. */
    competitionEntryId: integer("competition_entry_id").references(() => competitionEntries.id, { onDelete: "set null" }),
    competitionId: integer("competition_id").references(() => competitions.id, { onDelete: "set null" }),
    /** Matches PaymentProvider.name (e.g. "dev-test-only") — never a real provider name until one is actually connected. */
    provider: varchar("provider", { length: 32 }).notNull(),
    /** Opaque provider-side reference — never client-supplied, always written by our own server code from the provider's response. */
    providerTransactionId: varchar("provider_transaction_id", { length: 128 }),
    /** Server-derived, e.g. "payment:{userId}:{competitionId}" — never client-supplied. Unique: the DB is the idempotency backstop, not just application logic. */
    idempotencyKey: varchar("idempotency_key", { length: 128 }).notNull(),
    amountCents: integer("amount_cents").notNull(),
    currency: varchar("currency", { length: 3 }).notNull().default("AUD"),
    status: varchar("status", { length: 16 }).notNull().default("pending").$type<PaymentStatus>(),
    transactionType: varchar("transaction_type", { length: 16 }).notNull().default("payment").$type<TransactionType>(),
    failureCode: varchar("failure_code", { length: 64 }),
    failureMessage: text("failure_message"),
    /** Small, non-sensitive provider metadata only — never secrets, never full card/account details. */
    metadata: jsonb("metadata").$type<Record<string, string>>(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    completedAt: timestamp("completed_at", { withTimezone: true }),
  },
  (t) => [unique("payment_transactions_idempotency_key_unique").on(t.idempotencyKey)],
);

/* -------------------------------------------------------------------------- */
/* Wallet / Perfect Play Balance (Phase 23)                                      */
/*                                                                            */
/* Real money remains disabled (Phase 20) — a deposit still only ever goes   */
/* through the dev-only payment provider, never a real charge. Crediting the */
/* balance on a "pending" deposit (rather than waiting for "paid", which the */
/* dev provider can never report) mirrors the exact rule createEntry has     */
/* always used for a direct entry charge.                                    */
/* -------------------------------------------------------------------------- */

/**
 * One row per user — the current balance. Kept as its own table (not a column on
 * `users`) so the wallet is a distinct, self-contained subsystem: a 1:1 relationship
 * today, but never conflated with identity/auth concerns. Mutated ONLY via
 * src/lib/data/wallet.ts's atomic conditional-update functions (this driver — Neon's
 * neon-http — has NO multi-statement transaction support at all, confirmed directly) —
 * every balance mutation in this codebase, here and elsewhere, is therefore a single
 * atomic conditional UPDATE, never a multi-statement transaction) — balanceCents is
 * always exactly the running sum of every row in wallet_transactions below for that user.
 */
export const wallets = pgTable(
  "wallets",
  {
    id: serial("id").primaryKey(),
    userId: integer("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    balanceCents: integer("balance_cents").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [unique("wallets_user_id_unique").on(t.userId)],
);

export const walletTransactionTypeValues = ["deposit", "entry_purchase", "winning_credit", "withdrawal", "refund", "adjustment"] as const;
export type WalletTransactionType = (typeof walletTransactionTypeValues)[number];

/**
 * The Perfect Play Balance ledger — the SOURCE OF TRUTH for wallet movements, not just an
 * audit trail: every balance change is one immutable row here, written atomically
 * together with the wallets.balanceCents update it corresponds to. Distinct from
 * payment_transactions above, which is the boundary with the (dev-only) payment
 * provider: a deposit produces ONE payment_transactions row (the provider interaction)
 * and ONE wallet_transactions row (the resulting credit, idempotent on
 * relatedPaymentTransactionId — a duplicate provider callback can never double-credit);
 * an entry/package purchase produces ONE wallet_transactions row (a pure internal
 * balance movement) and NO payment_transactions row, since spending an already-deposited
 * balance never calls the provider.
 */
export const walletTransactions = pgTable(
  "wallet_transactions",
  {
    id: serial("id").primaryKey(),
    userId: integer("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    type: varchar("type", { length: 16 }).notNull().$type<WalletTransactionType>(),
    /** Signed: positive for a credit (deposit, refund, winning_credit), negative for a debit (entry_purchase, withdrawal). */
    amountCents: integer("amount_cents").notNull(),
    currency: varchar("currency", { length: 3 }).notNull().default("AUD"),
    balanceBeforeCents: integer("balance_before_cents").notNull(),
    balanceAfterCents: integer("balance_after_cents").notNull(),
    description: text("description").notNull(),
    /** Set only for a deposit — the provider-boundary record this credit came from. Unique: at most one wallet credit per deposit attempt, so a duplicate payment callback can never double-credit. */
    relatedPaymentTransactionId: integer("related_payment_transaction_id").references(() => paymentTransactions.id, { onDelete: "set null" }),
    relatedCompetitionId: integer("related_competition_id").references(() => competitions.id, { onDelete: "set null" }),
    /** Every competition_entries.id this transaction paid for/credited — e.g. all 5 entries from one 5-entry package purchase, or the single winning entry for a winning_credit. Empty for deposits/withdrawals. */
    relatedEntryIds: jsonb("related_entry_ids").$type<number[]>(),
    /**
     * Set only for a winning_credit — the specific entry this prize payout is for.
     * Unique, same idempotency role as relatedPaymentTransactionId but for the settlement
     * side: an entry can win at most once, ever, so this is what lets a retried settle
     * call safely re-attempt a credit that failed partway the first time without ever
     * double-crediting it (see settlement.ts's retry logic and creditPrizeWinnings).
     */
    relatedPrizeEntryId: integer("related_prize_entry_id").references(() => competitionEntries.id, { onDelete: "set null" }),
    /**
     * Set only for a withdrawal-type debit. Unique, same idempotency role as
     * relatedPaymentTransactionId/relatedPrizeEntryId: a withdrawal can only ever be
     * completed (and therefore debited) once, so this is what lets debitWallet
     * (src/lib/data/wallet.ts) refuse a second debit for the same withdrawal even under a
     * genuine race — see updateWithdrawalStatus's own atomic status-claim
     * (src/lib/data/withdrawals.ts) for the primary guard this backs up.
     */
    relatedWithdrawalId: integer("related_withdrawal_id").references(() => withdrawals.id, { onDelete: "set null" }),
    /**
     * Client-supplied idempotency key for debits with no natural pre-existing row to key
     * off (e.g. an entry-package purchase — unlike a withdrawal, there's no earlier
     * "withdrawal request" row created before the debit). Same role as
     * relatedPaymentTransactionId/relatedPrizeEntryId/relatedWithdrawalId: a retried
     * request (double-tap, network retry, or a genuine concurrent race) with the same key
     * can never debit or create a second time — see debitWallet's idempotencyKey opt.
     */
    idempotencyKey: varchar("idempotency_key", { length: 64 }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique("wallet_transactions_idempotency_unique").on(t.relatedPaymentTransactionId),
    unique("wallet_transactions_prize_entry_unique").on(t.relatedPrizeEntryId),
    unique("wallet_transactions_withdrawal_unique").on(t.relatedWithdrawalId),
    unique("wallet_transactions_idempotency_key_unique").on(t.idempotencyKey),
  ],
);

export const withdrawalStatusValues = ["requested", "pending", "processing", "completed", "rejected", "cancelled"] as const;
export type WithdrawalStatus = (typeof withdrawalStatusValues)[number];

/**
 * Withdrawal architecture only — Phase 23 builds the lifecycle and ledger integration,
 * not a real payout mechanism (no licensing/KYC/AML process exists yet; see
 * docs/phase23-wallet-and-terms.md). A withdrawal only ever debits the wallet once it
 * reaches "completed" (see src/lib/data/wallet.ts) — requesting one does not touch the
 * balance, so a user can never be double-charged by a request that's later rejected.
 */
export const withdrawals = pgTable(
  "withdrawals",
  {
    id: serial("id").primaryKey(),
    userId: integer("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    amountCents: integer("amount_cents").notNull(),
    status: varchar("status", { length: 16 }).notNull().default("requested").$type<WithdrawalStatus>(),
    adminNote: text("admin_note"),
    requestedAt: timestamp("requested_at", { withTimezone: true }).notNull().defaultNow(),
    processedAt: timestamp("processed_at", { withTimezone: true }),
  },
  // listWithdrawalsForUser's WHERE userId = X had no index at all (confirmed via EXPLAIN,
  // Phase 23I load audit) — a full table scan on every customer's own wallet/withdrawal
  // history page view.
  (t) => [index("withdrawals_user_id_idx").on(t.userId)],
);

/**
 * Admin-configurable entry packages (Phase 23) — never hard-coded in application logic.
 * Editing/deactivating a package only ever affects NEW purchases; an entry already
 * created retains its own actual paid amount on the wallet_transactions row that bought
 * it, so past purchases are never retroactively altered by a later pricing change.
 */
export const entryPackages = pgTable("entry_packages", {
  id: serial("id").primaryKey(),
  entryCount: integer("entry_count").notNull(),
  priceCents: integer("price_cents").notNull(),
  label: text("label").notNull(),
  /** e.g. "BEST VALUE" — purely cosmetic, never affects price/logic. Null for no badge. */
  badge: text("badge"),
  active: boolean("active").notNull().default(true),
  displayOrder: integer("display_order").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

/** Generic admin-editable platform settings (Phase 23) — e.g. max entries per user per round. Never hard-coded. */
export const platformSettings = pgTable("platform_settings", {
  key: varchar("key", { length: 64 }).primaryKey(),
  value: jsonb("value").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

/* -------------------------------------------------------------------------- */
/* Terms & Conditions (Phase 23)                                              */
/*                                                                            */
/* DRAFT pending Australian gambling/legal regulatory review — see            */
/* docs/phase23-terms-and-conditions.md. Versioned so content can be edited   */
/* and republished without an app release, and so a user's historical         */
/* acceptance record always points at the exact version they actually agreed  */
/* to, even after a newer version is published.                              */
/* -------------------------------------------------------------------------- */

export const termsVersionStatusValues = ["draft", "published", "archived"] as const;
export type TermsVersionStatus = (typeof termsVersionStatusValues)[number];

export interface TermsSection {
  heading: string;
  body: string;
}

export const termsVersions = pgTable("terms_versions", {
  id: serial("id").primaryKey(),
  versionNumber: varchar("version_number", { length: 32 }).notNull().unique(),
  effectiveDate: date("effective_date").notNull(),
  /** Set only once actually published — a draft has none yet. */
  publishedAt: timestamp("published_at", { withTimezone: true }),
  status: varchar("status", { length: 16 }).notNull().default("draft").$type<TermsVersionStatus>(),
  /** Structured sections (heading + body) — renders as an accordion; never a single unstructured wall of text. */
  content: jsonb("content").notNull().$type<TermsSection[]>(),
  createdByUserId: integer("created_by_user_id").references(() => users.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

/* -------------------------------------------------------------------------- */
/* Perfect Play Moments / customer events                                    */
/*                                                                            */
/* The emotional-progression notification model (src/lib/perfect2/moments.ts)*/
/* for an entry's shared selection set as games settle. Scoped to             */
/* (userId, competitionId) — NOT to an individual competition_entries row —   */
/* because every entry a customer holds in one competition shares the exact  */
/* same canonical selections (see entry-packages.ts): a customer holding 10  */
/* identical entries gets ONE moment per progression beat, never ten.         */
/*                                                                            */
/* Extended (additive, same table — no second notification architecture) to  */
/* cover the rest of the customer journey: round-lifecycle events            */
/* (entry_market_open/team_lists_available/entry_closing_soon/               */
/* entry_closing_now, see src/lib/data/notifications.ts) and settlement      */
/* events beyond selection progress (prize_won/rollover/rollover_jackpot).   */
/* correctSelections/incorrectSelections/totalSelections are 0 for these     */
/* non-progress event types — they simply don't describe a pick-progress     */
/* state, not a real 0-progress entry.                                      */
/* -------------------------------------------------------------------------- */

export const momentTypeValues = [
  "pick_correct_milestone",
  "one_left",
  "perfect",
  "perfect_ended",
  "entry_market_open",
  "team_lists_available",
  "entry_closing_soon",
  "entry_closing_now",
  "prize_won",
  "rollover",
  "rollover_jackpot",
] as const;
export type MomentType = (typeof momentTypeValues)[number];

export const perfectPlayMoments = pgTable(
  "perfect_play_moments",
  {
    id: serial("id").primaryKey(),
    userId: integer("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    competitionId: integer("competition_id")
      .notNull()
      .references(() => competitions.id, { onDelete: "cascade" }),
    sportId: integer("sport_id")
      .notNull()
      .references(() => sports.id, { onDelete: "cascade" }),
    type: varchar("type", { length: 32 }).notNull().$type<MomentType>(),
    message: text("message").notNull(),
    correctSelections: integer("correct_selections").notNull(),
    incorrectSelections: integer("incorrect_selections").notNull(),
    totalSelections: integer("total_selections").notNull(),
    /**
     * Deterministic dedupe key (src/lib/perfect2/moments.ts's momentDedupeKey) — the
     * idempotency backstop enforced by Postgres itself, the same pattern as
     * wallet_transactions.idempotencyKey: a retried/duplicate settlement pass can never
     * produce a second row for the same underlying progression event, regardless of how
     * many of the customer's identical entries it's computed from or how many times
     * settlement re-runs.
     */
    dedupeKey: varchar("dedupe_key", { length: 160 }).notNull(),
    /** Null until the customer has actually seen this moment in-app — see src/lib/data/moments.ts:markMomentsRead. Never affects settlement/eligibility, display-only. */
    readAt: timestamp("read_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique("perfect_play_moments_dedupe_key_unique").on(t.dedupeKey),
    index("perfect_play_moments_user_created_idx").on(t.userId, t.createdAt),
  ],
);

/**
 * Device push-token registry — architecture-ready for Expo push notifications, NOT wired
 * up to a real push send yet (expo-notifications is not installed in mobile/ — see
 * docs/mobile-app-architecture.md §9). Building this table now, ahead of actually needing
 * it, is what makes "register a device for push" a pure additive follow-up later (call
 * POST /api/me/push-tokens once expo-notifications is added) rather than a schema change
 * at that point. Never used to actually send anything today.
 */
export const pushTokenPlatformValues = ["ios", "android", "web"] as const;
export type PushTokenPlatform = (typeof pushTokenPlatformValues)[number];

export const pushTokens = pgTable(
  "push_tokens",
  {
    id: serial("id").primaryKey(),
    userId: integer("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    /** Opaque Expo push token (e.g. "ExponentPushToken[...]") — never a secret, but never logged either (see src/lib/monitoring/log.ts's redaction). */
    token: varchar("token", { length: 255 }).notNull(),
    platform: varchar("platform", { length: 16 }).notNull().$type<PushTokenPlatform>(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [unique("push_tokens_token_unique").on(t.token)],
);

/** One row per user per version they've actually accepted — historical acceptances are never deleted when a newer version publishes. */
export const termsAcceptances = pgTable(
  "terms_acceptances",
  {
    id: serial("id").primaryKey(),
    userId: integer("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    termsVersionId: integer("terms_version_id")
      .notNull()
      .references(() => termsVersions.id, { onDelete: "cascade" }),
    acceptedAt: timestamp("accepted_at", { withTimezone: true }).notNull().defaultNow(),
    ipAddress: varchar("ip_address", { length: 64 }),
    userAgent: text("user_agent"),
  },
  (t) => [unique("terms_acceptances_user_version_unique").on(t.userId, t.termsVersionId)],
);
