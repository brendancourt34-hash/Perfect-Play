import * as SecureStore from "expo-secure-store";

/**
 * Typed client for the Perfect Play Next.js API (see ../../src/app/api). Every response uses
 * the same envelope the server returns: `{ ok: true, data }` or
 * `{ ok: false, message, errors? }` — see src/lib/api/response.ts on the server side.
 *
 * This file contains NO business logic — no price calculation, no eligibility checks, no
 * settlement. It only calls the API and returns what the server says. The server remains
 * the single source of truth for everything listed in docs/mobile-app-architecture.md §5.
 */

const API_URL = process.env.EXPO_PUBLIC_API_URL ?? "http://localhost:3000";
const SESSION_TOKEN_KEY = "perfect2_session_token";
const REQUEST_TIMEOUT_MS = 15_000;

export async function getSessionToken(): Promise<string | null> {
  return SecureStore.getItemAsync(SESSION_TOKEN_KEY);
}

export async function setSessionToken(token: string): Promise<void> {
  await SecureStore.setItemAsync(SESSION_TOKEN_KEY, token);
}

export async function clearSessionToken(): Promise<void> {
  await SecureStore.deleteItemAsync(SESSION_TOKEN_KEY);
}

export type ApiResult<T> = { ok: true; data: T } | { ok: false; message: string; errors?: string[] };

async function request<T>(path: string, init?: RequestInit): Promise<ApiResult<T>> {
  const token = await getSessionToken();
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...((init?.headers as Record<string, string>) ?? {}),
  };

  // Hard time limit: without it an unreachable server (dev server not running, wrong
  // EXPO_PUBLIC_API_URL) left the app frozen on "Loading Perfect Play…" forever.
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(`${API_URL}${path}`, { ...init, headers, signal: init?.signal ?? controller.signal });
    const body = await response.json();
    return body as ApiResult<T>;
  } catch {
    return { ok: false, message: "Couldn't reach Perfect Play. Check your connection and try again." };
  } finally {
    clearTimeout(timer);
  }
}

// ---- Sports & rounds -------------------------------------------------------

export interface SportSummary {
  code: string;
  slug: string;
  name: string;
  fullName: string;
  ruleSummary: string;
}

export function getSports() {
  return request<{ sports: SportSummary[] }>("/api/sports");
}

export interface RoundSummary {
  id: number;
  roundNumber: number;
  name: string | null;
  startDate: string | null;
  endDate: string | null;
  status: string;
  gamesCount: number;
  /** null when no competition row exists yet for this round. */
  competition: {
    state: CompetitionState;
    entryFeeCents: number;
    /** Configured base prize — see currentPrizePoolCents for the real customer-facing amount. */
    prizeAmountCents: number | null;
    /** Server-authoritative: false until the round's first game kicks off. Never decide this on the client. */
    prizePoolVisible: boolean;
    /** Base prize + any rollover (Phase 19) — null until prizePoolVisible is true. Never display prizeAmountCents as a substitute. */
    currentPrizePoolCents: number | null;
    opensAt: string | null;
    closesAt: string | null;
    firstGameKickoffAt: string | null;
    buyInCutoffAt: string | null;
  } | null;
}

export async function getRounds(sportSlug: string) {
  const result = await request<{ rounds: RoundSummary[] }>(`/api/${sportSlug}/rounds`);
  // QA scripts create real rounds named "qa-…" (e.g. "qa-moments-perfect-<timestamp>") and
  // some of them read this same list endpoint, so they're hidden here in the customer app
  // rather than server-side. Without this a leftover QA round showed as the "current
  // competition" with its internal name and a 2-game count.
  if (result.ok) return { ...result, data: { ...result.data, rounds: result.data.rounds.filter((r) => !isInternalTestRound(r)) } };
  return result;
}

/** True for rounds created by the scripts/qa-*.ts test harness — never shown to customers. */
export function isInternalTestRound(round: Pick<RoundSummary, "name">): boolean {
  return /^qa[0-9a-z]*[-_]/i.test(round.name?.trim() ?? "");
}

export interface RoundDetail {
  round: { id: number; roundNumber: number; name: string | null; startDate: string | null; endDate: string | null; status: string };
  competition: {
    state: CompetitionState;
    entryFeeCents: number;
    /** Configured base prize — see currentPrizePoolCents for the real customer-facing amount. */
    prizeAmountCents: number | null;
    /** Server-authoritative: false until the round's first game kicks off. Never decide this on the client. */
    prizePoolVisible: boolean;
    /** Base prize + any rollover (Phase 19) — null until prizePoolVisible is true. Never display prizeAmountCents as a substitute. */
    currentPrizePoolCents: number | null;
    opensAt: string | null;
    closesAt: string | null;
    firstGameKickoffAt: string | null;
    buyInCutoffAt: string | null;
  };
  selectionLabel: string;
  /** Server-authoritative rule config — never hardcode sport rules on the client. */
  ruleConfig: {
    sport: string;
    requiredGames: number;
    selectionsPerGame: number;
    selectionMetric: "tries" | "goals" | "points" | "touchdowns";
    threshold: number;
  };
  games: {
    id: number;
    homeTeam: { id: number; name: string; logoUrl: string | null };
    awayTeam: { id: number; name: string; logoUrl: string | null };
    kickoff: string | null;
    venue: string | null;
    status: "scheduled" | "live" | "final" | "postponed" | "cancelled";
    homeScore: number | null;
    awayScore: number | null;
    /** Which curated round "day" this game belongs to (e.g. "thursday") — only set for NBA. Null for NRL/AFL. */
    slotLabel: string | null;
    /** injuryStatus is a real provider-reported designation (e.g. "DAY_TO_DAY") or null — never "OUT" (excluded server-side before this response is built). NBA-only; always null for other sports. */
    eligiblePlayers: { id: number; name: string; position: string; teamId: number; photoUrl: string | null; injuryStatus: string | null }[];
  }[];
}

export function getRoundDetail(sportSlug: string, roundId: number) {
  return request<RoundDetail>(`/api/${sportSlug}/rounds/${roundId}`);
}

export type CompetitionState = "not_yet_open" | "open" | "closed" | "settled";

export interface CompetitionResults {
  competition: { id: number; state: CompetitionState; prizeAmountCents: number | null; prizePoolVisible: boolean; currentPrizePoolCents: number | null } | null;
  /**
   * Never exposes an entrant count, live turnover, or a live payout estimate — before
   * `settled` is true, only currentPrizePoolCents is meaningful; every other count stays
   * null/empty/zero until the competition is actually settled (see Feature 2/5).
   */
  results: {
    competitionId: number;
    sportCode: string;
    currentPrizePoolCents: number | null;
    settled: boolean;
    perfectCount: number | null;
    awardedAmountCents: number | null;
    payoutPerPerfectEntryCents: number | null;
    perfectEntryIds: number[];
    /** The signed-in caller's own PERFECT entries in this competition — 0 if not signed in, no entries, or not yet settled. Never another customer's. */
    myPerfectEntryCount: number;
    mySharesAmountCents: number;
  } | null;
}

export function getResults(sportSlug: string, roundId: number) {
  return request<CompetitionResults>(`/api/${sportSlug}/rounds/${roundId}/results`);
}

// ---- Payment (Phase 16/17 buy-in flow) ---------------------------------------

export interface PaymentAttemptResult {
  status: "pending" | "paid" | "failed" | "cancelled" | "refunded";
  amountCents: number;
  currency: "AUD";
  message: string;
}

/**
 * Pre-flight test-payment attempt for the buy-in flow — never creates an entry. The
 * amount/competition are always resolved server-side; nothing here is client-supplied.
 */
export function initiatePayment(sportSlug: string, roundId: number) {
  return request<PaymentAttemptResult>(`/api/${sportSlug}/rounds/${roundId}/payment`, { method: "POST" });
}

// ---- Entries ----------------------------------------------------------------

export interface CreateEntrySelection {
  gameId: number;
  /** One player id per required selection for this sport — length 1 for every sport since Phase 23F. */
  playerIds: number[];
}

export function createEntry(sportSlug: string, roundId: number, selections: CreateEntrySelection[]) {
  return request<{ entryId: number }>(`/api/${sportSlug}/rounds/${roundId}/entries`, {
    method: "POST",
    body: JSON.stringify({ selections }),
  });
}

export interface MyEntry {
  entryId: number;
  competitionId: number;
  sportCode: string;
  roundId: number;
  roundName: string | null;
  roundNumber: number;
  result: "pending" | "perfect" | "not_perfect";
  enteredAt: string;
}

export function listMyEntries() {
  return request<{ entries: MyEntry[] }>("/api/entries");
}

/**
 * One package purchase's worth of entries, grouped — "10 ENTRIES, SAME PICKS" — never one
 * row per entry. Reuses the exact same grouping as the web My Entries page
 * (listEntryGroupsForUser, see src/app/api/entries/groups/route.ts) — no second grouping
 * algorithm. `selections` is the ONE shared canonical pick set for the whole group, read
 * once off the group's first entry.
 */
export interface MyEntryGroupSelection {
  gameId: number;
  homeTeamName: string;
  awayTeamName: string;
  gameResult: "pending" | "perfect" | "not_perfect";
  playerName: string | null;
  statCount: number | null;
  pickResult: "pending" | "correct" | "incorrect" | "void";
}

export interface MyEntryGroup {
  competitionId: number;
  sportCode: string;
  roundId: number;
  roundName: string | null;
  roundNumber: number;
  entryIds: number[];
  result: "pending" | "perfect" | "not_perfect";
  enteredAt: string;
  totalPrizeAllocationCents: number;
  competitionWinnerCount: number;
  statField: "tries" | "goals" | "points" | "touchdowns" | null;
  selections: MyEntryGroupSelection[];
}

export function listMyEntryGroups() {
  return request<{ groups: MyEntryGroup[] }>("/api/entries/groups");
}

export interface EntryResultDetail {
  entryId: number;
  competitionId: number;
  sportCode: string;
  statField: "tries" | "goals" | "points" | "touchdowns";
  entryResult: "pending" | "perfect" | "not_perfect";
  selections: {
    gameId: number;
    homeTeamName: string;
    awayTeamName: string;
    /** One entry per selection made for this game — length 1 for every current sport, length 2 for a historical entry. */
    selections: { id: number; name: string; statCount: number | null; result: "pending" | "correct" | "incorrect" | "void" }[];
    gameResult: "pending" | "perfect" | "not_perfect";
  }[];
}

export function getEntry(entryId: number) {
  return request<{ entry: EntryResultDetail }>(`/api/entries/${entryId}`);
}

// ---- Perfect Play Balance (wallet) -----------------------------------------

export function getWalletBalance() {
  return request<{ balanceCents: number; currency: "AUD" }>("/api/me/wallet");
}

export interface WalletTransactionSummary {
  id: number;
  type: "deposit" | "entry_purchase" | "winning_credit" | "withdrawal" | "refund" | "adjustment";
  amountCents: number;
  currency: string;
  balanceBeforeCents: number;
  balanceAfterCents: number;
  description: string;
  createdAt: string;
}

export function listWalletTransactions() {
  return request<{ transactions: WalletTransactionSummary[] }>("/api/me/wallet/transactions");
}

export function depositToWallet(amountCents: number) {
  return request<{ confirmed: boolean; providerStatus?: string; newBalanceCents?: number; message?: string }>("/api/me/wallet/deposit", {
    method: "POST",
    body: JSON.stringify({ amountCents }),
  });
}

export interface WithdrawalSummary {
  id: number;
  amountCents: number;
  status: "requested" | "pending" | "processing" | "completed" | "rejected" | "cancelled";
  requestedAt: string;
  processedAt: string | null;
}

export function listMyWithdrawals() {
  return request<{ withdrawals: WithdrawalSummary[] }>("/api/me/withdrawals");
}

export function requestWithdrawal(amountCents: number) {
  return request<{ withdrawal: WithdrawalSummary }>("/api/me/withdrawals", {
    method: "POST",
    body: JSON.stringify({ amountCents }),
  });
}

// ---- Entry packages (multi-entry purchases) ------------------------------

export interface EntryPackageSummary {
  id: number;
  entryCount: number;
  priceCents: number;
  label: string;
  badge: string | null;
}

export function getEntryPackages() {
  return request<{ packages: EntryPackageSummary[] }>("/api/entry-packages");
}

export interface MyRoundEntry {
  entryId: number;
  result: "pending" | "perfect" | "not_perfect";
  paymentStatus: string;
  paidAmountCents: number | null;
  enteredAt: string;
}

export function getMyRoundEntries(sportSlug: string, roundId: number) {
  return request<{ entries: MyRoundEntry[]; maxEntries: number; sharedSelections: CreateEntrySelection[] | null }>(
    `/api/${sportSlug}/rounds/${roundId}/entries`,
  );
}

/**
 * Purchases a package of `entryCount` identical entries, all built from the ONE
 * `selections` set the customer picked — never one array per entry. If the customer
 * already holds an entry in this competition, the server ignores `selections` entirely
 * and reuses their existing picks instead, so this can safely be called with the same
 * `selections` value on a "buy more entries" purchase without risk of creating a second,
 * different selection set.
 */
export function enterPackage(
  sportSlug: string,
  roundId: number,
  packageId: number,
  selections: CreateEntrySelection[],
  /** Generate once per purchase attempt (e.g. when the review screen mounts) and resend unchanged on any retry of that same attempt — never regenerated for a genuinely new purchase decision. Makes a double-tap or network retry resolve to the exact same result instead of a second debit/second batch of entries. */
  idempotencyKey: string,
) {
  return request<{ entryIds: number[]; amountPaidCents: number; entryCount: number; newBalanceCents: number }>(
    `/api/${sportSlug}/rounds/${roundId}/enter-package`,
    { method: "POST", body: JSON.stringify({ packageId, selections, idempotencyKey }) },
  );
}

// ---- Terms & Conditions ---------------------------------------------------

export interface TermsSection {
  heading: string;
  body: string;
}

export interface TermsContent {
  id: number;
  versionNumber: string;
  effectiveDate: string;
  publishedAt: string;
  content: TermsSection[];
}

/** The current published Terms & Conditions — public, no auth required. */
export function getTerms() {
  return request<{ terms: TermsContent }>("/api/terms");
}

export function getMyTermsAcceptance() {
  return request<{ accepted: boolean; currentVersion: { id: number; versionNumber: string } | null }>("/api/me/terms-acceptance");
}

export function acceptTerms(termsVersionId: number) {
  return request<{ accepted: true; acceptedAt: string }>("/api/me/terms-acceptance", {
    method: "POST",
    body: JSON.stringify({ termsVersionId }),
  });
}

// ---- Auth ---------------------------------------------------------------

export interface AuthUser {
  id: number;
  email: string;
  name: string | null;
}

export async function register(email: string, password: string, name: string) {
  const result = await request<{ user: AuthUser; token: string }>("/api/auth/register", {
    method: "POST",
    body: JSON.stringify({ email, password, name }),
  });
  if (result.ok) await setSessionToken(result.data.token);
  return result;
}

export async function login(email: string, password: string) {
  const result = await request<{ user: AuthUser; token: string }>("/api/auth/login", {
    method: "POST",
    body: JSON.stringify({ email, password }),
  });
  if (result.ok) await setSessionToken(result.data.token);
  return result;
}

export async function logout() {
  const result = await request<{ loggedOut: true }>("/api/auth/logout", { method: "POST" });
  await clearSessionToken();
  return result;
}

export function getCurrentUser() {
  return request<{ user: AuthUser }>("/api/auth/me");
}

// ---- Perfect Play Moments ---------------------------------------------------

/**
 * One Perfect Play Moment/customer event — scoped to (userId, competitionId), never to a
 * single entry, so a customer holding several identical entries in one round sees each
 * progression beat exactly once (see src/lib/data/moments.ts).
 */
export interface PerfectPlayMoment {
  id: number;
  competitionId: number;
  sportId: number;
  type:
    | "pick_correct_milestone"
    | "one_left"
    | "perfect"
    | "perfect_ended"
    | "entry_market_open"
    | "team_lists_available"
    | "entry_closing_soon"
    | "entry_closing_now"
    | "prize_won"
    | "rollover"
    | "rollover_jackpot";
  message: string;
  readAt: string | null;
  createdAt: string;
}

/** The signed-in user's own moments, newest first — optionally scoped to one competition (e.g. the story of one round). */
export function listMoments(competitionId?: number) {
  const query = competitionId ? `?competitionId=${competitionId}` : "";
  return request<{ moments: PerfectPlayMoment[] }>(`/api/me/moments${query}`);
}

/** Marks every currently-unread moment as read (in-app "seen" state only). */
export function markMomentsRead() {
  return request<{ updated: number }>("/api/me/moments", { method: "POST" });
}

// ---- Push notifications -----------------------------------------------------

export type PushPlatform = "ios" | "android" | "web";

/** Registers this device's Expo push token against the signed-in user. Idempotent server-side — safe to call again with the same token. */
export function registerPushToken(token: string, platform: PushPlatform) {
  return request<{ registered: true }>("/api/me/push-tokens", { method: "POST", body: JSON.stringify({ token, platform }) });
}

/** Removes a device's push token — called on logout so a signed-out device never keeps receiving another user's future pushes. */
export function removePushToken(token: string) {
  return request<{ removed: true }>("/api/me/push-tokens", { method: "DELETE", body: JSON.stringify({ token }) });
}
