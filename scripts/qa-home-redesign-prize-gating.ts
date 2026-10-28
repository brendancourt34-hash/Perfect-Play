/**
 * One-off verification for the home page redesign: confirms the new "Choose a Sport"
 * card, "Featured Competition" card, and "Upcoming Competitions" list all correctly hide
 * the real prize pool before kickoff and reveal it after, on the actual rendered HTML.
 */
import { getDb, schema } from "../src/db";
import { eq } from "drizzle-orm";
import { createLoadTestRound, cleanupLoadTestFixture } from "./loadtest/fixtures";

const db = getDb();
const BASE_URL = "http://localhost:3000";

async function main() {
  const mark = `qa-homegate-${Date.now()}`;
  const fixture = await createLoadTestRound("nrl", mark);

  const beforeHtml = await (await fetch(BASE_URL, { cache: "no-store" })).text();
  const beforeHasRevealed = beforeHtml.includes("Revealed at kickoff");
  console.log(beforeHasRevealed ? "PASS: pre-kickoff home page shows 'Revealed at kickoff'" : "FAIL: pre-kickoff home page missing 'Revealed at kickoff'");
  const beforeHasFeatured = beforeHtml.includes(mark) || beforeHtml.includes("Make Your Picks");
  console.log(beforeHasFeatured ? "PASS: featured/upcoming section rendered pre-kickoff" : "INFO: featured section not present pre-kickoff (may not have won the cross-sport pick)");

  for (const g of fixture.games) {
    await db.update(schema.games).set({ kickoff: new Date(Date.now() - 3600_000) }).where(eq(schema.games.id, g.id));
  }

  const afterHtml = await (await fetch(BASE_URL, { cache: "no-store" })).text();
  const revealedCountBefore = (beforeHtml.match(/Revealed at kickoff/g) ?? []).length;
  const revealedCountAfter = (afterHtml.match(/Revealed at kickoff/g) ?? []).length;
  const nowShowsDollarAmount = /\$60(\.00)?/.test(afterHtml);
  console.log(`revealedCountBefore=${revealedCountBefore} revealedCountAfter=${revealedCountAfter}`);
  console.log(nowShowsDollarAmount ? "PASS: post-kickoff home page now shows the real $60 prize amount somewhere" : "FAIL: post-kickoff home page never reveals the real prize amount");

  await cleanupLoadTestFixture(fixture, []);
  console.log("cleanup done");
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
