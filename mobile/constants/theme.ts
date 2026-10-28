/**
 * Perfect Play mobile design tokens — Option D "Scoreboard" (chosen Oct 2026).
 *
 * Matte black + steel greys with a single jersey-red accent. Square corners, condensed
 * uppercase display type (Saira Condensed) over Saira body text. Token NAMES are kept from
 * the previous system (brand, brandSoft, onBrand …) so every screen re-themes from here.
 *
 * Red is the accent, NOT an error colour: "incorrect" / "not perfect" stay neutral grey
 * plus an icon (see components/icons.tsx), so a red pick always means good news.
 */
export const colors = {
  background: "#0E0F11",
  surface: "#17191C",
  surfaceRaised: "#1E2024",
  surfaceSunken: "#0A0B0C",
  border: "#2A2D32",
  borderStrong: "#3A3E45",

  foreground: "#F2F2F2",
  muted: "#A0A4AA",
  muted2: "#80858C",

  /** Solid fills: buttons, active states, PERFECT badges. White text sits on it. */
  brand: "#D7261C",
  brandStrong: "#B01E15",
  brandSoft: "rgba(215, 38, 28, 0.16)",
  brandBorder: "rgba(215, 38, 28, 0.55)",
  /** Red used as TEXT or icon colour on the dark background (passes 4.5:1). */
  brandText: "#FF5A4F",

  neutralSoft: "rgba(255, 255, 255, 0.06)",
  neutralBorder: "rgba(255, 255, 255, 0.14)",

  /** Text colour to place on top of a solid brand-red surface. */
  onBrand: "#FFFFFF",

  /** Day-to-day / questionable injury badge. */
  warning: "#FFB547",

  overlay: "rgba(0, 0, 0, 0.75)",
};

/** Font families — loaded in app/_layout.tsx via @expo-google-fonts. */
export const font = {
  w400: "Saira_400Regular",
  w500: "Saira_500Medium",
  w600: "Saira_600SemiBold",
  w700: "Saira_700Bold",
  w800: "Saira_800ExtraBold",
  w900: "Saira_800ExtraBold",
  display: "SairaCondensed_800ExtraBold",
  displayBold: "SairaCondensed_700Bold",
};

export const spacing = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32, xxxl: 48 };

/** Scoreboard look: square corners everywhere (`pill` is 0 too). Use `round` only for true circles such as dots. */
export const radius = { sm: 0, md: 0, lg: 0, xl: 0, pill: 0, round: 999 };

export const typography = {
  display: { fontSize: 44, fontFamily: font.display, textTransform: "uppercase" as const, lineHeight: 44 },
  title: { fontSize: 32, fontFamily: font.display, textTransform: "uppercase" as const, lineHeight: 34 },
  heading: { fontSize: 22, fontFamily: font.display, textTransform: "uppercase" as const },
  subheading: { fontSize: 16, fontFamily: font.w700 },
  body: { fontSize: 15, fontFamily: font.w400 },
  bodyStrong: { fontSize: 15, fontFamily: font.w600 },
  caption: { fontSize: 13, fontFamily: font.w500 },
  label: { fontSize: 12, fontFamily: font.w600 },
  /** Small tracked uppercase label, e.g. section eyebrows and taglines. */
  overline: { fontSize: 12, fontFamily: font.w700, letterSpacing: 1.4, textTransform: "uppercase" as const },
};

/** Minimum comfortable touch target (iOS HIG / Material both recommend ~44-48pt). */
export const minTouchTarget = 44;
