// Shape correction, like "draw and hold" on iPad.
// recognizeShape(points) returns a cleaned-up shape { points, sharp } or null
// if the stroke doesn't look like a line, circle/ellipse, triangle or rectangle.

const SHAPE_SPACING = 5; // px between points of a corrected shape (so the rubber can cut it)

function shapeDist(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function pathLength(pts) {
  let len = 0;
  for (let i = 1; i < pts.length; i++) len += shapeDist(pts[i - 1], pts[i]);
  return len;
}

function pointToSegment(p, a, b) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  if (len2 === 0) return shapeDist(p, a);
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2));
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

// Ramer–Douglas–Peucker: reduce a path to its main corners.
function simplify(pts, epsilon) {
  if (pts.length < 3) return pts.slice();
  let maxD = 0;
  let idx = 0;
  for (let i = 1; i < pts.length - 1; i++) {
    const d = pointToSegment(pts[i], pts[0], pts[pts.length - 1]);
    if (d > maxD) {
      maxD = d;
      idx = i;
    }
  }
  if (maxD <= epsilon) return [pts[0], pts[pts.length - 1]];
  const left = simplify(pts.slice(0, idx + 1), epsilon);
  const right = simplify(pts.slice(idx), epsilon);
  return left.slice(0, -1).concat(right);
}

// Fill in points along straight edges so the shape has evenly spaced points.
function densify(corners) {
  const out = [];
  for (let i = 0; i < corners.length - 1; i++) {
    const a = corners[i];
    const b = corners[i + 1];
    const n = Math.max(1, Math.ceil(shapeDist(a, b) / SHAPE_SPACING));
    for (let k = 0; k < n; k++) {
      out.push({ x: a.x + ((b.x - a.x) * k) / n, y: a.y + ((b.y - a.y) * k) / n });
    }
  }
  out.push({ ...corners[corners.length - 1] });
  return out;
}

function ellipsePoints(cx, cy, rx, ry) {
  const n = Math.max(24, Math.ceil((Math.PI * (rx + ry)) / SHAPE_SPACING));
  const out = [];
  for (let i = 0; i <= n; i++) {
    const a = (i / n) * Math.PI * 2;
    out.push({ x: cx + rx * Math.cos(a), y: cy + ry * Math.sin(a) });
  }
  return out;
}

function recognizeShape(pts) {
  if (pts.length < 5) return null;
  const length = pathLength(pts);
  if (length < 40) return null;

  const first = pts[0];
  const last = pts[pts.length - 1];

  // Straight line: every point stays close to the line between the ends.
  const endGap = shapeDist(first, last);
  if (endGap > length * 0.7) {
    let maxDev = 0;
    for (const p of pts) maxDev = Math.max(maxDev, pointToSegment(p, first, last));
    if (maxDev < endGap * 0.08) {
      return { points: densify([first, last]), sharp: true };
    }
    return null; // open curvy stroke: leave it as drawn
  }

  // From here on, only closed shapes (ends meet up).
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of pts) {
    minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x);
    minY = Math.min(minY, p.y); maxY = Math.max(maxY, p.y);
  }
  const w = maxX - minX;
  const h = maxY - minY;
  const size = Math.max(w, h);
  if (endGap > size * 0.35) return null;

  // Circle / ellipse: points sit close to the ellipse that fits the bounding box.
  const cx = (minX + maxX) / 2;
  const cy = (minY + maxY) / 2;
  const rx = Math.max(w / 2, 1);
  const ry = Math.max(h / 2, 1);
  let err = 0;
  for (const p of pts) {
    const r = Math.hypot((p.x - cx) / rx, (p.y - cy) / ry);
    err += Math.abs(r - 1);
  }
  err /= pts.length;

  // Polygon: count the corners of the closed path.
  const closed = pts.concat([first]);
  let corners = simplify(closed, size * 0.1);
  // Merge the start/end into one corner if the stroke started mid-edge.
  if (corners.length > 3) {
    const a = corners[corners.length - 2];
    const b = corners[1];
    if (pointToSegment(first, a, b) < size * 0.1) {
      corners = corners.slice(1, -1);
      corners.push(corners[0]);
    }
  }
  const cornerCount = corners.length - 1;

  // Very close fit, or close fit without clear corners: it's round.
  if (err < 0.07 || (err < 0.1 && cornerCount > 4)) {
    // Nearly round: make it a perfect circle.
    if (Math.abs(rx - ry) / Math.max(rx, ry) < 0.2) {
      const r = (rx + ry) / 2;
      return { points: ellipsePoints(cx, cy, r, r), sharp: false };
    }
    return { points: ellipsePoints(cx, cy, rx, ry), sharp: false };
  }

  if (cornerCount === 3) {
    return { points: densify(corners), sharp: true };
  }

  if (cornerCount === 4) {
    // Mostly level edges: make it a neat rectangle; otherwise keep the four corners.
    const level = corners.slice(0, 4).every((c, i) => {
      const n = corners[i + 1];
      const ang = Math.abs(Math.atan2(n.y - c.y, n.x - c.x)) % (Math.PI / 2);
      return Math.min(ang, Math.PI / 2 - ang) < 0.3;
    });
    if (level) {
      return {
        points: densify([
          { x: minX, y: minY }, { x: maxX, y: minY },
          { x: maxX, y: maxY }, { x: minX, y: maxY }, { x: minX, y: minY },
        ]),
        sharp: true,
      };
    }
    return { points: densify(corners), sharp: true };
  }

  return null;
}

if (typeof module !== 'undefined') module.exports = { recognizeShape };
