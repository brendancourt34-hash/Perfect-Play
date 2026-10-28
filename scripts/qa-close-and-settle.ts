/**
 * QA: exercises the competition lifecycle functions (Phase 9) directly against the real
 * QA competition — no HTTP route exposes these yet (intentionally, no admin UI built),
 * so this calls the same data-layer functions a future admin action/cron would call.
 */
import { closeCompetition } from "../src/lib/data/competitions";
import { settleCompetition } from "../src/lib/data/settlement";

async function main() {
  const competitionId = Number(process.argv[2]);
  const closeResult = await closeCompetition(competitionId);
  console.log("closeCompetition:", closeResult);

  const settleResult = await settleCompetition(competitionId);
  console.log("settleCompetition:", JSON.stringify(settleResult, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
