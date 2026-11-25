// Offline handwriting recognition for Air Pen.
//
// Uses the $P point-cloud recogniser (Vatavu, Anthony & Wobbrock, 2012): each
// letter is compared, as a cloud of points, against example letters. It doesn't
// care about stroke order or direction, which suits writing in the air.
//
// Built-in examples cover printed lowercase a-z. Examples you teach it (press L
// after writing one letter) are saved in this browser and make it much more accurate.
//
// All points passed in here are in SCREEN orientation (x already un-mirrored).

const HW_N = 32; // points per letter after resampling
const HW_STORAGE_KEY = 'air-pen-letters';

// ---------- built-in letter shapes (0-100 box, y down; descenders reach 140) ----------

function hwArc(cx, cy, r, fromDeg, toDeg, n = 14) {
  const pts = [];
  for (let i = 0; i <= n; i++) {
    const a = ((fromDeg + ((toDeg - fromDeg) * i) / n) * Math.PI) / 180;
    pts.push({ x: cx + r * Math.cos(a), y: cy + r * Math.sin(a) });
  }
  return pts;
}
function hwLine(x0, y0, x1, y1) {
  return [{ x: x0, y: y0 }, { x: x1, y: y1 }];
}
function hwPoly(...xy) {
  const pts = [];
  for (let i = 0; i < xy.length; i += 2) pts.push({ x: xy[i], y: xy[i + 1] });
  return pts;
}
const hwDot = (x, y) => hwLine(x, y, x, y + 3);

const HW_BUILTIN = {
  a: [hwArc(50, 70, 30, -20, 340), hwLine(80, 40, 80, 100)],
  b: [hwLine(20, 0, 20, 100), hwArc(50, 70, 30, 180, 540)],
  c: [hwArc(50, 70, 30, -40, -320)],
  d: [hwArc(50, 70, 30, 0, -360), hwLine(80, 0, 80, 100)],
  e: [hwLine(20, 70, 80, 70).concat(hwArc(50, 70, 30, 0, -310))],
  f: [hwArc(62, 20, 15, -20, -180).concat(hwLine(47, 20, 47, 100)), hwLine(25, 45, 70, 45)],
  g: [hwArc(50, 60, 25, 0, -360), hwLine(75, 35, 75, 115).concat(hwArc(50, 115, 25, 0, 160))],
  h: [hwLine(20, 0, 20, 100), hwArc(45, 65, 25, 180, 360).concat(hwLine(70, 65, 70, 100))],
  i: [hwLine(50, 40, 50, 100), hwDot(50, 18)],
  j: [hwLine(60, 40, 60, 120).concat(hwArc(40, 120, 20, 0, 160)), hwDot(60, 18)],
  k: [hwLine(20, 0, 20, 100), hwPoly(70, 40, 20, 75, 75, 100)],
  l: [hwLine(50, 0, 50, 100)],
  m: [
    hwLine(15, 40, 15, 100),
    hwArc(32, 60, 17, 180, 360).concat(hwLine(49, 60, 49, 100)),
    hwArc(66, 60, 17, 180, 360).concat(hwLine(83, 60, 83, 100)),
  ],
  n: [hwLine(20, 40, 20, 100), hwArc(45, 65, 25, 180, 360).concat(hwLine(70, 65, 70, 100))],
  o: [hwArc(50, 70, 30, -90, 270)],
  p: [hwLine(20, 40, 20, 140), hwArc(50, 70, 30, 180, 540)],
  q: [hwArc(50, 70, 30, 0, -360), hwLine(80, 40, 80, 140)],
  r: [hwLine(25, 40, 25, 100), hwArc(50, 65, 25, 180, 300)],
  s: [hwArc(50, 55, 15, -30, -270).concat(hwArc(50, 85, 15, -90, 150))],
  t: [hwLine(45, 5, 45, 100), hwLine(25, 40, 70, 40)],
  u: [hwLine(20, 40, 20, 75).concat(hwArc(45, 75, 25, 180, 0)), hwLine(70, 40, 70, 100)],
  v: [hwPoly(20, 40, 50, 100, 80, 40)],
  w: [hwPoly(10, 40, 30, 100, 50, 55, 70, 100, 90, 40)],
  x: [hwLine(20, 40, 80, 100), hwLine(80, 40, 20, 100)],
  y: [hwLine(20, 40, 50, 100), hwLine(80, 40, 35, 140)],
  z: [hwPoly(20, 40, 80, 40, 20, 100, 80, 100)],
};

// ---------- $P recogniser ----------

function hwFlatten(strokes) {
  const pts = [];
  strokes.forEach((s, id) => s.forEach((p) => pts.push({ x: p.x, y: p.y, id })));
  return pts;
}

function hwPathLength(pts) {
  let d = 0;
  for (let i = 1; i < pts.length; i++) {
    if (pts[i].id === pts[i - 1].id) d += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
  }
  return d;
}

function hwResample(points, n) {
  const pts = points.map((p) => ({ ...p }));
  const total = hwPathLength(pts);
  if (total === 0) return Array.from({ length: n }, () => ({ ...pts[0] }));
  const interval = total / (n - 1);
  let D = 0;
  const out = [{ ...pts[0] }];
  for (let i = 1; i < pts.length; i++) {
    if (pts[i].id !== pts[i - 1].id) continue;
    const d = Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
    if (D + d >= interval && d > 0) {
      const t = (interval - D) / d;
      const q = {
        x: pts[i - 1].x + t * (pts[i].x - pts[i - 1].x),
        y: pts[i - 1].y + t * (pts[i].y - pts[i - 1].y),
        id: pts[i].id,
      };
      out.push(q);
      pts.splice(i, 0, q);
      D = 0;
    } else {
      D += d;
    }
  }
  while (out.length < n) out.push({ ...pts[pts.length - 1] });
  return out.slice(0, n);
}

function hwNormalize(points) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of points) {
    minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x);
    minY = Math.min(minY, p.y); maxY = Math.max(maxY, p.y);
  }
  const size = Math.max(maxX - minX, maxY - minY) || 1;
  let cx = 0, cy = 0;
  const scaled = points.map((p) => ({ x: (p.x - minX) / size, y: (p.y - minY) / size, id: p.id }));
  for (const p of scaled) { cx += p.x; cy += p.y; }
  cx /= scaled.length; cy /= scaled.length;
  return scaled.map((p) => ({ x: p.x - cx, y: p.y - cy, id: p.id }));
}

function hwPrepare(strokes) {
  const pts = hwFlatten(strokes.filter((s) => s.length));
  if (pts.length === 0) return null;
  return hwNormalize(hwResample(pts, HW_N));
}

function hwCloudDistance(a, b, start) {
  const n = a.length;
  const matched = new Array(n).fill(false);
  let sum = 0;
  let i = start;
  do {
    let min = Infinity, index = -1;
    for (let j = 0; j < n; j++) {
      if (matched[j]) continue;
      const d = Math.hypot(a[i].x - b[j].x, a[i].y - b[j].y);
      if (d < min) { min = d; index = j; }
    }
    matched[index] = true;
    const weight = 1 - ((i - start + n) % n) / n;
    sum += weight * min;
    i = (i + 1) % n;
  } while (i !== start);
  return sum;
}

function hwGreedyMatch(a, b) {
  const step = Math.floor(Math.sqrt(a.length));
  let min = Infinity;
  for (let i = 0; i < a.length; i += step) {
    min = Math.min(min, hwCloudDistance(a, b, i), hwCloudDistance(b, a, i));
  }
  return min;
}

// ---------- templates (built-in + taught) ----------

let hwTemplates = [];

function hwLoadTaught() {
  try {
    return JSON.parse(localStorage.getItem(HW_STORAGE_KEY) || '[]');
  } catch {
    return [];
  }
}

function hwRebuildTemplates() {
  hwTemplates = [];
  for (const [letter, strokes] of Object.entries(HW_BUILTIN)) {
    hwTemplates.push({ letter, cloud: hwPrepare(strokes), taught: false });
  }
  for (const t of hwLoadTaught()) {
    const cloud = hwPrepare(t.strokes);
    if (cloud) hwTemplates.push({ letter: t.letter, cloud, taught: true });
  }
}

// Save one of your own letters as an example. strokes: arrays of {x, y} in screen orientation.
function teachLetter(letter, strokes) {
  const taught = hwLoadTaught();
  taught.push({
    letter,
    strokes: strokes.map((s) => s.map((p) => ({ x: Math.round(p.x), y: Math.round(p.y) }))),
  });
  try {
    localStorage.setItem(HW_STORAGE_KEY, JSON.stringify(taught));
  } catch {
    // storage unavailable: the example still counts until the page reloads
  }
  const cloud = hwPrepare(strokes);
  if (cloud) hwTemplates.push({ letter, cloud, taught: true });
  return taught.length;
}

function recognizeLetter(strokes) {
  const cloud = hwPrepare(strokes);
  if (!cloud) return '?';
  let best = null, bestScore = Infinity;
  for (const t of hwTemplates) {
    // Taught examples are your own handwriting: give them a small advantage.
    const score = hwGreedyMatch(cloud, t.cloud) * (t.taught ? 0.85 : 1);
    if (score < bestScore) { bestScore = score; best = t.letter; }
  }
  return best;
}

// ---------- splitting writing into letters and words ----------

function hwBox(pts) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of pts) {
    minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x);
    minY = Math.min(minY, p.y); maxY = Math.max(maxY, p.y);
  }
  return { minX, minY, maxX, maxY };
}

// strokes: arrays of {x, y} in screen orientation.
// Returns lines of text: [{ text, box, baseline, xHeight }]
function recognizeWriting(strokes) {
  const items = strokes
    .filter((s) => s.length)
    .map((s) => ({ s, b: hwBox(s) }))
    .sort((a, b) => a.b.minX - b.b.minX);
  if (!items.length) return null;

  const heights = items.map((i) => i.b.maxY - i.b.minY).sort((a, b) => a - b);
  const typical = Math.max(heights[Math.floor(heights.length / 2)], 20);

  // Group strokes whose horizontal extents overlap into letters.
  const letters = [];
  const slack = typical * 0.1;
  for (const it of items) {
    const last = letters[letters.length - 1];
    if (last && it.b.minX <= last.b.maxX + slack) {
      last.strokes.push(it.s);
      last.b = {
        minX: Math.min(last.b.minX, it.b.minX), maxX: Math.max(last.b.maxX, it.b.maxX),
        minY: Math.min(last.b.minY, it.b.minY), maxY: Math.max(last.b.maxY, it.b.maxY),
      };
    } else {
      letters.push({ strokes: [it.s], b: { ...it.b } });
    }
  }

  // Recognise each letter and insert spaces where a gap is much wider than usual.
  const gaps = [];
  for (let i = 1; i < letters.length; i++) gaps.push(letters[i].b.minX - letters[i - 1].b.maxX);
  const sortedGaps = gaps.slice().sort((a, b) => a - b);
  const usualGap = Math.max(sortedGaps[Math.floor(sortedGaps.length / 3)] || 0, typical * 0.15);
  const spaceGap = Math.max(usualGap * 2.2, typical * 0.6);
  let text = '';
  for (let i = 0; i < letters.length; i++) {
    if (i > 0 && gaps[i - 1] > spaceGap) text += ' ';
    letters[i].char = recognizeLetter(letters[i].strokes);
    text += letters[i].char;
  }

  // Estimate baseline and x-height so the neat text sits where you wrote.
  const small = letters.filter((l) => 'acemnorsuvwxz'.includes(l.char));
  const noDesc = letters.filter((l) => !'gjpqy'.includes(l.char));
  const median = (arr) => arr.sort((a, b) => a - b)[Math.floor(arr.length / 2)];
  const baseline = median((noDesc.length ? noDesc : letters).map((l) => l.b.maxY));
  const xHeight = small.length
    ? median(small.map((l) => l.b.maxY - l.b.minY))
    : median(letters.map((l) => l.b.maxY - l.b.minY)) * 0.55;

  const box = hwBox(items.flatMap((i) => [{ x: i.b.minX, y: i.b.minY }, { x: i.b.maxX, y: i.b.maxY }]));
  return { text, box, baseline, xHeight };
}

hwRebuildTemplates();

if (typeof module !== 'undefined') module.exports = { recognizeLetter, recognizeWriting, teachLetter, HW_BUILTIN };
