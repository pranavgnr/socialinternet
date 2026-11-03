/**
 * Koko's minimal vector face. The same mark sits on the floating concierge and
 * at the top of the studio, so the mascot never changes between the two.
 *
 * It is decorative: the surrounding link or heading carries the name, so the
 * SVG is `aria-hidden`.
 */
export default function KokoAvatar({
  tone = "lime",
  className = "h-9 w-9",
}: {
  tone?: "lime" | "gold";
  className?: string;
}) {
  const accent = tone === "gold" ? "#E5C158" : "#CCFF00";

  return (
    <svg viewBox="0 0 32 32" className={`shrink-0 ${className}`} aria-hidden="true">
      <rect
        x="2.5"
        y="2.5"
        width="27"
        height="27"
        rx="10"
        fill="#131318"
        stroke={accent}
        strokeOpacity="0.55"
      />
      <rect x="9" y="11" width="4.5" height="5.5" rx="1.2" fill={accent} />
      <rect x="18.5" y="11" width="4.5" height="5.5" rx="1.2" fill={accent} />
      <rect x="11.5" y="21" width="9" height="2.6" rx="1.3" fill="#FAFAFA" />
    </svg>
  );
}
