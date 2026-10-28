/**
 * Seeds and publishes Perfect Play Terms & Conditions v2.0 — a complete, section-by-section
 * rewrite of v1.0 (scripts/seed-terms-v1.ts), which described the old "Perfect 2" product
 * (2 picks per game, NRL/AFL/NBA only, NBA 20+ points, and rollover wording that wrongly
 * implied 100% of entry money — not just the Prize Pool — rolls over with nothing ever
 * retained). This version describes the CURRENT Perfect Play product exactly: NRL, AFL,
 * NBA, and NFL, each a separate Competition; exactly 1 selection per game; the real
 * per-sport success rules; Prize Pool vs Entry Funds as distinct defined terms (so the
 * Terms never claim or imply 100% of entry money becomes prize money, without disclosing
 * the internal commercial allocation percentage anywhere); and the real rollover
 * mechanics, including carrying a season's final, unclaimed Prize Pool into Round 1 of
 * the following season for the same Sport.
 *
 * Idempotent: if version "2.0" already exists, this does nothing. This remains DRAFT
 * content pending real Australian gambling-law legal review — every regulatory/operator
 * detail that cannot yet be truthfully stated is marked "TO BE CONFIRMED — PENDING LEGAL
 * REVIEW", exactly as v1.0 did. It must never be treated as final, compliant, or legally
 * reviewed until an actual lawyer has done so.
 *
 *   npx dotenv -e .env.local -- npx tsx scripts/seed-terms-v2.ts
 */
import { getDb, schema } from "../src/db";
import { eq } from "drizzle-orm";
import type { TermsSection } from "../src/db/schema";
import { publishTermsVersion } from "../src/lib/data/terms";

const VERSION_NUMBER = "2.0";

const SECTIONS: TermsSection[] = [
  {
    heading: "1. Definitions",
    body:
      "\"Perfect Play\" means the Perfect Play competition platform, accessible via the Perfect Play app and website.\n\n" +
      "\"Sport\" means one of the sports Perfect Play currently offers a Competition for: NRL, AFL, NBA, and NFL. Each Sport's Competitions are entirely separate from every other Sport's — they are never combined, compared, or pooled together.\n\n" +
      "\"Competition\" means a single round of a Sport that entrants may enter — for example, one week's Perfect Play NRL Competition. Each Competition has its own entrants, its own selections, and its own Prize Pool.\n\n" +
      "\"Entry\" means one paid entry into a Competition, consisting of one selection per game in that Competition.\n\n" +
      "\"Entry Funds\" means amounts received by Perfect Play in connection with Entries into a Competition (including single entries and multi-entry packages).\n\n" +
      "\"Prize Pool\" means the amount allocated to prizes for a particular Competition from the applicable eligible Entry Funds, together with any Rollover amount carried in from a previous Competition in accordance with these Terms. Entry Funds that are not allocated to the Prize Pool are not part of the Prize Pool.\n\n" +
      "\"Rollover\" means the Prize Pool carried forward from a Competition to a later Competition of the same Sport because no Entry achieved a PERFECT result, as described in Section 14.\n\n" +
      "\"CORRECT\" and \"INCORRECT\" describe the outcome of one selection within one game. \"PENDING\" means a selection or Entry has not yet been determined.\n\n" +
      "\"PERFECT\" means every selection in an Entry was CORRECT. \"NOT PERFECT\" means at least one selection in an Entry was INCORRECT.\n\n" +
      "\"Competition Cutoff\" means the point after which no new Entries or selection changes are accepted for a Competition, as described in Section 9.",
  },
  {
    heading: "2. How Perfect Play Works",
    body:
      "Perfect Play runs separate pick'em Competitions for four Sports — NRL, AFL, NBA, and NFL. Each Sport is its own Competition with its own round, entries, and Prize Pool; results and prizes are never combined or compared across Sports. In each Competition you make exactly one selection per game: pick one qualifying player in every game, get every selection right, and your Entry goes PERFECT. There is no points system, no leaderboard, and no fantasy-style scoring — an Entry is simply PENDING, PERFECT, or NOT PERFECT once every game in the Competition is final. One INCORRECT selection means the whole Entry is NOT PERFECT; there is no partial credit.",
  },
  {
    heading: "3. Competition Rules by Sport",
    body:
      "Each Sport has its own selection type and success requirement. The exact number of games in a given Competition is set by Perfect Play for that Competition (for NRL, AFL, and NFL this is normally 8 games for NRL and NFL and 9 games for AFL, but Perfect Play may run a Competition with a different number of games where the real-world fixture requires it — for example a bye-affected week). NBA Competitions are always run over a fixed set of 8 games. Your Entry must include exactly one selection for every game in the Competition you enter.\n\n" +
      "NRL: pick a try scorer in every game. A selection is CORRECT if that player scores 1 or more tries in that game. Your Entry is PERFECT only if every selection in the Competition is CORRECT.\n\n" +
      "AFL: pick a goal scorer in every game. A selection is CORRECT if that player kicks 1 or more goals in that game. Your Entry is PERFECT only if every selection in the Competition is CORRECT.\n\n" +
      "NBA: pick a player in every selected game. A selection is CORRECT if that player scores 25 or more points in that game — 24 points or fewer is INCORRECT. Your Entry is PERFECT only if every selection in the Competition is CORRECT.\n\n" +
      "NFL: pick a touchdown scorer in every selected game. A selection is CORRECT if that player scores 1 or more touchdowns in that game. Your Entry is PERFECT only if every selection in the Competition is CORRECT.",
  },
  {
    heading: "4. Eligibility",
    body:
      "You must be at least 18 years old and located in a jurisdiction where participation in Perfect Play is lawful to register an account or enter a Competition. Perfect Play may ask you to verify your age and identity before allowing a deposit, entry, or withdrawal, and may restrict or decline service to anyone it reasonably believes does not meet these requirements. TO BE CONFIRMED — PENDING LEGAL REVIEW: the specific jurisdictions in which Perfect Play is available, and any additional licensing-driven eligibility requirements.",
  },
  {
    heading: "5. Registration & Account",
    body:
      "You need a Perfect Play account to enter any Competition. You must provide accurate registration details and keep your login credentials secure — you are responsible for activity that occurs under your account unless you can show it resulted from Perfect Play's own fault. Each person may hold only one Perfect Play account.",
  },
  {
    heading: "6. Perfect Play Balance (Deposits)",
    body:
      "Your Perfect Play Balance is your account's internal, stored-value balance. You add funds to it through the payment methods Perfect Play makes available at the time; Entry Funds are paid out of this balance, and any winnings or refunds are credited back to it. Every movement of your balance — deposits, entries, winnings, refunds, withdrawals, and any administrative adjustment — is recorded as an individual, permanent ledger entry that you can review at any time. Real-money deposits, entries, and withdrawals remain disabled while Perfect Play completes Australian gambling-law legal review; this section describes how the feature will work once enabled.",
  },
  {
    heading: "7. Entry Funds & Entry Packages",
    body:
      "Each Competition has a published entry fee. You may enter a Competition once, or purchase a multi-entry package where offered, up to the maximum number of Entries Perfect Play allows per user per Competition for that Sport. A multi-entry package is charged as a single amount of Entry Funds from your Perfect Play Balance — never as separate charges per Entry — but each Entry within a package is completely independent: it has its own selections and its own PENDING, PERFECT, or NOT PERFECT result. Entry fees and package pricing may change between Competitions; the amount you actually paid for an Entry or package is fixed at the time of purchase and is never changed retroactively.",
  },
  {
    heading: "8. Making Selections",
    body:
      "You choose your selection from the eligible players Perfect Play lists for each game, using real team and player data from Perfect Play's sports-data sources. You may change your selections at any time before the Competition Cutoff. Once a game locks, the selection for that game can no longer be changed, even if other games in the Competition have not yet locked.",
  },
  {
    heading: "9. Competition Cutoff",
    body:
      "A Competition's cutoff is the earliest scheduled kickoff or start time among the games in that Competition, calculated from the exact, authoritative game-start time recorded in Perfect Play's systems and shown to you in Australian local time — never midnight, never the last game in the Competition, and never a time supplied by your device or app. Games in a Competition may start at different times; entries close at the Competition Cutoff, not at each individual game's own start time. No new Entries or selection changes are accepted after the Competition Cutoff, and this is enforced by Perfect Play's systems, not merely by the app you are using.",
  },
  {
    heading: "10. Prize Pool",
    body:
      "Each Competition has a Prize Pool: the amount allocated to prizes for that Competition from the applicable eligible Entry Funds, plus any Rollover carried in from a previous Competition of the same Sport (see Section 14). The Prize Pool is not the same as, and is not necessarily equal to, the total Entry Funds received for that Competition — amounts not allocated to the Prize Pool are not part of it and may be retained or otherwise allocated by Perfect Play and/or its applicable licensed wagering or commercial partner in accordance with the applicable arrangements and law. TO BE CONFIRMED — PENDING LEGAL REVIEW: the final methodology used to set each Competition's Prize Pool once real-money entries are enabled.",
  },
  {
    heading: "11. Prize Pool Visibility",
    body:
      "The dollar amount of a Competition's Prize Pool is not shown to entrants until the Competition Cutoff has passed. Before that point, the app shows that a Prize Pool exists and displays \"Revealed at kickoff\" rather than a dollar figure. This is a deliberate, Sport-by-Sport rule and is never affected by which device or region you're viewing Perfect Play from. Perfect Play does not promise or imply any fixed Prize Pool amount before it is revealed.",
  },
  {
    heading: "12. PERFECT Result & Winning a Competition",
    body:
      "To win a share of a Competition's Prize Pool, every one of your selections in that Competition must be CORRECT — your Entry must be PERFECT. If exactly one Entry is PERFECT, that Entry receives the entire Prize Pool for that Competition. Where Perfect Play's marketing describes this as \"taking the entire pool,\" \"pool\" in that context means the Prize Pool, not the total Entry Funds received for the Competition. If more than one Entry is PERFECT, the Prize Pool is divided equally between the eligible PERFECT Entries, as described in Section 13. If no Entry is PERFECT, no prize is awarded from the Prize Pool for that Competition and the entire Prize Pool rolls over, as described in Section 14.",
  },
  {
    heading: "13. Multiple PERFECT Entries",
    body:
      "Where more than one Entry achieves a PERFECT result in the same Competition, the Prize Pool is divided equally between those Entries: for example, 2 PERFECT Entries each receive 50% of the Prize Pool, 3 PERFECT Entries each receive one-third, and so on. Where an equal division would not divide the Prize Pool into whole cents, Perfect Play allocates the remaining one-cent amounts using its standard deterministic method, so that the full Prize Pool is always distributed in whole cents with no amount lost or invented.",
  },
  {
    heading: "14. Rollover — No PERFECT Entry",
    body:
      "If no eligible Entry achieves a PERFECT result for a Competition, no prize is awarded from the Prize Pool for that Competition. The full amount of that Competition's Prize Pool — and only the Prize Pool — rolls over and is added to the Prize Pool for the next applicable Competition for the same Sport, subject to these Terms. Rollover only ever moves between Competitions of the same Sport; it is never combined across NRL, AFL, NBA, and NFL.\n\n" +
      "Entry Funds or other amounts that were not allocated to the Prize Pool in the first place do not form part of the Rollover amount, and are not affected by whether a Competition produces a PERFECT Entry. Perfect Play and its applicable commercial or wagering partner do not contribute any amount they have retained or been allocated to the Rollover.",
  },
  {
    heading: "15. Final Competition of a Season",
    body:
      "If no eligible Entry achieves a PERFECT result in the final Competition of a season for a Sport, the Prize Pool for that Competition carries forward to the first applicable Competition of the following season for the same Sport, rather than being forfeited, subject to these Terms. As with any other Rollover, only the Prize Pool carries forward — amounts Perfect Play or its applicable partner has retained or been allocated are never carried forward, and a Rollover never moves between different Sports.",
  },
  {
    heading: "16. Results & Sports Data",
    body:
      "Results are determined from statistics recorded against the official record of each game, sourced from Perfect Play's official or authorised sports-data provider for that Sport. Perfect Play never estimates, guesses, or fabricates a statistic — a selection remains PENDING until the relevant game is marked final in Perfect Play's systems. Not every Sport necessarily has an active, connected sports-data provider at all times; where a Sport's data provider is not yet configured, Perfect Play will not open or settle a real-money Competition for that Sport until it is. Occasionally an official result may be corrected after a game is marked final; Perfect Play may re-settle affected Entries if this happens.",
  },
  {
    heading: "17. Postponed & Cancelled Games",
    body:
      "If a game in your Competition is postponed or cancelled, it does not automatically count as a CORRECT or INCORRECT result for your selection in that game. Perfect Play will resolve affected selections, which may include voiding them — meaning that game no longer affects whether your Entry can be PERFECT, without guessing a result that never happened — or applying another resolution appropriate to the circumstances. This process is never automatic and never assumes an outcome from missing data.",
  },
  {
    heading: "18. Player Non-Participation",
    body:
      "If a player you selected does not take part in their team's game (for example, due to injury, suspension, or a late team change), Perfect Play does not automatically treat that selection as CORRECT or INCORRECT. Perfect Play reviews these situations and resolves the affected selection consistently, following the same principle as Section 17 — never guessing a result from missing data.",
  },
  {
    heading: "19. Winnings",
    body:
      "Winnings from a PERFECT Entry are credited to your Perfect Play Balance once a Competition is settled. Winnings are recorded as their own ledger entry, separate from deposits and entries, so you can always see exactly how much you've won, from which Competition, and when.",
  },
  {
    heading: "20. Withdrawals",
    body:
      "You may request a withdrawal of funds from your Perfect Play Balance. Requesting a withdrawal does not immediately deduct funds — your balance is only reduced once Perfect Play has processed and completed the withdrawal. Perfect Play may take a reasonable period to review and process a withdrawal request, and may decline a request where reasonably necessary (for example, suspected fraud). TO BE CONFIRMED — PENDING LEGAL REVIEW: the specific real-world payout mechanism, timeframes, and any withdrawal limits that will apply once real-money withdrawals are enabled — no such mechanism exists yet.",
  },
  {
    heading: "21. Refunds",
    body:
      "Where a Competition or Entry cannot fairly proceed (for example, a Competition is cancelled outright), Perfect Play will refund the affected Entry Funds to your Perfect Play Balance as its own ledger entry, distinct from a withdrawal or a winning credit. Refunds are issued at Perfect Play's reasonable discretion based on the circumstances.",
  },
  {
    heading: "22. Responsible Gambling",
    body:
      "Perfect Play is intended to be played for entertainment, not as a way to make money or solve financial difficulty. If gambling stops being fun or starts to feel like a problem, please stop playing and seek support. TO BE CONFIRMED — PENDING LEGAL REVIEW: the specific responsible-gambling tools (deposit limits, self-exclusion, and similar) and support-service references Perfect Play will provide once real-money play is enabled, as required by applicable Australian regulation.",
  },
  {
    heading: "23. Privacy",
    body:
      "Perfect Play collects the account, competition, and payment information reasonably necessary to operate the service, and handles it in line with its Privacy Policy. TO BE CONFIRMED — PENDING LEGAL REVIEW: the finalised Privacy Policy, to be published and linked here before any real-money feature is enabled.",
  },
  {
    heading: "24. Suspension & Termination",
    body:
      "Perfect Play may suspend or close your account where it reasonably believes you have breached these Terms, engaged in fraud or prohibited conduct, or where required by law. Where an account is suspended or closed, any remaining Perfect Play Balance not connected to the reason for suspension will generally remain available to withdraw, subject to Perfect Play's standard review process.",
  },
  {
    heading: "25. Fraud & Prohibited Conduct",
    body:
      "You must not use Perfect Play to launder money, exploit software errors, collude with other entrants, hold multiple accounts, or otherwise act dishonestly. Perfect Play may void Entries, withhold winnings connected to the conduct, exclude an Entry from Prize Pool eligibility, and/or suspend or close an account where it reasonably suspects any of the above.",
  },
  {
    heading: "26. Technical Issues",
    body:
      "Perfect Play will make reasonable efforts to keep the service available and its data accurate, but does not guarantee uninterrupted access. Where a genuine technical fault affects a Competition or Entry unfairly, Perfect Play will resolve it as fairly as reasonably possible, which may include voiding an Entry or selection, a refund, or another remedy appropriate to the fault.",
  },
  {
    heading: "27. Changes to Perfect Play",
    body:
      "Perfect Play may update these Terms, its rules, pricing, or features from time to time. Material changes will be published as a new version with its own effective date, and your historical acceptance of a previous version is always preserved exactly as it was at the time you accepted it — a later change is never applied retroactively to a Competition you already entered under the previous Terms.",
  },
  {
    heading: "28. Complaints & Disputes",
    body:
      "If you believe a result, charge, or account action was handled incorrectly, contact Perfect Play support with the details so it can be reviewed. TO BE CONFIRMED — PENDING LEGAL REVIEW: the finalised complaints-handling process and any external dispute-resolution scheme Perfect Play will participate in once real-money play is enabled.",
  },
  {
    heading: "29. Operator & Regulatory Information",
    body:
      "TO BE CONFIRMED — PENDING LEGAL REVIEW: the registered operator of Perfect Play, its business/company details, and any gambling licence or regulatory authorisation held by Perfect Play and/or its applicable licensed wagering partner. No such licence or authorisation currently exists, and Perfect Play does not represent or imply otherwise. Real-money deposits, entries, and withdrawals remain disabled until this section is completed and confirmed.",
  },
  {
    heading: "30. Applicable Law",
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

  // Uses the real publish path (src/lib/data/terms.ts), not a hand-rolled status update —
  // that's what correctly archives whatever version (v1.0) is currently published, keeping
  // the "at most one published version" invariant relied on by getCurrentPublishedTerms.
  const result = await publishTermsVersion(draft.id);
  if (result.status !== "ok") {
    console.error(`Failed to publish terms version ${VERSION_NUMBER}:`, result);
    process.exit(1);
  }
  console.log(`Published terms version ${VERSION_NUMBER} (id=${result.version.id}, publishedAt=${result.version.publishedAt}).`);
}

main().catch((err) => {
  console.error("Seed failed:", err);
  process.exit(1);
});
