/**
 * Perfect Play mobile design tokens — Phase 14 design system.
 *
 * Strict brand palette: black, white, and electric green ONLY (docs/phase14-design-reference.png).
 * Greys are neutral variations of black/white, never a fourth brand color. There is
 * deliberately no "danger" color — states like "incorrect" / "not perfect" are conveyed
 * with a neutral tone plus an icon (see components/icons.tsx), not a red hue.
 */
export const colors = {
  background: "#000000",
  surface: "#0A0A0A",
  surfaceRaised: "#141414",
  surfaceSunken: "#050505",
  border: "#232323",
  borderStrong: "#333333",

  foreground: "#FFFFFF",
  muted: "#B8B8B8",
  muted2: "#6B6B6B",

  brand: "#00E676",
  brandStrong: "#00B85A",
  brandSoft: "rgba(0, 230, 118, 0.14)",
  brandBorder: "rgba(0, 230, 118, 0.35)",

  /** Neutral "attention" tone used where the old palette used gold/danger — greys only. */
  neutralSoft: "rgba(255, 255, 255, 0.08)",
  neutralBorder: "rgba(255, 255, 255, 0.16)",

  /** Text color to place on top of a solid brand-green surface. */
  onBrand: "#000000",

  overlay: "rgba(0, 0, 0, 0.7)",
};

export const spacing = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32, xxxl: 48 };

export const radius = { sm: 8, md: 12, lg: 16, xl: 20, pill: 999 };

export const typography = {
  display: { fontSize: 32, fontWeight: "800" as const, letterSpacing: -0.5 },
  title: { fontSize: 26, fontWeight: "800" as const, letterSpacing: -0.3 },
  heading: { fontSize: 20, fontWeight: "700" as const },
  subheading: { fontSize: 16, fontWeight: "700" as const },
  body: { fontSize: 15, fontWeight: "400" as const },
  bodyStrong: { fontSize: 15, fontWeight: "600" as const },
  caption: { fontSize: 13, fontWeight: "500" as const },
  label: { fontSize: 12, fontWeight: "600" as const },
  /** Small tracked uppercase label, e.g. section eyebrows and taglines. */
  overline: { fontSize: 12, fontWeight: "700" as const, letterSpacing: 1.2, textTransform: "uppercase" as const },
};

/** Minimum comfortable touch target (iOS HIG / Material both recommend ~44-48pt). */
export const minTouchTarget = 44;
