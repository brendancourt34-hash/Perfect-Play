/**
 * Seeds and publishes the initial Perfect 2 Terms & Conditions (v1.0) — Phase 23. Idempotent:
 * if version "1.0" already exists, this does nothing. This is DRAFT content pending real
 * Australian gambling-law legal review (per every other Phase 23 doc/comment in this
 * codebase) — it describes the product exactly as built (tri-state settlement, no
 * points/leaderboard, admin-configured prize pool + rollover, Perfect 2 Balance wallet,
 * entry packages, withdrawal lifecycle-only) and marks every regulatory/operator detail
 * that cannot yet be truthfully stated as "TO BE CONFIRMED — PENDING LEGAL REVIEW". It
 * must never be treated as final, compliant, or legally reviewed until an actual lawyer
 * has done so.
 *
 *   npx dotenv -e .env.local -- npx tsx scripts/seed-terms-v1.ts
 */
import { getDb, schema } from "../src/db";
import { eq } from "drizzle-orm";
import type { TermsSection } from "../src/db/schema";

const VERSION_NUMBER = "1.0";

const SECTIONS: TermsSection[] = [
  {
    heading: "1. How Perfect 2 Works",
    body:
      "Perfect 2 runs separate pick'em competitions for NRL, AFL, and NBA — each sport is its own competition with its own round, entries, and prize pool; they are never combined or compared against each other. In each round you pick 2 players in every selected game (NRL: 2 try scorers per game; AFL: 2 goal kickers per game; NBA: 2 players per game who must each score 20 or more points). Every one of your picks across the whole round must be correct for your entry to be Perfect — there are no partial-credit points, no leaderboard, and no fantasy-style scoring. An entry is either Perfect, Not Perfect, or still Pending until every game in the round is final.",
  },
  {
    heading: "2. Eligibility",
    body:
      "You must be at least 18 years old and located in a jurisdiction where participation in Perfect 2 is lawful to register an account or enter a competition. Perfect 2 may ask you to verify your age and identity before allowing a deposit, entry, or withdrawal, and may restrict or decline service to anyone it reasonably believes does not meet these requirements. TO BE CONFIRMED — PENDING LEGAL REVIEW: the specific jurisdictions in which Perfect 2 is available, and any additional licensing-driven eligibility requirements.",
  },
  {
    heading: "3. Registration & Account",
    body:
      "You need a Perfect 2 account to enter any competition. You must provide accurate registration details and keep your login credentials secure — you are responsible for activity that occurs under your account unless you can show it resulted from Perfect 2's own fault. Each person may hold only one Perfect 2 account.",
  },
  {
    heading: "4. Perfect 2 Balance (Deposits)",
    body:
      "Perfect 2 Balance is your account's internal, stored-value balance. You add funds to it through the payment methods Perfect 2 makes available at the time; entry fees and packages are paid out of this balance, and any winnings or refunds are credited back to it. Every movement of your balance — deposits, entry purchases, winnings, refunds, withdrawals, and any administrative adjustment — is recorded as an individual, permanent ledger entry that you can review at any time. Real-money deposits, entries, and withdrawals remain disabled while Perfect 2 completes Australian gambling-law legal review; this section describes how the feature will work once enabled.",
  },
  {
    heading: "5. Entry Fees & Entry Packages",
    body:
      "Each round has a published entry fee. You may enter a round once, or purchase a multi-entry package (for example, packages covering 5 or 10 entries) where offered, up to the maximum number of entries Perfect 2 allows per user per round for that sport. A multi-entry package is charged as a single amount from your Perfect 2 Balance — never as separate charges per entry — but each entry within a package is completely independent: it has its own selections and its own Perfect / Not Perfect / Pending result. Entry fees and package pricing may change between rounds; the price you actually paid for an entry or package is fixed at the time of purchase and is never changed retroactively.",
  },
  {
    heading: "6. Making Selections",
    body:
      "You choose your players from the eligible players Perfect 2 lists for each game, using real team and player data synced from Perfect 2's sports-data sources. You may change your selections at any time before the round's cutoff. Once a game locks, the selections for that game can no longer be changed, even if other games in the round have not yet locked.",
  },
  {
    heading: "7. Round Cutoff Times",
    body:
      "A round's entry cutoff is the scheduled kickoff/tip-off time of the first game in that round, shown to you in Australian local time but calculated from the exact, authoritative kickoff time recorded in Perfect 2's systems (in UTC) — never midnight, never the last game in the round, and never a time supplied by your device or app. No new entries or selection changes are accepted after this cutoff.",
  },
  {
    heading: "8. Prize Pool",
    body:
      "Each round has a prize pool amount set by Perfect 2 for that round, which may be increased by rollover carried in from a previous round of the same sport (see Section 11). The prize pool is not automatically calculated as a percentage of entry fees collected; it is a configured amount. TO BE CONFIRMED — PENDING LEGAL REVIEW: the final methodology used to set each round's prize pool once real-money entries are enabled.",
  },
  {
    heading: "9. Prize Pool Visibility",
    body:
      "The dollar amount of a round's prize pool is not shown to entrants until the round's first game has actually kicked off. Before that point you can see that a prize pool exists but not its exact value. This is a deliberate, sport-by-sport rule and is never affected by which device or region you're viewing Perfect 2 from.",
  },
  {
    heading: "10. Winning a Round",
    body:
      "To win, every one of your selections across the entire round must be correct — going Perfect. If exactly one entry goes Perfect, that entry takes the whole prize pool. If more than one entry goes Perfect, the prize pool is split evenly in whole cents among every Perfect entry (see the allocation method in Section 11). If no entry goes Perfect, nobody wins that round and the entire prize pool rolls over as described below.",
  },
  {
    heading: "11. Rollover",
    body:
      "If a round settles with zero Perfect entries, the entire prize pool for that round — 100% of it, with nothing retained by Perfect 2 — carries forward into the next round of the same sport, added on top of that round's own prize pool. Rollover only ever moves between consecutive rounds of the same sport; it is never combined across NRL, AFL, and NBA. When a prize pool is split among multiple Perfect entries, any amount that cannot be divided evenly in whole cents is allocated one cent at a time to the lowest-numbered entries so that the full pool is always paid out exactly, with no cent lost or invented.",
  },
  {
    heading: "12. Results & Sports Data",
    body:
      "Results are determined from real statistics recorded against the official record of each game, sourced from Perfect 2's sports-data providers. Perfect 2 never estimates, guesses, or fabricates a statistic — a selection remains Pending until the relevant game is marked final in Perfect 2's systems. Occasionally a data provider may correct a statistic after a game is marked final; Perfect 2 may re-settle affected entries if this happens.",
  },
  {
    heading: "13. Postponed & Cancelled Games",
    body:
      "If a game in your round is postponed or cancelled, it does not automatically count as a loss or a win for either of your selections in that game. An admin will review postponed/cancelled games and resolve affected selections manually, which may include voiding them (removing that game's impact on your entry's overall result without guessing an outcome that never happened) or another resolution as the circumstances require. This process is never automatic and never assumes an outcome from missing data.",
  },
  {
    heading: "14. Player Non-Participation",
    body:
      "If a player you selected does not take the field or court for their team's game (for example, due to injury, suspension, or a late team change), Perfect 2 does not automatically declare that selection a win or a loss. An admin reviews these situations and resolves the affected selection manually and consistently, following the same principle as Section 13 — never guessing a result from missing data.",
  },
  {
    heading: "15. Winnings",
    body:
      "Winnings from a Perfect entry are credited to your Perfect 2 Balance once a round is settled. Winnings are recorded as their own ledger entry, separate from deposits and entry purchases, so you can always see exactly how much you've won and when.",
  },
  {
    heading: "16. Withdrawals",
    body:
      "You may request a withdrawal of funds from your Perfect 2 Balance. Requesting a withdrawal does not immediately deduct funds — your balance is only reduced once Perfect 2 has processed and completed the withdrawal. Perfect 2 may take a reasonable period to review and process a withdrawal request, and may decline a request where reasonably necessary (for example, suspected fraud). TO BE CONFIRMED — PENDING LEGAL REVIEW: the specific real-world payout mechanism, timeframes, and any withdrawal limits that will apply once real-money withdrawals are enabled — no such mechanism exists yet.",
  },
  {
    heading: "17. Refunds",
    body:
      "Where a round or entry cannot fairly proceed (for example, a round is cancelled outright), Perfect 2 will refund the affected amount to your Perfect 2 Balance as its own ledger entry, distinct from a withdrawal or a winning credit. Refunds are issued at Perfect 2's reasonable discretion based on the circumstances.",
  },
  {
    heading: "18. Responsible Gambling",
    body:
      "Perfect 2 is intended to be played for entertainment, not as a way to make money or solve financial difficulty. If gambling stops being fun or starts to feel like a problem, please stop playing and seek support. TO BE CONFIRMED — PENDING LEGAL REVIEW: the specific responsible-gambling tools (deposit limits, self-exclusion, and similar) and support-service references Perfect 2 will provide once real-money play is enabled, as required by applicable Australian regulation.",
  },
  {
    heading: "19. Privacy",
    body:
      "Perfect 2 collects the account, competition, and payment information reasonably necessary to operate the service, and handles it in line with its Privacy Policy. TO BE CONFIRMED — PENDING LEGAL REVIEW: the finalised Privacy Policy, to be published and linked here before any real-money feature is enabled.",
  },
  {
    heading: "20. Suspension & Termination",
    body:
      "Perfect 2 may suspend or close your account where it reasonably believes you have breached these Terms, engaged in fraud or prohibited conduct, or where required by law. Where an account is suspended or closed, any remaining Perfect 2 Balance not connected to the reason for suspension will generally remain available to withdraw, subject to Perfect 2's standard review process.",
  },
  {
    heading: "21. Fraud & Prohibited Conduct",
    body:
      "You must not use Perfect 2 to launder money, exploit software errors, collude with other entrants, hold multiple accounts, or otherwise act dishonestly. Perfect 2 may void entries, withhold winnings connected to the conduct, and/or suspend or close an account where it reasonably suspects any of the above.",
  },
  {
    heading: "22. Technical Issues",
    body:
      "Perfect 2 will make reasonable efforts to keep the service available and its data accurate, but does not guarantee uninterrupted access. Where a genuine technical fault affects a round or entry unfairly, Perfect 2 will resolve it as fairly as reasonably possible, which may include a void, a refund, or another remedy appropriate to the fault.",
  },
  {
    heading: "23. Changes to Perfect 2",
    body:
      "Perfect 2 may update these Terms, its rules, pricing, or features from time to time. Material changes will be published as a new version with its own effective date, and your historical acceptance of a previous version is always preserved exactly as it was at the time you accepted it — a later change is never applied retroactively to a round you already entered under the previous Terms.",
  },
  {
    heading: "24. Complaints & Disputes",
    body:
      "If you believe a result, charge, or account action was handled incorrectly, contact Perfect 2 support with the details so it can be reviewed. TO BE CONFIRMED — PENDING LEGAL REVIEW: the finalised complaints-handling process and any external dispute-resolution scheme Perfect 2 will participate in once real-money play is enabled.",
  },
  {
    heading: "25. Operator & Regulatory Information",
    body:
      "TO BE CONFIRMED — PENDING LEGAL REVIEW: the registered operator of Perfect 2, its business/company details, and any gambling licence or regulatory authorisation held. No such licence or authorisation currently exists, and Perfect 2 does not represent or imply otherwise. Real-money deposits, entries, and withdrawals remain disabled until this section is completed and confirmed.",
  },
  {
    heading: "26. Applicable Law",
    body:
      "TO BE CONFIRMED — PENDING LEGAL REVIEW: the Australian state/territory whose law will govern these Terms and the courts with jurisdiction over any dispute, to be finalised as part of legal review.",
  },
];

async function main() {
  const db = getDb();
  const existing = await db.select().from(schema.termsVersions).where(eq(schema.termsVersions.versionNumber, VERSION_NUMBER)).limit(1);
  if (existing[0]) {
    console.log(`Terms version ${VERSION_NUMBER} already exists (id=${existing[0].id}, status=${existing[0].status}) — nothing to do.`);
    return;
  }

  const [draft] = await db
    .insert(schema.termsVersions)
    .values({
      versionNumber: VERSION_NUMBER,
      effectiveDate: new Date().toISOString().slice(0, 10),
      content: SECTIONS,
      status: "draft",
    })
    .returning();
  console.log(`Created draft terms version ${VERSION_NUMBER} (id=${draft.id}).`);

  const [published] = await db
    .update(schema.termsVersions)
    .set({ status: "published", publishedAt: new Date(), updatedAt: new Date() })
    .where(eq(schema.termsVersions.id, draft.id))
    .returning();
  console.log(`Published terms version ${VERSION_NUMBER} (id=${published.id}, publishedAt=${published.publishedAt}).`);
}

main().catch((err) => {
  console.error("Seed failed:", err);
  process.exit(1);
});
