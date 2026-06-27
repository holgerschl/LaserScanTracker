import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";

/**
 * Three-column horizontal layout with two draggable vertical dividers.
 *
 * Widths are expressed as fractions of the available content area (0..1) so the
 * layout adapts to the viewport. Optional persistence stores the fractions in
 * localStorage under `storageKey`.
 */
export interface ResizableColumnsProps {
  left: React.ReactNode;
  middle: React.ReactNode;
  right: React.ReactNode;
  /** Initial fractions [left, middle, right]; must sum to 1. */
  defaultFractions?: [number, number, number];
  /** Minimum width per column in pixels. */
  minSizes?: [number, number, number];
  /** Persist user-chosen fractions under this localStorage key. */
  storageKey?: string;
  /** Width of each divider in pixels. */
  dividerWidth?: number;
  className?: string;
}

const DEFAULT_FRACTIONS: [number, number, number] = [0.2, 0.45, 0.35];
const DEFAULT_MIN_SIZES: [number, number, number] = [120, 200, 200];

function clampFractions(
  fractions: [number, number, number],
  containerWidth: number,
  minSizes: [number, number, number],
  dividerSpace: number,
): [number, number, number] {
  const usable = Math.max(1, containerWidth - dividerSpace);
  const minF: [number, number, number] = [
    minSizes[0] / usable,
    minSizes[1] / usable,
    minSizes[2] / usable,
  ];
  // If even the minima don't fit, fall back to proportional minima.
  const totalMin = minF[0] + minF[1] + minF[2];
  if (totalMin >= 1) {
    return [minF[0] / totalMin, minF[1] / totalMin, minF[2] / totalMin];
  }
  const f: [number, number, number] = [
    Math.max(minF[0], fractions[0]),
    Math.max(minF[1], fractions[1]),
    Math.max(minF[2], fractions[2]),
  ];
  const s = f[0] + f[1] + f[2];
  return [f[0] / s, f[1] / s, f[2] / s];
}

function loadStored(key: string | undefined): [number, number, number] | null {
  if (!key || typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (
      Array.isArray(parsed) &&
      parsed.length === 3 &&
      parsed.every((n) => typeof n === "number" && Number.isFinite(n) && n > 0)
    ) {
      const sum = parsed[0] + parsed[1] + parsed[2];
      return [parsed[0] / sum, parsed[1] / sum, parsed[2] / sum];
    }
  } catch {
    /* ignore corrupt storage */
  }
  return null;
}

export function ResizableColumns({
  left,
  middle,
  right,
  defaultFractions = DEFAULT_FRACTIONS,
  minSizes = DEFAULT_MIN_SIZES,
  storageKey,
  dividerWidth = 6,
  className,
}: ResizableColumnsProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [containerWidth, setContainerWidth] = useState(0);
  const [fractions, setFractions] = useState<[number, number, number]>(
    () => loadStored(storageKey) ?? defaultFractions,
  );

  // Track container width via ResizeObserver so column pixel sizes track viewport changes.
  useLayoutEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    setContainerWidth(el.clientWidth);
    const ro = new ResizeObserver((entries) => {
      for (const entry of entries) {
        setContainerWidth(entry.contentRect.width);
      }
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Persist whenever fractions change.
  useEffect(() => {
    if (!storageKey || typeof window === "undefined") return;
    try {
      window.localStorage.setItem(storageKey, JSON.stringify(fractions));
    } catch {
      /* ignore quota errors */
    }
  }, [fractions, storageKey]);

  const dividerSpace = dividerWidth * 2;
  const safe = clampFractions(fractions, containerWidth || 1, minSizes, dividerSpace);
  const usable = Math.max(0, containerWidth - dividerSpace);
  const widths: [number, number, number] = [
    safe[0] * usable,
    safe[1] * usable,
    safe[2] * usable,
  ];

  // Drag handler: divider index is 0 (between left/middle) or 1 (between middle/right).
  const startDrag = useCallback(
    (dividerIndex: 0 | 1, startEvent: React.PointerEvent<HTMLDivElement>) => {
      startEvent.preventDefault();
      const container = containerRef.current;
      if (!container) return;
      const startX = startEvent.clientX;
      // Capture the pixel widths at drag start so we can compute deltas accurately.
      const startWidths: [number, number, number] = [...widths];
      const totalPx = usable;
      const minPx = minSizes;

      const onMove = (ev: PointerEvent) => {
        const dx = ev.clientX - startX;
        const next: [number, number, number] = [...startWidths];
        if (dividerIndex === 0) {
          let leftW = startWidths[0] + dx;
          let midW = startWidths[1] - dx;
          // Apply minimums, redistribute overflow to the other side.
          if (leftW < minPx[0]) {
            midW -= minPx[0] - leftW;
            leftW = minPx[0];
          }
          if (midW < minPx[1]) {
            leftW -= minPx[1] - midW;
            midW = minPx[1];
          }
          leftW = Math.max(minPx[0], leftW);
          midW = Math.max(minPx[1], midW);
          next[0] = leftW;
          next[1] = midW;
        } else {
          let midW = startWidths[1] + dx;
          let rightW = startWidths[2] - dx;
          if (midW < minPx[1]) {
            rightW -= minPx[1] - midW;
            midW = minPx[1];
          }
          if (rightW < minPx[2]) {
            midW -= minPx[2] - rightW;
            rightW = minPx[2];
          }
          midW = Math.max(minPx[1], midW);
          rightW = Math.max(minPx[2], rightW);
          next[1] = midW;
          next[2] = rightW;
        }
        const sumPx = next[0] + next[1] + next[2];
        if (sumPx <= 0 || totalPx <= 0) return;
        setFractions([next[0] / sumPx, next[1] / sumPx, next[2] / sumPx]);
      };

      const onUp = () => {
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp);
        document.body.style.cursor = "";
        document.body.style.userSelect = "";
      };

      document.body.style.cursor = "col-resize";
      document.body.style.userSelect = "none";
      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp);
    },
    [widths, usable, minSizes],
  );

  return (
    <div
      ref={containerRef}
      className={["flex h-full w-full", className].filter(Boolean).join(" ")}
      style={{ minWidth: 0 }}
    >
      <div className="min-w-0 min-h-0 h-full" style={{ width: widths[0] }}>
        {left}
      </div>
      <Divider width={dividerWidth} onPointerDown={(e) => startDrag(0, e)} />
      <div className="min-w-0 min-h-0 h-full" style={{ width: widths[1] }}>
        {middle}
      </div>
      <Divider width={dividerWidth} onPointerDown={(e) => startDrag(1, e)} />
      <div className="min-w-0 min-h-0 h-full" style={{ width: widths[2] }}>
        {right}
      </div>
    </div>
  );
}

function Divider({
  width,
  onPointerDown,
}: {
  width: number;
  onPointerDown: (e: React.PointerEvent<HTMLDivElement>) => void;
}) {
  return (
    <div
      role="separator"
      aria-orientation="vertical"
      onPointerDown={onPointerDown}
      className="group relative flex-shrink-0 cursor-col-resize select-none"
      style={{ width }}
    >
      <div className="absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-zinc-200 group-hover:bg-zinc-400 transition-colors" />
      <div className="absolute inset-y-0 left-1/2 w-3 -translate-x-1/2" />
    </div>
  );
}
