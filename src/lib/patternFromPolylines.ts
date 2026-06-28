// Convert a list of 2D polylines (e.g. parsed from a DXF) into the same
// `DemoData` shape the visualizer already consumes. Each polyline becomes a
// "mark" segment traversed at `markSpeed`; between polylines we insert a
// laser-off "jump" traversed at `jumpSpeed`. Simulation, controller and
// feedback channels are synthesized with the same filters as the synthetic
// demo so the existing XY/time/domain/error views remain meaningful.

import {
  addNoise,
  addRipple,
  bounds,
  lag,
  overshoot,
  type DemoData,
  type Dataset,
} from "./demoData";
import type { Point2D, Polyline } from "./dxfImport";

export type PatternBuildOptions = {
  /** Mark feed rate, DXF units per second. */
  markSpeed: number;
  /** Jump (laser-off) feed rate, DXF units per second. */
  jumpSpeed: number;
  /** Sample period, seconds. */
  dt: number;
  /** Hard cap on samples to keep the visualizer responsive. */
  maxSamples?: number;
  /** Optional starting position; defaults to (0,0). */
  origin?: Point2D;
};

const DEFAULTS = {
  markSpeed: 500, // mm/s
  jumpSpeed: 5000, // mm/s
  dt: 1e-4, // s
  maxSamples: 200_000,
} as const;

export function buildDemoDataFromPolylines(
  polylines: Polyline[],
  options: Partial<PatternBuildOptions> = {},
): DemoData {
  const opts: Required<PatternBuildOptions> = {
    ...DEFAULTS,
    origin: { x: 0, y: 0 },
    ...options,
  };

  // Sample the geometry into commanded x/y/laser arrays.
  const sampled = samplePattern(polylines, opts);
  const N = sampled.x.length;

  if (N < 2) {
    throw new Error("DXF produced no drawable geometry (no LINE/ARC/POLYLINE/… entities found).");
  }

  // Build the time base.
  const t = new Float64Array(N);
  for (let i = 0; i < N; i++) t[i] = i * opts.dt;

  const pattern: Dataset = {
    t,
    x: sampled.x,
    y: sampled.y,
    z: sampled.z,
    jumps: sampled.jumps,
  };

  // Mirror the synthesis used in buildDemoData() so simulation/controller/
  // feedback channels exist alongside the imported set positions.
  const simX = overshoot(lag(pattern.x, 0.08), 0.18, 0.92);
  const simY = overshoot(lag(pattern.y, 0.08), 0.18, 0.92);

  const ctrlX = lag(pattern.x, 0.35);
  const ctrlY = lag(pattern.y, 0.35);

  const fbX0 = lag(pattern.x, 0.22);
  const fbY0 = lag(pattern.y, 0.22);
  // Scale ripple/noise by the bounding-box extent so values stay proportional
  // for arbitrary DXF unit ranges (microns vs. metres).
  const span = Math.max(
    1e-6,
    Math.max(...sampled.x) - Math.min(...sampled.x),
    Math.max(...sampled.y) - Math.min(...sampled.y),
  );
  const noiseAmp = span * 0.005;
  const rippleAmp = span * 0.004;
  const fbX = addNoise(addRipple(fbX0, rippleAmp, 350, span * 0.002), noiseAmp, 11);
  const fbY = addNoise(addRipple(fbY0, rippleAmp, 410, -span * 0.002), noiseAmp, 73);

  const field = bounds(pattern.x, pattern.y, 0.1);

  return {
    t,
    pattern,
    simulation: { t, x: simX, y: simY, z: sampled.z },
    controller: { t, x: ctrlX, y: ctrlY, z: sampled.z },
    feedback: { t, x: fbX, y: fbY, z: addNoise(sampled.z, span * 0.002, 5) },
    laserOn: sampled.laserOn,
    laserPower: sampled.laserPower,
    field,
  };
}

// --- Sampling --------------------------------------------------------------

type SampledPattern = {
  x: Float64Array;
  y: Float64Array;
  z: Float64Array;
  laserOn: Uint8Array;
  laserPower: Float64Array;
  jumps: number[];
};

function samplePattern(polylines: Polyline[], opts: Required<PatternBuildOptions>): SampledPattern {
  const markStep = opts.markSpeed * opts.dt;
  const jumpStep = opts.jumpSpeed * opts.dt;
  if (markStep <= 0 || jumpStep <= 0) {
    throw new Error("markSpeed, jumpSpeed and dt must all be positive.");
  }

  const xs: number[] = [];
  const ys: number[] = [];
  const laser: number[] = [];
  const jumps: number[] = [];

  let cursor: Point2D = { ...opts.origin };
  const cap = opts.maxSamples;

  // Drop polylines with no usable points up front.
  const nonEmpty = polylines.filter((pl) => pl.points.length > 0);

  for (let p = 0; p < nonEmpty.length; p++) {
    const pl = nonEmpty[p];
    const start = pl.points[0];

    // Jump from cursor to mark start.
    appendSegment(cursor, start, jumpStep, xs, ys, laser, /*on*/ 0, jumps, cap);
    cursor = start;

    if (pl.points.length === 1) {
      // POINT-style entity: produce a single sample with the laser briefly on.
      pushSample(xs, ys, laser, start.x, start.y, 1, cap);
      continue;
    }

    // Mark each polyline segment.
    for (let i = 1; i < pl.points.length; i++) {
      const next = pl.points[i];
      appendSegment(cursor, next, markStep, xs, ys, laser, /*on*/ 1, /*jumps*/ undefined, cap);
      cursor = next;
    }
  }

  // Final jump back to origin keeps the dataset closed and gives a non-zero
  // length even when the pattern is a single point.
  appendSegment(cursor, opts.origin, jumpStep, xs, ys, laser, 0, jumps, cap);

  const N = xs.length;
  const x = Float64Array.from(xs);
  const y = Float64Array.from(ys);
  const z = new Float64Array(N); // pattern Z stays 0 — Z-feedback synthesized later
  const laserOn = Uint8Array.from(laser);
  const laserPower = buildLaserPower(laserOn);

  return { x, y, z, laserOn, laserPower, jumps };
}

function appendSegment(
  from: Point2D,
  to: Point2D,
  step: number,
  xs: number[],
  ys: number[],
  laser: number[],
  laserState: 0 | 1,
  jumps: number[] | undefined,
  cap: number,
): void {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const dist = Math.hypot(dx, dy);

  if (jumps && laserState === 0) jumps.push(xs.length);

  // Always emit at least the start sample to keep the time base monotonic.
  if (xs.length === 0) {
    pushSample(xs, ys, laser, from.x, from.y, laserState, cap);
  }

  if (dist < 1e-12) return;

  const steps = Math.max(1, Math.ceil(dist / step));
  for (let i = 1; i <= steps; i++) {
    const t = i / steps;
    pushSample(xs, ys, laser, from.x + dx * t, from.y + dy * t, laserState, cap);
    if (xs.length >= cap) return;
  }
}

function pushSample(
  xs: number[],
  ys: number[],
  laser: number[],
  x: number,
  y: number,
  on: 0 | 1,
  cap: number,
): void {
  if (xs.length >= cap) return;
  xs.push(x);
  ys.push(y);
  laser.push(on);
}

// Laser power: ramp up at the start of each ON run, hold at 1, ramp down at
// the end. Edge widths are clamped to a few samples for short marks.
function buildLaserPower(laserOn: Uint8Array): Float64Array {
  const N = laserOn.length;
  const out = new Float64Array(N);
  let i = 0;
  while (i < N) {
    if (laserOn[i] === 0) {
      i++;
      continue;
    }
    let j = i;
    while (j < N && laserOn[j] === 1) j++;
    const runLen = j - i;
    const edge = Math.min(Math.max(2, Math.floor(runLen * 0.1)), 20);
    for (let k = i; k < j; k++) {
      const local = k - i;
      const rise = Math.min(1, local / edge);
      const fall = Math.min(1, (j - 1 - k) / edge);
      out[k] = Math.min(rise, fall);
    }
    i = j;
  }
  return out;
}
