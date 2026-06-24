import { useEffect, useRef } from "react";
import type { DemoData } from "@/lib/demoData";

export type XYToggles = {
  pattern: boolean;
  simulation: boolean;
  controller: boolean;
  feedback: boolean;
  laserHighlight: boolean;
  zColor: boolean;
};

type Props = {
  data: DemoData;
  toggles: XYToggles;
  cursorIdx: number;
  onHoverIdx: (idx: number | null) => void;
};

const COLORS = {
  pattern: "#111111",
  simulation: "#2563eb",
  controller: "#16a34a",
  feedback: "#dc2626",
  field: "#dc2626",
  laserOn: "#f59e0b",
  cursor: "#2563eb",
};

export function XYView({ data, toggles, cursorIdx, onHoverIdx }: Props) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const dprRef = useRef(1);
  const sizeRef = useRef({ w: 0, h: 0 });
  // Current view rect (zoomable). Defaults to scanner field, expanded slightly.
  const viewRef = useRef<{ xMin: number; xMax: number; yMin: number; yMax: number } | null>(null);

  // Map data coords -> canvas pixels (with margin and aspect-preserving square)
  const projRef = useRef<{
    mx: (x: number) => number;
    my: (y: number) => number;
    ux: (px: number) => number;
    uy: (py: number) => number;
  } | null>(null);

  function computeProjection() {
    const { w, h } = sizeRef.current;
    const pad = 32;
    if (!viewRef.current) {
      viewRef.current = { ...data.field };
    }
    const { xMin, xMax, yMin, yMax } = viewRef.current;
    // expand to include data
    const xR = xMax - xMin, yR = yMax - yMin;
    const scale = Math.min((w - 2 * pad) / xR, (h - 2 * pad) / yR);
    const cx = w / 2, cy = h / 2;
    const mx = (x: number) => cx + (x - (xMin + xMax) / 2) * scale;
    const my = (y: number) => cy - (y - (yMin + yMax) / 2) * scale;
    const ux = (px: number) => (px - cx) / scale + (xMin + xMax) / 2;
    const uy = (py: number) => -(py - cy) / scale + (yMin + yMax) / 2;
    projRef.current = { mx, my, ux, uy };
    return { mx, my, scale };
  }

  function drawSeries(
    ctx: CanvasRenderingContext2D,
    xs: Float64Array,
    ys: Float64Array,
    color: string,
    width = 1.25,
    dashed = false,
    jumps?: number[],
  ) {
    const { mx, my } = projRef.current!;
    ctx.strokeStyle = color;
    ctx.lineWidth = width;
    ctx.setLineDash(dashed ? [4, 4] : []);
    ctx.beginPath();
    let started = false;
    const jumpSet = jumps ? new Set(jumps) : null;
    for (let i = 0; i < xs.length; i++) {
      const px = mx(xs[i]);
      const py = my(ys[i]);
      if (!started || (jumpSet && jumpSet.has(i))) {
        ctx.moveTo(px, py);
        started = true;
      } else {
        ctx.lineTo(px, py);
      }
    }
    ctx.stroke();
    ctx.setLineDash([]);
  }

  function draw() {
    const c = canvasRef.current;
    if (!c) return;
    const dpr = dprRef.current;
    const { w, h } = sizeRef.current;
    const ctx = c.getContext("2d")!;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, w, h);

    computeProjection();
    const { mx, my } = projRef.current!;

    // Scanner field
    const { xMin, xMax, yMin, yMax } = data.field;
    ctx.strokeStyle = COLORS.field;
    ctx.setLineDash([6, 4]);
    ctx.lineWidth = 1.25;
    ctx.strokeRect(mx(xMin), my(yMax), mx(xMax) - mx(xMin), my(yMin) - my(yMax));
    ctx.setLineDash([]);
    ctx.fillStyle = COLORS.field;
    ctx.font = "12px ui-sans-serif, system-ui";
    ctx.fillText("Scanner field", mx(xMax) - 90, my(yMax) + 14);

    // Axes ticks (light)
    ctx.strokeStyle = "#e5e7eb";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(mx(0), my(yMin));
    ctx.lineTo(mx(0), my(yMax));
    ctx.moveTo(mx(xMin), my(0));
    ctx.lineTo(mx(xMax), my(0));
    ctx.stroke();

    if (toggles.pattern) {
      drawSeries(ctx, data.pattern.x, data.pattern.y, COLORS.pattern, 1.5, false, data.pattern.jumps);
      // dashed jump segments
      if (data.pattern.jumps) {
        ctx.setLineDash([3, 4]);
        ctx.strokeStyle = "#6b7280";
        ctx.lineWidth = 1;
        for (const j of data.pattern.jumps) {
          if (j === 0) continue;
          ctx.beginPath();
          ctx.moveTo(mx(data.pattern.x[j - 1]), my(data.pattern.y[j - 1]));
          ctx.lineTo(mx(data.pattern.x[j]), my(data.pattern.y[j]));
          ctx.stroke();
        }
        ctx.setLineDash([]);
      }
    }
    if (toggles.simulation) drawSeries(ctx, data.simulation.x, data.simulation.y, COLORS.simulation, 1.25);
    if (toggles.controller) drawSeries(ctx, data.controller.x, data.controller.y, COLORS.controller, 1.25);
    if (toggles.feedback) drawSeries(ctx, data.feedback.x, data.feedback.y, COLORS.feedback, 1);

    // Laser ON highlight along pattern
    if (toggles.laserHighlight && toggles.pattern) {
      ctx.strokeStyle = COLORS.laserOn;
      ctx.lineWidth = 2.5;
      ctx.globalAlpha = 0.55;
      ctx.beginPath();
      let drawing = false;
      for (let i = 0; i < data.laserOn.length; i++) {
        if (data.laserOn[i]) {
          const px = mx(data.pattern.x[i]);
          const py = my(data.pattern.y[i]);
          if (!drawing) { ctx.moveTo(px, py); drawing = true; }
          else ctx.lineTo(px, py);
        } else if (drawing) {
          ctx.stroke();
          ctx.beginPath();
          drawing = false;
        }
      }
      if (drawing) ctx.stroke();
      ctx.globalAlpha = 1;
    }

    // Cursor marker: single crosshair pinned to the input trajectory (pattern)
    if (cursorIdx >= 0 && cursorIdx < data.t.length && toggles.pattern) {
      const px = mx(data.pattern.x[cursorIdx]);
      const py = my(data.pattern.y[cursorIdx]);

      ctx.strokeStyle = COLORS.cursor;
      ctx.fillStyle = "#ffffff";
      ctx.lineWidth = 2;
      const r = 6;
      ctx.beginPath();
      ctx.arc(px, py, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(px - r - 4, py);
      ctx.lineTo(px + r + 4, py);
      ctx.moveTo(px, py - r - 4);
      ctx.lineTo(px, py + r + 4);
      ctx.stroke();

      const t = data.t[cursorIdx];
      const lines = [
        `x = ${data.pattern.x[cursorIdx].toFixed(3)} mm`,
        `y = ${data.pattern.y[cursorIdx].toFixed(3)} mm`,
        `t = ${(t * 1e6).toFixed(1)} µs`,
      ];
      const bw = 160, bh = 64;
      const bx = w - bw - 16, by = h - bh - 16;
      ctx.fillStyle = "rgba(255,255,255,0.95)";
      ctx.strokeStyle = "#111";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.rect(bx, by, bw, bh);
      ctx.fill(); ctx.stroke();
      ctx.fillStyle = "#111";
      ctx.font = "12px ui-monospace, SFMono-Regular, monospace";
      lines.forEach((s, i) => ctx.fillText(s, bx + 10, by + 18 + i * 16));
    }

    // Field violation warning
    let violated = false;
    const checkPts = [data.feedback, data.simulation, data.controller, data.pattern];
    const onFlags = [toggles.feedback, toggles.simulation, toggles.controller, toggles.pattern];
    for (let s = 0; s < checkPts.length && !violated; s++) {
      if (!onFlags[s]) continue;
      const ds = checkPts[s];
      for (let i = 0; i < ds.x.length; i++) {
        if (ds.x[i] < xMin || ds.x[i] > xMax || ds.y[i] < yMin || ds.y[i] > yMax) {
          violated = true; break;
        }
      }
    }
    if (violated) {
      ctx.fillStyle = "#dc2626";
      ctx.font = "bold 12px ui-sans-serif, system-ui";
      ctx.fillText("⚠ Scanner field violation", 12, 18);
    }

    // Axis labels
    ctx.fillStyle = "#374151";
    ctx.font = "12px ui-sans-serif, system-ui";
    ctx.fillText("X (mm)", w - 50, h - 6);
    ctx.fillText("Y (mm)", 8, 14);
  }

  useEffect(() => {
    const el = containerRef.current!;
    const ro = new ResizeObserver(() => {
      const r = el.getBoundingClientRect();
      const c = canvasRef.current!;
      const dpr = window.devicePixelRatio || 1;
      dprRef.current = dpr;
      sizeRef.current = { w: r.width, h: r.height };
      c.width = Math.floor(r.width * dpr);
      c.height = Math.floor(r.height * dpr);
      c.style.width = `${r.width}px`;
      c.style.height = `${r.height}px`;
      draw();
    });
    ro.observe(el);
    return () => ro.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => { draw(); /* eslint-disable-next-line */ }, [data, toggles, cursorIdx]);

  // Native (non-passive) wheel listener so preventDefault works for zoom.
  useEffect(() => {
    const c = canvasRef.current;
    if (!c) return;
    const handler = (e: WheelEvent) => {
      e.preventDefault();
      const proj = projRef.current;
      const v = viewRef.current;
      if (!proj || !v) return;
      const r = c.getBoundingClientRect();
      const px = e.clientX - r.left;
      const py = e.clientY - r.top;
      const ux = proj.ux(px), uy = proj.uy(py);
      const factor = Math.exp(e.deltaY * 0.0015);
      const nxMin = ux + (v.xMin - ux) * factor;
      const nxMax = ux + (v.xMax - ux) * factor;
      const nyMin = uy + (v.yMin - uy) * factor;
      const nyMax = uy + (v.yMax - uy) * factor;
      if (nxMax - nxMin < 1e-3 || nxMax - nxMin > 1e4) return;
      viewRef.current = { xMin: nxMin, xMax: nxMax, yMin: nyMin, yMax: nyMax };
      draw();
    };
    c.addEventListener("wheel", handler, { passive: false });
    return () => c.removeEventListener("wheel", handler);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function onDoubleClick() {
    viewRef.current = { ...data.field };
    draw();
  }

  function onMove(e: React.MouseEvent<HTMLCanvasElement>) {
    const c = canvasRef.current!;
    const r = c.getBoundingClientRect();
    const px = e.clientX - r.left;
    const py = e.clientY - r.top;
    const proj = projRef.current;
    if (!proj) return;
    const ux = proj.ux(px), uy = proj.uy(py);
    // pick reference dataset (first enabled in priority)
    const ds = toggles.simulation ? data.simulation
      : toggles.pattern ? data.pattern
      : toggles.feedback ? data.feedback
      : toggles.controller ? data.controller : null;
    if (!ds) return;
    // nearest index by squared distance (coarse subsample then refine)
    let best = -1, bestD = Infinity;
    const step = Math.max(1, Math.floor(ds.x.length / 600));
    for (let i = 0; i < ds.x.length; i += step) {
      const dx = ds.x[i] - ux, dy = ds.y[i] - uy;
      const d = dx * dx + dy * dy;
      if (d < bestD) { bestD = d; best = i; }
    }
    // refine
    const lo = Math.max(0, best - step), hi = Math.min(ds.x.length - 1, best + step);
    for (let i = lo; i <= hi; i++) {
      const dx = ds.x[i] - ux, dy = ds.y[i] - uy;
      const d = dx * dx + dy * dy;
      if (d < bestD) { bestD = d; best = i; }
    }
    onHoverIdx(best);
  }

  // Pan with right-mouse or shift+left drag.
  const panRef = useRef<{ startX: number; startY: number; view: { xMin: number; xMax: number; yMin: number; yMax: number } } | null>(null);
  function onMouseDown(e: React.MouseEvent<HTMLCanvasElement>) {
    if (!(e.button === 2 || (e.button === 0 && e.shiftKey))) return;
    e.preventDefault();
    const v = viewRef.current;
    if (!v) return;
    panRef.current = { startX: e.clientX, startY: e.clientY, view: { ...v } };
  }
  function onMouseMoveCanvas(e: React.MouseEvent<HTMLCanvasElement>) {
    if (panRef.current) {
      const proj = projRef.current;
      if (!proj) return;
      const c = canvasRef.current!;
      const r = c.getBoundingClientRect();
      // Convert pixel delta to data delta using current projection scale.
      const origin = proj.ux(0), dxUnit = proj.ux(1) - origin;
      const originY = proj.uy(0), dyUnit = proj.uy(1) - originY;
      const dxData = (e.clientX - panRef.current.startX) * dxUnit;
      const dyData = (e.clientY - panRef.current.startY) * dyUnit;
      const v0 = panRef.current.view;
      viewRef.current = {
        xMin: v0.xMin - dxData,
        xMax: v0.xMax - dxData,
        yMin: v0.yMin - dyData,
        yMax: v0.yMax - dyData,
      };
      void r;
      draw();
      return;
    }
    onMove(e);
  }
  function endPan() { panRef.current = null; }

  return (
    <div ref={containerRef} className="relative h-full w-full bg-white border rounded-md overflow-hidden">
      <canvas
        ref={canvasRef}
        className="block h-full w-full cursor-crosshair"
        onMouseMove={onMouseMoveCanvas}
        onMouseLeave={() => { onHoverIdx(null); endPan(); }}
        onMouseDown={onMouseDown}
        onMouseUp={endPan}
        onDoubleClick={onDoubleClick}
        onContextMenu={(e) => e.preventDefault()}
      />
      <div className="absolute bottom-2 left-2 text-[10px] text-gray-500 bg-white/70 px-1.5 py-0.5 rounded pointer-events-none">
        scroll to zoom · right-drag or shift-drag to pan · double-click to reset
      </div>
    </div>
  );
}