import { Image } from "react-native";

/**
 * The Perfect Play brand mark. Phase 23H: replaced the hand-authored SVG "PP" glyph with
 * the final provided logo asset (assets/pp-logo.png) — this component only renders that
 * PNG at a given size, it never redraws/reinterprets the artwork. The source image has
 * its own opaque background baked in (not transparent) and is square, so `resizeMode`
 * "contain" at equal width/height always shows it undistorted and uncropped.
 */
export function PPMark({ size = 32 }: { size?: number }) {
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- RN static image assets are resolved via require, not import, by the Metro bundler.
  return <Image source={require("../assets/pp-logo.png")} style={{ width: size, height: size, borderRadius: size * 0.18 }} resizeMode="contain" accessibilityLabel="Perfect Play" accessibilityRole="image" />;
}
