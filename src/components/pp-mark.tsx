/**
 * The Perfect Play brand mark — Option D "Scoreboard": a slanted jersey-red block with a
 * condensed "P". Drawn as inline SVG so the letter scales with whatever size `className`
 * gives it (e.g. "h-8 w-8"). The old green PNG stays in public/ until a red icon set is made.
 */
export function PPMark({ className, title = "Perfect Play" }: { className?: string; title?: string }) {
  return (
    <svg viewBox="0 0 40 40" role="img" aria-label={title} className={className}>
      <title>{title}</title>
      <polygon points="8,0 40,0 32,40 0,40" fill="var(--brand)" />
      <text
        x="20"
        y="31"
        textAnchor="middle"
        fill="#ffffff"
        fontSize="30"
        fontWeight="800"
        style={{ fontFamily: "var(--font-saira-condensed), sans-serif", fontStyle: "italic" }}
      >
        P
      </text>
    </svg>
  );
}
