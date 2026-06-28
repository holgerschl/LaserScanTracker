import { useEffect, useRef } from "react";
import uPlot from "uplot";
import "uplot/dist/uPlot.min.css";
import type { DemoData, SignalMode } from "@/lib/demoData";

export type TimeToggles = {
  xPattern: boolean;
  xSimulation: boolean;
  xFeedback: boolean;
  yPattern: boolean;
  ySimulation: boolean;
  yFeedback: boolean;
  zSet: boolean;
  zFeedback: boolean;
  laserSwitch: boolean;
  laserPower: boolean;
};

type Props = {
  data: DemoData;
  toggles: TimeToggles;
  cursorIdx: number;
  onCursorIdx: (i: number) => void;
  signalMode: SignalMode;
};

const SYNC_KEY = "laser-vis-sync";

// uPlot plugin: draws a persistent dashed vertical marker line at the external
// cursor index so the time plots reflect the XY-graph cursor even when the
// pointer is not hovering over them.
function cursorLinePlugin(getIdx: () => number): uPlot.Plugin {
  return {
    hooks: {
      draw: (u) => {
        const idx = getIdx();
        if (idx == null || idx < 0) return;
        const xVal = u.data[0][idx];
        if (xVal == null) return;
        const left = u.valToPos(xVal as number, "x", true);
        const { top, height } = u.bbox;
        const ctx = u.ctx;
        ctx.save();
        ctx.beginPath();
        ctx.strokeStyle = "#2563eb";
        ctx.lineWidth = Math.max(1, 1.5 * u.pxRatio);
        ctx.setLineDash([4 * u.pxRatio, 3 * u.pxRatio]);
        ctx.moveTo(left, top);
        ctx.lineTo(left, top + height);
        ctx.stroke();
        ctx.restore();
      },
    },
  };
}

// uPlot plugin: mouse-wheel zoom on the X axis, centered on the cursor.
function wheelZoomPlugin(): uPlot.Plugin {
  return {
    hooks: {
      ready: (u) => {
        const over = u.over;
        const onWheel = (e: WheelEvent) => {
          e.preventDefault();
          const rect = over.getBoundingClientRect();
          const left = e.clientX - rect.left;
          const xVal = u.posToVal(left, "x");
          const { min, max } = u.scales.x;
          if (min == null || max == null) return;
          const factor = Math.exp(e.deltaY * 0.0015);
          const nMin = xVal + (min - xVal) * factor;
          const nMax = xVal + (max - xVal) * factor;
          if (nMax - nMin < 1e-9) return;
          u.setScale("x", { min: nMin, max: nMax });
        };
        const onDbl = () => {
          u.setScale("x", { min: u.data[0][0] as number, max: u.data[0][u.data[0].length - 1] as number });
        };
        // Reset zoom on a middle-mouse (wheel) double-click as well.
        let lastMid = 0;
        const onMidDown = (e: MouseEvent) => {
          if (e.button !== 1) return;
          e.preventDefault();
          const now = Date.now();
          if (now - lastMid < 400) {
            lastMid = 0;
            onDbl();
          } else {
            lastMid = now;
          }
        };
        over.addEventListener("wheel", onWheel, { passive: false });
        over.addEventListener("dblclick", onDbl);
        over.addEventListener("mousedown", onMidDown);
        over.addEventListener("auxclick", (e) => {
          if ((e as MouseEvent).button === 1) e.preventDefault();
        });

        // Pan with right-mouse or shift+left drag on the X axis.
        let pan: { startX: number; min: number; max: number } | null = null;
        const onDown = (e: MouseEvent) => {
          if (!(e.button === 2 || (e.button === 0 && e.shiftKey))) return;
          e.preventDefault();
          e.stopPropagation();
          const { min, max } = u.scales.x;
          if (min == null || max == null) return;
          pan = { startX: e.clientX, min, max };
          window.addEventListener("mousemove", onMove, true);
          window.addEventListener("mouseup", onUp, true);
        };
        const onMove = (e: MouseEvent) => {
          if (!pan) return;
          const rect = over.getBoundingClientRect();
          const a = u.posToVal(0, "x");
          const b = u.posToVal(rect.width, "x");
          const dxData = ((e.clientX - pan.startX) / rect.width) * (b - a);
          u.setScale("x", { min: pan.min - dxData, max: pan.max - dxData });
        };
        const onUp = () => {
          pan = null;
          window.removeEventListener("mousemove", onMove, true);
          window.removeEventListener("mouseup", onUp, true);
        };
        over.addEventListener("mousedown", onDown);
        over.addEventListener("contextmenu", (e) => e.preventDefault());
      },
    },
  };
}

function makePlot(
  el: HTMLDivElement,
  title: string,
  series: { label: string; stroke: string; data: Float64Array; width?: number; dash?: number[] }[],
  t: Float64Array,
  onCursor: (i: number) => void,
  getCursorIdx: () => number,
  yRange?: [number, number],
  onXZoom?: (min: number, max: number) => void,
): uPlot {
  const data: uPlot.AlignedData = [
    Array.from(t) as unknown as number[],
    ...series.map((s) => Array.from(s.data) as unknown as number[]),
  ];
  const opts: uPlot.Options = {
    title,
    width: el.clientWidth,
    height: 130,
    cursor: {
      sync: { key: SYNC_KEY, setSeries: false },
      drag: { x: true, y: false, uni: 5 },
    },
    scales: {
      x: { time: false },
      y: yRange ? { range: yRange } : {},
    },
    axes: [
      {
        values: (_u, vals) => vals.map((v) => `${(v * 1e6).toFixed(0)}µs`),
        stroke: "#374151",
      },
      { stroke: "#374151", size: 50 },
    ],
    legend: { show: false },
    series: [
      { label: "t" },
      ...series.map((s) => ({
        label: s.label,
        stroke: s.stroke,
        width: s.width ?? 1.25,
        dash: s.dash,
      })),
    ],
    hooks: {
      setCursor: [
        (u) => {
          // Only report cursor changes that originate from a real pointer event
          // over this plot. Programmatic cursor updates (e.g. reflecting the XY
          // hover) and cursor-sync echoes have no event and must be ignored,
          // otherwise they create a feedback loop that overwrites the index.
          if (!(u.cursor as { event?: Event }).event) return;
          const idx = u.cursor.idx;
          if (idx != null && idx >= 0) onCursor(idx);
        },
      ],
      setScale: [
        (u, key) => {
          if (key !== "x" || !onXZoom) return;
          const { min, max } = u.scales.x;
          if (min != null && max != null) onXZoom(min, max);
        },
      ],
      ready: [
        (u) => {
          if (!onXZoom) return;
          const { min, max } = u.scales.x;
          if (min != null && max != null) onXZoom(min, max);
        },
      ],
    },
    plugins: [wheelZoomPlugin(), cursorLinePlugin(getCursorIdx)],
  };
  return new uPlot(opts, data, el);
}

// RMS/PV of `y[i]` for samples whose time falls inside [tmin, tmax].
function statsInWindow(t: Float64Array, y: Float64Array, tmin: number, tmax: number) {
  let sum2 = 0, n = 0, min = Infinity, max = -Infinity;
  for (let i = 0; i < t.length; i++) {
    const tv = t[i];
    if (tv < tmin || tv > tmax) continue;
    const v = y[i];
    if (!Number.isFinite(v)) continue;
    sum2 += v * v; n++;
    if (v < min) min = v;
    if (v > max) max = v;
  }
  if (n === 0) return null;
  return { rms: Math.sqrt(sum2 / n), pv: max - min };
}

export function TimePlots({ data, toggles, cursorIdx, onCursorIdx, signalMode }: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const plotsRef = useRef<uPlot[]>([]);
  // Live cursor index read by each plot's draw hook (the dashed marker line).
  const cursorIdxRef = useRef(cursorIdx);
  cursorIdxRef.current = cursorIdx;
  // Per-plot value readouts (t plus one entry per visible series).
  const readoutsRef = useRef<
    Array<{ tSpan: HTMLSpanElement; items: { span: HTMLSpanElement; label: string; data: Float64Array }[] }>
  >([]);
  // Per-plot RMS/PV stats elements (one per X/Y/Z plot, only in error mode).
  // Each entry holds the DOM node and the (non-pattern) series that feed it.
  const statsRef = useRef<
    Array<{ title: string; el: HTMLSpanElement; sources: { name: string; data: Float64Array; stroke: string }[] }>
  >([]);
  // Current x-zoom window per plot title (in seconds).
  const xZoomRef = useRef<Map<string, [number, number]>>(new Map());
  // Titles of graphs the user collapsed; persists across rebuilds (toggles).
  const hiddenGraphsRef = useRef<Set<string>>(new Set());

  // Serialize toggle values so the build effect only re-runs when a toggle
  // actually changes — not when the parent merely passes a new object identity
  // on cursor-driven re-renders (which would rebuild the plots and reset zoom).
  const togglesKey = Object.values(toggles).join(",");

  useEffect(() => {
    const root = containerRef.current!;
    root.innerHTML = "";
    plotsRef.current.forEach((p) => p.destroy());
    plotsRef.current = [];
    readoutsRef.current = [];
    statsRef.current = [];
    xZoomRef.current = new Map();

    const t = data.t;
    const isErr = signalMode === "error";

    // Recompute the per-plot RMS/PV stats whenever a zoom changes. Cheap O(N)
    // scans — fine for the ~4k samples we have.
    const recomputeStats = () => {
      if (!isErr) return;
      for (const s of statsRef.current) {
        const win = xZoomRef.current.get(s.title);
        if (!win) { s.el.textContent = ""; continue; }
        const [tmin, tmax] = win;
        const parts: string[] = [];
        for (const src of s.sources) {
          const st = statsInWindow(t, src.data, tmin, tmax);
          if (!st) continue;
          parts.push(
            `<span style="color:${src.stroke}">RMS ${src.name}: ${st.rms.toFixed(3)} · PV: ${st.pv.toFixed(3)}</span>`,
          );
        }
        s.el.innerHTML = parts.join(" · ");
      }
    };

    // In error mode, derive radial error series sqrt(x² + y²) for sim/feedback
    // so they can be plotted as their own time-series with integrated stats.
    const buildRadial = (xa: Float64Array, ya: Float64Array) => {
      const out = new Float64Array(xa.length);
      for (let i = 0; i < xa.length; i++) out[i] = Math.hypot(xa[i], ya[i]);
      return out;
    };
    const radialSim =
      isErr && toggles.xSimulation && toggles.ySimulation
        ? buildRadial(data.simulation.x, data.simulation.y)
        : null;
    const radialFb =
      isErr && toggles.xFeedback && toggles.yFeedback
        ? buildRadial(data.feedback.x, data.feedback.y)
        : null;

    const groups: Array<{
      title: string;
      show: boolean;
      series: { label: string; stroke: string; data: Float64Array; width?: number; dash?: number[] }[];
      yRange?: [number, number];
    }> = [
      {
        title: "X vs time (mm)",
        show: toggles.xPattern || toggles.xSimulation || toggles.xFeedback,
        series: [
          toggles.xPattern && { label: "x pattern", stroke: "#111111", data: data.pattern.x },
          toggles.xSimulation && { label: "x sim", stroke: "#2563eb", data: data.simulation.x },
          toggles.xFeedback && { label: "x feedback", stroke: "#dc2626", data: data.feedback.x, width: 1 },
        ].filter(Boolean) as any,
      },
      {
        title: "Y vs time (mm)",
        show: toggles.yPattern || toggles.ySimulation || toggles.yFeedback,
        series: [
          toggles.yPattern && { label: "y pattern", stroke: "#111111", data: data.pattern.y },
          toggles.ySimulation && { label: "y sim", stroke: "#2563eb", data: data.simulation.y },
          toggles.yFeedback && { label: "y feedback", stroke: "#dc2626", data: data.feedback.y, width: 1 },
        ].filter(Boolean) as any,
      },
      {
        title: "Z vs time",
        show: toggles.zSet || toggles.zFeedback,
        series: [
          toggles.zSet && { label: "z set", stroke: "#111111", data: data.pattern.z },
          toggles.zFeedback && { label: "z feedback", stroke: "#dc2626", data: data.feedback.z, width: 1 },
        ].filter(Boolean) as any,
      },
      {
        title: "√(x²+y²) vs time (mm)",
        show: isErr && (radialSim != null || radialFb != null),
        series: [
          radialSim && { label: "sim", stroke: "#2563eb", data: radialSim },
          radialFb && { label: "feedback", stroke: "#dc2626", data: radialFb, width: 1 },
        ].filter(Boolean) as any,
      },
      {
        title: "Laser switching",
        show: toggles.laserSwitch,
        series: [{ label: "laser on", stroke: "#f59e0b", data: Float64Array.from(data.laserOn) }],
        yRange: [-0.1, 1.1],
      },
      {
        title: "Laser power",
        show: toggles.laserPower,
        series: [{ label: "power", stroke: "#16a34a", data: data.laserPower }],
        yRange: [-0.05, 1.1],
      },
    ];

    for (const g of groups) {
      if (!g.show || g.series.length === 0) continue;
      const wrapper = document.createElement("div");
      wrapper.className = "mb-2";
      root.appendChild(wrapper);
      const el = document.createElement("div");
      wrapper.appendChild(el);
      const onXZoom = (min: number, max: number) => {
        xZoomRef.current.set(g.title, [min, max]);
        recomputeStats();
      };
      const p = makePlot(el, g.title, g.series, t, onCursorIdx, () => cursorIdxRef.current, g.yRange, onXZoom);
      plotsRef.current.push(p);

      // Footer beneath each plot: a checkbox to hide/show the whole graph,
      // followed by the value readout driven by the cursor index.
      const footer = document.createElement("div");
      footer.className =
        "flex flex-wrap items-center gap-x-3 gap-y-0.5 px-1 pb-1 text-[11px] tabular-nums text-gray-600";

      const toggleLabel = document.createElement("label");
      toggleLabel.className = "flex items-center gap-1 cursor-pointer select-none font-medium text-gray-700";
      const cb = document.createElement("input");
      cb.type = "checkbox";
      cb.className = "cursor-pointer";
      cb.checked = !hiddenGraphsRef.current.has(g.title);
      const cbText = document.createElement("span");
      cbText.textContent = g.title;
      toggleLabel.appendChild(cb);
      toggleLabel.appendChild(cbText);
      footer.appendChild(toggleLabel);

      const readout = document.createElement("span");
      readout.className = "flex flex-wrap items-center gap-x-3 gap-y-0.5";
      const tSpan = document.createElement("span");
      tSpan.className = "font-medium text-gray-800";
      readout.appendChild(tSpan);
      const items = g.series.map((s) => {
        const span = document.createElement("span");
        span.style.color = s.stroke;
        readout.appendChild(span);
        return { span, label: s.label, data: s.data };
      });
      footer.appendChild(readout);

      // RMS / PV stats line. Only populated in error mode; otherwise we leave
      // an empty span so the DOM layout stays consistent across mode toggles.
      const statsEl = document.createElement("span");
      statsEl.className = "ml-auto flex flex-wrap items-center gap-x-3 gap-y-0.5 text-zinc-500";
      footer.appendChild(statsEl);

      wrapper.appendChild(footer);
      readoutsRef.current.push({ tSpan, items });

      if (isErr && /^(X|Y|Z|√)/.test(g.title)) {
        // In error mode the "pattern" / "set" series are identically zero by
        // construction (see toErrorData), so we only show stats for the actual
        // error sources (sim / feedback).
        const sources = g.series
          .filter((s) => !/(pattern|set)$/.test(s.label))
          .map((s) => ({
            name: s.label.replace(/^[xyz]\s+/, ""),
            data: s.data,
            stroke: s.stroke,
          }));
        statsRef.current.push({ title: g.title, el: statsEl, sources });
      }

      const applyHidden = (hidden: boolean) => {
        el.style.display = hidden ? "none" : "";
        readout.style.display = hidden ? "none" : "";
        statsEl.style.display = hidden ? "none" : "";
      };
      applyHidden(hiddenGraphsRef.current.has(g.title));
      cb.addEventListener("change", () => {
        const hidden = !cb.checked;
        if (hidden) hiddenGraphsRef.current.add(g.title);
        else hiddenGraphsRef.current.delete(g.title);
        applyHidden(hidden);
      });

      // Initial fill (handles rebuilds triggered by toggles).
      const ci = cursorIdxRef.current;
      if (ci >= 0) {
        tSpan.textContent = `t = ${(t[ci] * 1e6).toFixed(0)} µs`;
        for (const it of items) {
          const v = it.data[ci];
          it.span.textContent = `${it.label}: ${v == null ? "–" : v.toFixed(3)}`;
        }
      }
    }

    // Only resize on real width changes. The plot height is fixed, so reacting
    // to height changes (caused by the readout text reflowing on every cursor
    // move) would call setSize needlessly and reset the user's zoom.
    let lastWidth = root.clientWidth;
    const ro = new ResizeObserver(() => {
      const w = root.clientWidth;
      if (w === lastWidth) return;
      lastWidth = w;
      for (const p of plotsRef.current) {
        p.setSize({ width: w, height: 130 });
      }
    });
    ro.observe(root);
    return () => {
      ro.disconnect();
      plotsRef.current.forEach((p) => p.destroy());
      plotsRef.current = [];
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, togglesKey, signalMode]);

  // Reflect external cursor changes (from XY hover): repaint the dashed marker
  // line at the new index and update each plot's value readout.
  useEffect(() => {
    const i = cursorIdx;
    for (const p of plotsRef.current) p.redraw(false, false);
    if (i < 0) return;
    const tText = `t = ${(data.t[i] * 1e6).toFixed(0)} µs`;
    for (const r of readoutsRef.current) {
      r.tSpan.textContent = tText;
      for (const it of r.items) {
        const v = it.data[i];
        it.span.textContent = `${it.label}: ${v == null ? "–" : v.toFixed(3)}`;
      }
    }
  }, [cursorIdx, data]);

  return <div ref={containerRef} className="w-full" />;
}