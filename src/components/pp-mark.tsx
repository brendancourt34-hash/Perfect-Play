/**
 * The Perfect Play brand mark. Phase 23H: replaced the hand-authored SVG "PP" glyph with
 * the final provided logo asset (public/pp-logo.png) — this component only renders that
 * PNG at a given size, it never redraws/reinterprets the artwork. The source image has
 * its own opaque background baked in (not transparent), so it renders as a self-contained
 * square tile — size it directly via `className` rather than placing it inside a
 * separately-colored badge/background (that pattern was needed for the old transparent
 * SVG glyph, not this asset).
 */
export function PPMark({ className, title = "Perfect Play" }: { className?: string; title?: string }) {
  // A single static logo file with no responsive/optimization needs — plain <img> is fine.
  // eslint-disable-next-line @next/next/no-img-element
  return <img src="/pp-logo.png" alt={title} className={className} style={{ objectFit: "contain" }} />;
}
