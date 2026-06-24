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
        over.addEventListener("wheel", onWheel, { passive: false });
        over.addEventListener("dblclick", onDbl);

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
    legend: { show: true },
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
          const idx = u.cursor.idx;
          if (idx != null && idx >= 0) onCursor(idx);
        },
      ],
    },
    plugins: [wheelZoomPlugin()],
  };
  return new uPlot(opts, data, el);
}

export function TimePlots({ data, toggles, cursorIdx, onCursorIdx }: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const plotsRef = useRef<uPlot[]>([]);

  useEffect(() => {
    const root = containerRef.current!;
    root.innerHTML = "";
    plotsRef.current.forEach((p) => p.destroy());
    plotsRef.current = [];

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
      const el = document.createElement("div");
      el.className = "mb-2";
      root.appendChild(el);
      const p = makePlot(el, g.title, g.series, t, onCursorIdx, g.yRange);
      plotsRef.current.push(p);
    }

    const ro = new ResizeObserver(() => {
      for (const p of plotsRef.current) {
        p.setSize({ width: root.clientWidth, height: 130 });
      }
    });
    ro.observe(root);
    return () => {
      ro.disconnect();
      plotsRef.current.forEach((p) => p.destroy());
      plotsRef.current = [];
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, toggles]);

  // Reflect external cursor changes (from XY hover)
  useEffect(() => {
    for (const p of plotsRef.current) {
      if (cursorIdx < 0) continue;
      const left = p.valToPos(data.t[cursorIdx], "x");
      const top = p.valToPos(p.data[1]?.[cursorIdx] ?? 0, "y");
      p.setCursor({ left, top }, false);
    }
  }, [cursorIdx, data]);

  return <div ref={containerRef} className="w-full" />;
}