import { useEffect, useRef } from "react";
import uPlot from "uplot";
import "uplot/dist/uPlot.min.css";
import type { DemoData } from "@/lib/demoData";

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
    },
    plugins: [wheelZoomPlugin(), cursorLinePlugin(getCursorIdx)],
  };
  return new uPlot(opts, data, el);
}

export function TimePlots({ data, toggles, cursorIdx, onCursorIdx }: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const plotsRef = useRef<uPlot[]>([]);
  // Live cursor index read by each plot's draw hook (the dashed marker line).
  const cursorIdxRef = useRef(cursorIdx);
  cursorIdxRef.current = cursorIdx;
  // Per-plot value readouts (t plus one entry per visible series).
  const readoutsRef = useRef<
    Array<{ tSpan: HTMLSpanElement; items: { span: HTMLSpanElement; label: string; data: Float64Array }[] }>
  >([]);
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

    const t = data.t;

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
      const p = makePlot(el, g.title, g.series, t, onCursorIdx, () => cursorIdxRef.current, g.yRange);
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
      wrapper.appendChild(footer);
      readoutsRef.current.push({ tSpan, items });

      const applyHidden = (hidden: boolean) => {
        el.style.display = hidden ? "none" : "";
        readout.style.display = hidden ? "none" : "";
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
  }, [data, togglesKey]);

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