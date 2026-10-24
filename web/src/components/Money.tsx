import { RiyalIcon } from "./RiyalIcon";
import { fmt } from "../lib/format";

export function Money({ v, className = "" }: { v: number; className?: string }) {
  return (
    <span className={`inline-flex items-center gap-1 font-stat whitespace-nowrap ${className}`}>
      <RiyalIcon className="h-[0.8em] w-[0.8em] opacity-80" />
      {fmt(v)}
    </span>
  );
}
