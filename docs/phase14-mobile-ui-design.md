# Phase 14 — Mobile UI/UX Design System

Primary visual reference: `docs/phase14-design-reference.png`.

## 1. Brand & color system

Strict three-color palette — no exceptions:

| Token | Value | Use |
|---|---|---|
| `colors.background` | `#000000` | App/screen background |
| `colors.surface` | `#0A0A0A` | Cards |
| `colors.surfaceRaised` | `#141414` | Nested surfaces (pick rows, result rows) |
| `colors.border` / `borderStrong` | `#232323` / `#333333` | Hairlines, outlined buttons |
| `colors.foreground` | `#FFFFFF` | Primary text |
| `colors.muted` / `muted2` | `#B8B8B8` / `#6B6B6B` | Secondary/tertiary text — grey is a *neutral variation*, never a fourth brand color |
| `colors.brand` / `brandStrong` | `#00E676` / `#00B85A` | Electric green accent, primary buttons, "positive" states |
| `colors.brandSoft` / `brandBorder` | rgba tints of brand | Soft badge/card fills |
| `colors.neutralSoft` / `neutralBorder` | rgba tints of white | Neutral badge fills (replaces the old gold/danger tones) |

There is deliberately **no red/danger color**. The old palette used gold for "pending/settled" and red for "incorrect/not perfect." Both are gone. A negative or neutral state is now conveyed by tone (grey vs. green) **plus an icon** (an X-circle for incorrect/not-perfect, a clock for pending) — never by a third hue. This was a direct requirement of the reference brief ("Use greys as neutral variations only").

Source of truth: `mobile/constants/theme.ts`.

## 2. Icon library

`@expo/vector-icons` is deprecated as of the current Expo SDK (confirmed against live Expo docs before installing anything — see `mobile/AGENTS.md`). Installed `@react-native-vector-icons/lucide` + `@react-native-vector-icons/common` + `expo-font` instead, matching the reference brief's own suggestion ("e.g. Lucide"). Every icon in the app is referenced through one wrapper, `mobile/components/icons.tsx`, which maps semantic names (`home`, `entries`, `account`, `pending`, `checkCircle`, `xCircle`, `trophy`, …) to Lucide glyphs, so no screen imports the icon font directly. No emoji anywhere in the app.

## 3. Typography & spacing

`typography.overline` (tracked, uppercase, 12px/700) was added for eyebrow labels and taglines — used for "PICK 2. ALL GAMES. PERFECT ROUND." and section labels like "GAMES" / "WINNERS", matching the reference's tracked-caps headings. `radius` gained an `xl` (20) step for the more premium, rounded card corners in the reference. Everything else (spacing scale, touch targets) carried over from Phase 12/13 unchanged.

## 4. Design system — components

29 named, reusable components in `mobile/components/`, replacing five ad hoc files:

**Primitives:** `Button`, `IconButton`, `Card`, `Divider`, `Pill`, `Logo`
**Badges:** `Badge`, `SelectionBadge`, `PerfectBadge`, `CompetitionStateBadge`, `GameStatusBadge`
**Layout/text:** `ScreenHeader`, `SectionLabel`, `InfoRow`, `ProgressBar`, `StatCard`
**Forms:** `TextField`, `SearchInput`
**States:** `LoadingState`, `ErrorState`, `EmptyState`
**Domain:** `SportEntryCard`, `RoundListItem`, `GameCard`, `PlayerPickRow`, `PlayerListItem`, `ResultRow`, `PlayerPickerSheet`
**Icons:** `Icon` (icons.tsx wrapper)

Every existing component's **exported name and prop shape was kept identical** to its Phase 12/13 version (`SelectionBadge`, `PerfectBadge`, `CompetitionStateBadge`, `GameStatusBadge`, `LoadingState`, `ErrorState`, `EmptyState`, `PlayerPickerSheet`) — only the internal styling changed. No screen had to change how it calls these components beyond the new visual look.

## 5. Screens redesigned

Login, Register, Home, NRL/AFL round list, Round detail, Enter picks, Review, Confirmation, Results, My Entries (new tab, replacing the entries list previously embedded in Account), My Entry detail, Account (simplified to profile + logout).

## 6. Navigation change

Bottom tab bar is now **Home / My Entries / Account** (3 tabs, Lucide icons: `house`, `clipboard-list`, `circle-user`), matching the reference exactly. The NRL and AFL screens still exist at the same routes (`/(tabs)/nrl`, `/(tabs)/afl`) and are still how the user gets from Home into a sport — they're just no longer bottom-tab destinations (`options.href: null` in `(tabs)/_layout.tsx` keeps the route registered without a tab icon). Home's sport cards navigate to them exactly as before. No route paths changed, so no deep link or back-stack behavior changed.

## 7. The one additive API change

The reference's round-list rows show entry fee, prize, and open/close status per round. The existing `GET /api/[sport]/rounds` endpoint didn't return that — only `GET /api/[sport]/rounds/[roundId]` (the detail endpoint) did. Rather than fabricate this data client-side, `src/app/api/[sport]/rounds/route.ts` now also calls the same **existing, read-only** `getCompetitionForRound` + `getEffectiveCompetitionState` functions the detail endpoint already uses, and adds one new field per round:

```ts
competition: { state, entryFeeCents, prizeAmountCents, opensAt, closesAt } | null
```

This is purely additive — every existing field is unchanged, nothing is written, no schema/migration, no new business rule. It's the same pattern already proven in the round-detail route. Treated as "strictly necessary for presentation" per the brief's own carve-out, since the reference image explicitly shows this data on this screen.

## 8. Deliberate scope exclusions

- **"ROUNDS / PAST" segmented toggle** shown in the reference's round-list mock was **not** built. There's no existing concept of a round being filtered into "past" vs. "current" server-side, and adding one would be a new feature/filter, which the brief explicitly prohibits ("Do not add new features"). The full round list still renders; a decorative, non-functional toggle would have been worse than omitting it.
- **Real NRL/AFL team crest images**: the reference mock shows a team badge icon next to matchups. No crest assets exist in this project and none were fabricated. Sport badges use a text-based mark (e.g. "NRL" in a green-bordered square) instead, consistent with "use official logos where available (if already in the project)" — they weren't.
- Champion Data, payments, competition rules, settlement logic, entry validation, auth architecture, DB schema, and the sports-data abstraction were **not touched** — see the regression section of the final report.
