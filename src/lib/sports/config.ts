export interface SportConfig {
  code: string;
  slug: string;
  name: string;
  fullName: string;
  ruleSummary: string;
  /** Short instructional line for competition cards/entry flow —framed as part of completing the PERFECT ROUND, never as "pick 2"/old mechanics. */
  pickInstruction: string;
  /** Sentence-case phrase for "the prize pool is {revealPhrase}" — sport-specific because not every sport kicks off (AFL bounces, NBA tips off). Callers apply their own case transform. */
  revealPhrase: string;
}

export const SPORTS: Record<string, SportConfig> = {
  nrl: {
    code: "nrl",
    slug: "nrl",
    name: "NRL",
    fullName: "National Rugby League",
    ruleSummary: "$5 entry · pick the perfect round · a try scorer in every game",
    pickInstruction: "Pick a try scorer in every game.",
    revealPhrase: "revealed at kickoff",
  },
  afl: {
    code: "afl",
    slug: "afl",
    name: "AFL",
    fullName: "Australian Football League",
    ruleSummary: "$5 entry · pick the perfect round · a goal scorer in every game",
    pickInstruction: "Pick a goal scorer in every game.",
    revealPhrase: "revealed at first bounce",
  },
  nba: {
    code: "nba",
    slug: "nba",
    name: "NBA",
    fullName: "National Basketball Association",
    ruleSummary: "$5 entry · pick the perfect round · a player to score 25+ points in every game",
    pickInstruction: "Pick a player to score 25+ points in every game.",
    revealPhrase: "revealed at tip off",
  },
  nfl: {
    code: "nfl",
    slug: "nfl",
    name: "NFL",
    fullName: "National Football League",
    ruleSummary: "$5 entry · pick the perfect round · a touchdown scorer in every game",
    pickInstruction: "Pick a touchdown scorer in every game.",
    revealPhrase: "revealed at kickoff",
  },
};

export function getSportConfig(slug: string): SportConfig | null {
  return SPORTS[slug] ?? null;
}

export function listSportSlugs(): string[] {
  return Object.keys(SPORTS);
}
