/**
 * Mirrors src/lib/sports/config.ts on the web — static routing/labels only, never
 * business rules. `resultTerms` is a purely cosmetic override (Phase 22): NBA says
 * "HIT"/"MISS"/"WINNER"/"FAILED" instead of NRL/AFL/NFL's "Correct"/"Incorrect"/"Perfect"/
 * "Not Perfect" — same underlying tri-state value, same settlement rules, just different
 * words (see components/StatusBadge.tsx's ResultLabelOverrides).
 *
 * Phase 23F: every sport moved from "pick 2 players per game" to "pick the Perfect
 * Round" — one player per game. `pickLabel` is framed around completing the Perfect
 * Round, never old "pick 2" language.
 */
export const SPORTS = {
  nrl: {
    code: "nrl",
    slug: "nrl",
    name: "NRL",
    fullName: "National Rugby League",
    pickLabel: "Pick a try scorer in every game.",
    revealPhrase: "revealed at kickoff",
  },
  afl: {
    code: "afl",
    slug: "afl",
    name: "AFL",
    fullName: "Australian Football League",
    pickLabel: "Pick a goal scorer in every game.",
    revealPhrase: "revealed at first bounce",
  },
  nba: {
    code: "nba",
    slug: "nba",
    name: "NBA",
    fullName: "National Basketball Association",
    pickLabel: "Pick a player to score 25+ points in every game.",
    resultTerms: { correct: "HIT", incorrect: "MISS", perfect: "WINNER", notPerfect: "FAILED" },
    revealPhrase: "revealed at tip off",
  },
  nfl: {
    code: "nfl",
    slug: "nfl",
    name: "NFL",
    fullName: "National Football League",
    pickLabel: "Pick a touchdown scorer in every game.",
    revealPhrase: "revealed at kickoff",
  },
} as const;

export type SportSlug = keyof typeof SPORTS;

export function isSportSlug(value: string): value is SportSlug {
  return value === "nrl" || value === "afl" || value === "nba" || value === "nfl";
}
