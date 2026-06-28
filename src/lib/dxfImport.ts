// DXF → 2D polyline flattener.
//
// Parses a DXF document and returns an ordered list of 2D polylines suitable
// for driving the set-position pipeline. Curved entities (CIRCLE, ARC,
// ELLIPSE, SPLINE, LWPOLYLINE bulges) are discretized to chord tolerance.
// 3D-only entities, text, dimensions, hatches and INSERT (block references)
// are ignored in this v1 — they can be added later.

import DxfParser from "dxf-parser";

export type Point2D = { x: number; y: number };

export type Polyline = {
  points: Point2D[];
  closed: boolean;
  layer?: string;
  source: string; // entity type, for diagnostics
};

export type DxfParseOptions = {
  /** Maximum chord deviation between true curve and its polyline approximation, in DXF units. */
  chordTolerance?: number;
  /** Minimum number of segments per curved entity (full circle / closed ellipse). */
  minSegmentsPerCurve?: number;
  /** Maximum number of segments per curved entity, as a safety cap. */
  maxSegmentsPerCurve?: number;
};

export type DxfParseResult = {
  polylines: Polyline[];
  /** Entity-type counts encountered in the file (parsed + skipped). */
  stats: Record<string, number>;
  /** Entity types that were recognized but not flattened. */
  skipped: string[];
  /** Diagnostic warnings (e.g. degenerate entities). */
  warnings: string[];
};

const DEFAULTS: Required<DxfParseOptions> = {
  chordTolerance: 0.02,
  minSegmentsPerCurve: 16,
  maxSegmentsPerCurve: 512,
};

export function parseDxfToPolylines(source: string, options: DxfParseOptions = {}): DxfParseResult {
  const opts = { ...DEFAULTS, ...options };
  const parser = new DxfParser();
  const dxf = parser.parseSync(source);
  if (!dxf) {
    throw new Error("DXF parse returned null (file may be empty or invalid).");
  }

  const polylines: Polyline[] = [];
  const stats: Record<string, number> = {};
  const skippedSet = new Set<string>();
  const warnings: string[] = [];

  for (const entity of dxf.entities ?? []) {
    const type = entity.type;
    stats[type] = (stats[type] ?? 0) + 1;
    try {
      const result = flattenEntity(entity, opts);
      if (result.length === 0) {
        skippedSet.add(type);
      } else {
        for (const pl of result) polylines.push(pl);
      }
    } catch (err) {
      warnings.push(
        `Failed to flatten ${type} on layer ${entity.layer ?? "?"}: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
  }

  return { polylines, stats, skipped: [...skippedSet].sort(), warnings };
}

// --- Entity dispatch -------------------------------------------------------

type AnyEntity = {
  type: string;
  layer?: string;
  [key: string]: unknown;
};

function flattenEntity(entity: AnyEntity, opts: Required<DxfParseOptions>): Polyline[] {
  switch (entity.type) {
    case "LINE":
      return flattenLine(entity);
    case "LWPOLYLINE":
      return flattenLwpolyline(entity, opts);
    case "POLYLINE":
      return flattenPolyline(entity, opts);
    case "CIRCLE":
      return flattenCircle(entity, opts);
    case "ARC":
      return flattenArc(entity, opts);
    case "ELLIPSE":
      return flattenEllipse(entity, opts);
    case "SPLINE":
      return flattenSpline(entity);
    case "POINT":
      return flattenPoint(entity);
    default:
      return [];
  }
}

// --- Primitive flatteners --------------------------------------------------

function flattenLine(entity: AnyEntity): Polyline[] {
  const vertices = (entity.vertices as Point2D[] | undefined) ?? [];
  if (vertices.length < 2) return [];
  const [a, b] = vertices;
  return [
    {
      points: [
        { x: a.x, y: a.y },
        { x: b.x, y: b.y },
      ],
      closed: false,
      layer: entity.layer as string | undefined,
      source: "LINE",
    },
  ];
}

type LwVertex = { x: number; y: number; bulge?: number };

function flattenLwpolyline(entity: AnyEntity, opts: Required<DxfParseOptions>): Polyline[] {
  const vertices = (entity.vertices as LwVertex[] | undefined) ?? [];
  const closed = Boolean(entity.shape);
  return [
    polylineFromVertices(vertices, closed, opts, entity.layer as string | undefined, "LWPOLYLINE"),
  ];
}

function flattenPolyline(entity: AnyEntity, opts: Required<DxfParseOptions>): Polyline[] {
  if (entity.is3dPolyline || entity.is3dPolygonMesh || entity.isPolyfaceMesh) return [];
  const raw =
    (entity.vertices as Array<{ x: number; y: number; bulge?: number }> | undefined) ?? [];
  const closed = Boolean(entity.shape);
  return [polylineFromVertices(raw, closed, opts, entity.layer as string | undefined, "POLYLINE")];
}

function polylineFromVertices(
  vertices: LwVertex[],
  closed: boolean,
  opts: Required<DxfParseOptions>,
  layer: string | undefined,
  source: string,
): Polyline {
  const out: Point2D[] = [];
  if (vertices.length === 0) {
    return { points: out, closed, layer, source };
  }

  const ring = closed ? [...vertices, vertices[0]] : vertices;

  for (let i = 0; i < ring.length - 1; i++) {
    const a = ring[i];
    const b = ring[i + 1];
    const bulge = a.bulge ?? 0;
    if (i === 0) out.push({ x: a.x, y: a.y });
    if (Math.abs(bulge) < 1e-12) {
      out.push({ x: b.x, y: b.y });
    } else {
      const arcPoints = bulgeArc(a, b, bulge, opts);
      // arcPoints includes the endpoint but not the start (start already pushed)
      for (const p of arcPoints) out.push(p);
    }
  }

  return { points: out, closed, layer, source };
}

// Bulge encoding: tan(theta/4) where theta is the included angle of the arc
// from `a` to `b`. Positive bulge => counter-clockwise (left of chord),
// negative => clockwise. See DXF reference for LWPOLYLINE.
function bulgeArc(
  a: Point2D,
  b: Point2D,
  bulge: number,
  opts: Required<DxfParseOptions>,
): Point2D[] {
  const theta = 4 * Math.atan(bulge);
  const chordX = b.x - a.x;
  const chordY = b.y - a.y;
  const chordLen = Math.hypot(chordX, chordY);
  if (chordLen < 1e-12) return [{ x: b.x, y: b.y }];

  const radius = Math.abs(chordLen / (2 * Math.sin(theta / 2)));
  const midX = (a.x + b.x) / 2;
  const midY = (a.y + b.y) / 2;
  // Perpendicular to chord, scaled to distance from chord midpoint to center.
  // sagitta s = r - r*cos(theta/2); center offset = r*cos(theta/2) (signed).
  const offsetMag = radius * Math.cos(theta / 2);
  // Unit normal to chord (rotated +90° from chord direction).
  const nx = -chordY / chordLen;
  const ny = chordX / chordLen;
  // For positive bulge the arc bulges to the left of chord (a→b) and the
  // center lies on the opposite side.
  const sign = bulge >= 0 ? -1 : 1;
  const cx = midX + sign * nx * offsetMag;
  const cy = midY + sign * ny * offsetMag;

  const startAngle = Math.atan2(a.y - cy, a.x - cx);
  const segments = clampInt(
    Math.ceil(Math.abs(theta) / chordToleranceToAngle(radius, opts.chordTolerance)),
    Math.max(2, Math.floor(opts.minSegmentsPerCurve * (Math.abs(theta) / (2 * Math.PI)))),
    opts.maxSegmentsPerCurve,
  );

  const out: Point2D[] = [];
  for (let i = 1; i <= segments; i++) {
    const t = i / segments;
    const ang = startAngle + theta * t;
    out.push({ x: cx + radius * Math.cos(ang), y: cy + radius * Math.sin(ang) });
  }
  return out;
}

function flattenCircle(entity: AnyEntity, opts: Required<DxfParseOptions>): Polyline[] {
  const center = entity.center as Point2D | undefined;
  const radius = entity.radius as number | undefined;
  if (!center || !radius || radius <= 0) return [];
  const segments = clampInt(
    Math.ceil((2 * Math.PI) / chordToleranceToAngle(radius, opts.chordTolerance)),
    opts.minSegmentsPerCurve,
    opts.maxSegmentsPerCurve,
  );
  const points: Point2D[] = [];
  for (let i = 0; i <= segments; i++) {
    const a = (i / segments) * 2 * Math.PI;
    points.push({ x: center.x + radius * Math.cos(a), y: center.y + radius * Math.sin(a) });
  }
  return [{ points, closed: true, layer: entity.layer as string | undefined, source: "CIRCLE" }];
}

function flattenArc(entity: AnyEntity, opts: Required<DxfParseOptions>): Polyline[] {
  const center = entity.center as Point2D | undefined;
  const radius = entity.radius as number | undefined;
  const startAngle = entity.startAngle as number | undefined;
  const endAngle = entity.endAngle as number | undefined;
  if (!center || !radius || startAngle == null || endAngle == null || radius <= 0) return [];
  // DXF stores angles in radians for ARC. Sweep is always counter-clockwise.
  let sweep = endAngle - startAngle;
  while (sweep <= 0) sweep += 2 * Math.PI;
  const segments = clampInt(
    Math.ceil(sweep / chordToleranceToAngle(radius, opts.chordTolerance)),
    Math.max(2, Math.floor(opts.minSegmentsPerCurve * (sweep / (2 * Math.PI)))),
    opts.maxSegmentsPerCurve,
  );
  const points: Point2D[] = [];
  for (let i = 0; i <= segments; i++) {
    const a = startAngle + sweep * (i / segments);
    points.push({ x: center.x + radius * Math.cos(a), y: center.y + radius * Math.sin(a) });
  }
  return [{ points, closed: false, layer: entity.layer as string | undefined, source: "ARC" }];
}

function flattenEllipse(entity: AnyEntity, opts: Required<DxfParseOptions>): Polyline[] {
  const center = entity.center as Point2D | undefined;
  const major = entity.majorAxisEndPoint as Point2D | undefined;
  const ratio = entity.axisRatio as number | undefined;
  const startAngle = (entity.startAngle as number | undefined) ?? 0;
  const endAngle = (entity.endAngle as number | undefined) ?? 2 * Math.PI;
  if (!center || !major || !ratio || ratio <= 0) return [];
  const majorLen = Math.hypot(major.x, major.y);
  if (majorLen <= 0) return [];
  const minorLen = majorLen * ratio;
  const rot = Math.atan2(major.y, major.x);
  let sweep = endAngle - startAngle;
  if (sweep <= 0) sweep += 2 * Math.PI;
  // Use the smaller radius for chord-to-angle calc so tight curvature stays sampled.
  const segments = clampInt(
    Math.ceil(sweep / chordToleranceToAngle(Math.min(majorLen, minorLen), opts.chordTolerance)),
    Math.max(2, Math.floor(opts.minSegmentsPerCurve * (sweep / (2 * Math.PI)))),
    opts.maxSegmentsPerCurve,
  );
  const points: Point2D[] = [];
  const cos = Math.cos(rot);
  const sin = Math.sin(rot);
  const closed = Math.abs(sweep - 2 * Math.PI) < 1e-6;
  for (let i = 0; i <= segments; i++) {
    const a = startAngle + sweep * (i / segments);
    const lx = majorLen * Math.cos(a);
    const ly = minorLen * Math.sin(a);
    points.push({ x: center.x + lx * cos - ly * sin, y: center.y + lx * sin + ly * cos });
  }
  return [{ points, closed, layer: entity.layer as string | undefined, source: "ELLIPSE" }];
}

// v1: take fitPoints if available (CAD tools usually emit them); otherwise
// fall back to the control polygon (degraded — true NURBS evaluation can be
// added later if needed).
function flattenSpline(entity: AnyEntity): Polyline[] {
  const fit = entity.fitPoints as Point2D[] | undefined;
  const ctrl = entity.controlPoints as Point2D[] | undefined;
  const src = fit && fit.length >= 2 ? fit : ctrl;
  if (!src || src.length < 2) return [];
  return [
    {
      points: src.map((p) => ({ x: p.x, y: p.y })),
      closed: Boolean(entity.closed),
      layer: entity.layer as string | undefined,
      source: fit ? "SPLINE(fit)" : "SPLINE(ctrl)",
    },
  ];
}

function flattenPoint(entity: AnyEntity): Polyline[] {
  const p = entity.position as Point2D | undefined;
  if (!p) return [];
  // Encode as a degenerate single-point "polyline" — the pattern builder
  // turns this into a brief dwell with the laser on.
  return [
    {
      points: [{ x: p.x, y: p.y }],
      closed: false,
      layer: entity.layer as string | undefined,
      source: "POINT",
    },
  ];
}

// --- Math helpers ----------------------------------------------------------

// Δθ such that the chord error on a circle of radius r equals `tol`.
// chordError(r, Δθ) = r(1 − cos(Δθ/2)); solving for Δθ.
function chordToleranceToAngle(radius: number, tol: number): number {
  if (radius <= 0) return Math.PI; // degenerate
  const ratio = 1 - tol / radius;
  if (ratio <= -1) return Math.PI;
  if (ratio >= 1) return 1e-3; // tolerance already met by any subdivision
  return 2 * Math.acos(ratio);
}

function clampInt(value: number, lo: number, hi: number): number {
  if (!Number.isFinite(value)) return hi;
  return Math.max(lo, Math.min(hi, Math.round(value)));
}
