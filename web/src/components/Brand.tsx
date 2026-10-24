// Brand pieces from the Twisted Minds guideline: the twisty blob pattern and bilingual titles.
import type { ReactNode } from "react";

/** The rounded "twist" pattern from the guideline cover. Decorative only. */
export function TwistPattern({ color = "#FA4B69", className = "" }: { color?: string; className?: string }) {
  const id = `tw-${color.replace("#", "")}`;
  return (
    <svg className={className} aria-hidden="true" preserveAspectRatio="xMidYMid slice">
      <defs>
        <pattern id={id} width="72" height="72" patternUnits="userSpaceOnUse">
          <path
            d="M-4 18 C 10 18, 10 4, 24 4 S 38 32, 54 32 S 66 10, 80 10 M-4 54 C 10 54, 14 40, 28 40 S 40 68, 56 68 S 66 46, 80 46"
            fill="none" stroke={color} strokeWidth="13" strokeLinecap="round"
          />
        </pattern>
      </defs>
      <rect width="100%" height="100%" fill={`url(#${id})`} />
    </svg>
  );
}

/** A soft organic blob, like the shapes on the guideline divider pages. */
export function Blob({ color = "#03FBFE", className = "" }: { color?: string; className?: string }) {
  return (
    <svg viewBox="0 0 200 200" className={className} aria-hidden="true">
      <path
        fill={color}
        d="M46 18c22-14 52 2 66 10s30 2 46 8 34 30 26 54-30 22-28 44 22 30 8 48-46 12-62 2-28-24-52-22-46-6-48-30 18-30 16-50S24 32 46 18z"
      />
    </svg>
  );
}

/** Arabic over English, the way the guideline titles its sections. */
export function BiTitle({ en, ar, size = "text-3xl", className = "" }: { en: ReactNode; ar?: string; size?: string; className?: string }) {
  return (
    <div className={`${size} ${className}`}>
      {ar && <div className="ar text-primary font-extrabold leading-tight text-start" style={{ fontSize: "0.6em" }}>{ar}</div>}
      <h2 style={{ fontSize: "1em" }}>{en}</h2>
    </div>
  );
}
