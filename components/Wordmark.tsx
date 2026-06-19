export function CurtainMark({
  width = 34,
  height = 34,
  radius = 8,
  glow = "0 0 16px rgba(255, 20, 40, .42)",
}: {
  width?: number;
  height?: number;
  radius?: number;
  glow?: string;
}) {
  return (
    <span
      className="relative shrink-0 overflow-hidden"
      style={{
        width,
        height,
        borderRadius: radius,
        backgroundImage: "url('/unveil-eye-logo-v2.png')",
        backgroundPosition: "center",
        backgroundSize: "cover",
        boxShadow: glow,
      }}
      aria-hidden
    />
  );
}

/** The Unveil wordmark. */
export function Wordmark({
  size = 19,
  dot = 28,
  showMark = true,
  className = "",
}: {
  size?: number;
  dot?: number;
  showMark?: boolean;
  className?: string;
}) {
  return (
    <div className={`flex items-center gap-2.5 ${className}`}>
      {showMark && <CurtainMark width={dot} height={dot} />}
      <span
        className="font-bold"
        style={{
          fontFamily: "var(--font-brand-manrope), sans-serif",
          fontSize: size,
          letterSpacing: 0,
        }}
      >
        UNVEIL
      </span>
    </div>
  );
}
