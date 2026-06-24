// Synthetic laser scan datasets shared across the visualizer.
// All datasets share the same time base so cursor sync is trivial.

export type Series = {
  t: Float64Array;
  x: Float64Array;
  y: Float64Array;
  z: Float64Array;
};

export type Dataset = Series & {
  // Segment breaks (indices where a "jump" begins) for the marking pattern.
  jumps?: number[];
};

export type DemoData = {
  t: Float64Array;
  pattern: Dataset;        // commanded user input (x,y) - marks + jumps
  simulation: Dataset;     // motion-control simulation
  controller: Dataset;     // RTC-like controller output
  feedback: Dataset;       // measured feedback (with noise/oscillation)
  laserOn: Uint8Array;     // digital laser switching (0/1)
  laserPower: Float64Array; // analog ramp 0..1
  field: { xMin: number; xMax: number; yMin: number; yMax: number };
};

// Build a marking pattern: a circle, then a hexagon, with a jump between them.
// Returns the full per-time arrays plus jump indices.
function buildPattern(N: number, dt: number): Dataset {
  const t = new Float64Array(N);
  const x = new Float64Array(N);
  const y = new Float64Array(N);
  const z = new Float64Array(N);
  const jumps: number[] = [];

  // Segments: [type, startFrac, endFrac]
  // 0..0.05  jump to circle start
  // 0.05..0.45 circle mark
  // 0.45..0.55 jump to hex start
  // 0.55..0.95 hexagon mark
  // 0.95..1.0 jump home
  const cx1 = -4, cy1 = -3, r1 = 3;
  const cx2 = 3, cy2 = 3, rHex = 4;

  for (let i = 0; i < N; i++) {
    const f = i / (N - 1);
    t[i] = i * dt;
    z[i] = 0;

    if (f < 0.05) {
      const k = f / 0.05;
      x[i] = (1 - k) * 0 + k * (cx1 + r1);
      y[i] = (1 - k) * 0 + k * cy1;
      if (i === 0) jumps.push(0);
    } else if (f < 0.45) {
      const k = (f - 0.05) / 0.4;
      const a = k * Math.PI * 2;
      x[i] = cx1 + r1 * Math.cos(a);
      y[i] = cy1 + r1 * Math.sin(a);
    } else if (f < 0.55) {
      const k = (f - 0.45) / 0.1;
      const sx = cx1 + r1, sy = cy1;
      const ex = cx2 + rHex, ey = cy2;
      x[i] = (1 - k) * sx + k * ex;
      y[i] = (1 - k) * sy + k * ey;
      if (Math.abs(f - 0.45) < dt) jumps.push(i);
    } else if (f < 0.95) {
      const k = (f - 0.55) / 0.4;
      // hexagon traced over 6 edges
      const edge = Math.min(5, Math.floor(k * 6));
      const local = k * 6 - edge;
      const a0 = (edge / 6) * Math.PI * 2;
      const a1 = ((edge + 1) / 6) * Math.PI * 2;
      const x0 = cx2 + rHex * Math.cos(a0);
      const y0 = cy2 + rHex * Math.sin(a0);
      const x1 = cx2 + rHex * Math.cos(a1);
      const y1 = cy2 + rHex * Math.sin(a1);
      x[i] = (1 - local) * x0 + local * x1;
      y[i] = (1 - local) * y0 + local * y1;
    } else {
      const k = (f - 0.95) / 0.05;
      const sx = cx2 + rHex, sy = cy2;
      x[i] = (1 - k) * sx + k * 0;
      y[i] = (1 - k) * sy + k * 0;
      if (Math.abs(f - 0.95) < dt) jumps.push(i);
    }
  }
  return { t, x, y, z, jumps };
}

// First-order lag filter to simulate dynamics.
function lag(src: Float64Array, alpha: number): Float64Array {
  const out = new Float64Array(src.length);
  out[0] = src[0];
  for (let i = 1; i < src.length; i++) {
    out[i] = out[i - 1] + alpha * (src[i] - out[i - 1]);
  }
  return out;
}

function addNoise(src: Float64Array, amp: number, seed = 1): Float64Array {
  // Deterministic pseudo-noise
  const out = new Float64Array(src.length);
  let s = seed;
  for (let i = 0; i < src.length; i++) {
    s = (s * 9301 + 49297) % 233280;
    const n = s / 233280 - 0.5;
    out[i] = src[i] + n * amp;
  }
  return out;
}

// Second-order-ish response: lagged signal with a small overshoot toward step changes.
function overshoot(src: Float64Array, amount: number, decay: number): Float64Array {
  const out = new Float64Array(src.length);
  let v = 0;
  out[0] = src[0];
  for (let i = 1; i < src.length; i++) {
    const d = src[i] - src[i - 1];
    v = v * decay + d * amount;
    out[i] = src[i] + v;
  }
  return out;
}

// Add a slow sinusoidal ripple + constant bias to simulate sensor drift.
function addRipple(src: Float64Array, amp: number, period: number, bias: number): Float64Array {
  const out = new Float64Array(src.length);
  for (let i = 0; i < src.length; i++) {
    out[i] = src[i] + bias + amp * Math.sin((i / period) * Math.PI * 2);
  }
  return out;
}

export function buildDemoData(N = 4000, dt = 1e-4): DemoData {
  const pattern = buildPattern(N, dt);

  // Simulation: heavier lag with a small overshoot/ringing — distinct from pattern.
  const simX = overshoot(lag(pattern.x, 0.08), 0.18, 0.92);
  const simY = overshoot(lag(pattern.y, 0.08), 0.18, 0.92);

  // Controller output: pre-emphasized — sharper than simulation
  const ctrlX = lag(pattern.x, 0.35);
  const ctrlY = lag(pattern.y, 0.35);

  // Feedback: different lag, drift, oscillation and noticeably more noise.
  const fbX0 = lag(pattern.x, 0.22);
  const fbY0 = lag(pattern.y, 0.22);
  const fbX = addNoise(addRipple(fbX0, 0.08, 350, 0.05), 0.12, 11);
  const fbY = addNoise(addRipple(fbY0, 0.08, 410, -0.04), 0.12, 73);

  // Z: small step during marking, zero during jumps (focus offset)
  const z = new Float64Array(N);
  for (let i = 0; i < N; i++) {
    const f = i / (N - 1);
    z[i] = (f > 0.05 && f < 0.45) || (f > 0.55 && f < 0.95) ? 0.5 : 0;
  }

  // Laser ON during marking, OFF during jumps (with sub-cycle dither at start/end)
  const laserOn = new Uint8Array(N);
  for (let i = 0; i < N; i++) {
    const f = i / (N - 1);
    const inMark = (f > 0.05 && f < 0.45) || (f > 0.55 && f < 0.95);
    laserOn[i] = inMark ? 1 : 0;
    // sub-cycle modulation near edges
    if (inMark && (f < 0.06 || (f > 0.44 && f < 0.45) || (f > 0.55 && f < 0.56) || f > 0.94)) {
      laserOn[i] = (i % 3 === 0) ? 0 : 1;
    }
  }

  // Laser power: ramp up at start of each mark, ramp down at end
  const laserPower = new Float64Array(N);
  for (let i = 0; i < N; i++) {
    const f = i / (N - 1);
    if (f > 0.05 && f < 0.45) {
      const k = (f - 0.05) / 0.4;
      laserPower[i] = Math.min(1, k * 4) * Math.min(1, (1 - k) * 4);
    } else if (f > 0.55 && f < 0.95) {
      const k = (f - 0.55) / 0.4;
      laserPower[i] = Math.min(1, k * 4) * Math.min(1, (1 - k) * 4);
    } else {
      laserPower[i] = 0;
    }
  }

  pattern.z = z;

  return {
    t: pattern.t,
    pattern,
    simulation: { t: pattern.t, x: simX, y: simY, z },
    controller: { t: pattern.t, x: ctrlX, y: ctrlY, z },
    feedback: { t: pattern.t, x: fbX, y: fbY, z: addNoise(z, 0.05, 5) },
    laserOn,
    laserPower,
    field: { xMin: -8, xMax: 8, yMin: -8, yMax: 8 },
  };
}