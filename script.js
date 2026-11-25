const video = document.getElementById('video');
const canvas = document.getElementById('canvas');
const ctx = canvas.getContext('2d');

// Press 1-7 to pick a colour, or C to cycle through them.
const COLORS = [
  { name: 'Ice blue', value: 'rgb(176, 225, 255)' },
  { name: 'White',    value: 'rgb(255, 255, 255)' },
  { name: 'Red',      value: 'rgb(255, 90, 90)' },
  { name: 'Orange',   value: 'rgb(255, 170, 60)' },
  { name: 'Yellow',   value: 'rgb(255, 235, 90)' },
  { name: 'Green',    value: 'rgb(110, 240, 130)' },
  { name: 'Pink',     value: 'rgb(255, 120, 220)' },
];
let colorIndex = 0;
let penColor = COLORS[0].value;

const palette = document.getElementById('palette');
const swatches = COLORS.map((c, i) => {
  const el = document.createElement('div');
  el.className = 'swatch';
  el.style.background = c.value;
  el.style.color = c.value;
  el.title = `${i + 1}: ${c.name}`;
  palette.appendChild(el);
  return el;
});

// ---------- toolbar (pinch or click) ----------
let tool = 'pen'; // 'pen' | 'eraser' | 'recolor'
const TOOL_NAMES = { pen: 'Pen', eraser: 'Rubber', recolor: 'Recolour' };

function setTool(t) {
  tool = t;
  document.querySelectorAll('#toolbar [data-tool]').forEach((el) => {
    el.classList.toggle('active', el.dataset.tool === t);
  });
  drawing = false;
}

const TOOLBAR_ACTIONS = {
  pen: () => { setTool('pen'); showToast('Pen'); },
  eraser: () => { setTool('eraser'); showToast('Rubber: pinch to erase'); },
  recolor: () => { setTool('recolor'); showToast('Recolour: pinch over things to paint them'); },
  undo: () => undo(),
  redo: () => redo(),
  text: () => convertWriting(),
  clear: () => clearAll(),
};

const toolButtons = [...document.querySelectorAll('#toolbar [data-action]')];
toolButtons.forEach((el) => el.addEventListener('click', () => TOOLBAR_ACTIONS[el.dataset.action]()));

// Everything the hand can "press": colours first, then toolbar buttons.
const handTargets = [
  ...swatches.map((el, i) => ({ el, press: () => { setColor(i); showToast(COLORS[i].name); } })),
  ...toolButtons.map((el) => ({ el, press: TOOLBAR_ACTIONS[el.dataset.action] })),
];
swatches.forEach((el, i) => el.addEventListener('click', () => setColor(i)));

function setColor(i) {
  colorIndex = (i + COLORS.length) % COLORS.length;
  penColor = COLORS[colorIndex].value;
  swatches.forEach((el, j) => el.classList.toggle('active', j === colorIndex));
  drawing = false; // next stroke starts in the new colour
}

let strokes = [];

// ---------- undo / redo ----------
// Every change saves a copy of the drawing first, so Z can step back and Y forward.
const MAX_HISTORY = 100;
let undoHistory = [];
let redoStack = [];
let pendingSnapshot = false; // eraser/recolour save a copy only once they actually change something

const cloneItem = (s) => Object.assign([], s); // copies points and properties (colour, text...)
const snapshot = () => ({ strokes: strokes.map(cloneItem), lastConvertedId });

function saveHistory() {
  undoHistory.push(snapshot());
  if (undoHistory.length > MAX_HISTORY) undoHistory.shift();
  redoStack = [];
}

function restore(state) {
  strokes = state.strokes;
  lastConvertedId = state.lastConvertedId;
  drawing = false;
}

function undo() {
  if (!undoHistory.length) return showToast('Nothing to undo');
  redoStack.push(snapshot());
  restore(undoHistory.pop());
}

function redo() {
  if (!redoStack.length) return showToast('Nothing to redo');
  undoHistory.push(snapshot());
  restore(redoStack.pop());
}
let currentStroke = [];
let shiftHeld = false;
let eraserHeld = false;
let recolorHeld = false;
let wasPenDown = false;
let paletteClick = false;  // this pinch picked a colour, so don't draw with it
let hoverSwatch = -1; // R: paint existing lines/text with the current colour
const ERASER_RADIUS = 35;
let drawing = false;
let smoothX = null;
let smoothY = null;
let missedFrames = 0;
const MAX_MISSED_FRAMES = 8; // keep the stroke alive through brief tracking dropouts

// Pinch to draw: thumb tip + index tip together = pen down.
// Distances are relative to hand size, so it works near or far from the camera.
const PINCH_ON = 0.35;  // closer than this -> start drawing
const PINCH_OFF = 0.5;  // further than this -> stop (gap avoids flicker)
let pinching = false;

// Steadiness settings
const PEN_DOWN_FRAMES = 3;  // pinch must hold this many frames before drawing starts
const PEN_UP_FRAMES = 4;    // and be open this many frames before drawing stops
const MIN_POINT_GAP = 3;    // px: ignore tiny wobbles smaller than this
const TRIM_END_POINTS = 4;  // drop the hook made as your fingers open
const MIN_STROKE_LENGTH = 15; // px: throw away accidental tiny marks
let penDown = false;
let pinchCount = 0;
let openCount = 0;
let strokeFromPinch = false;

// Shape correction (like iPad): draw a shape, keep the pen down and hold still.
// Press S to turn it on/off.
let shapeCorrection = true;
const HOLD_MS = 550;        // how long to hold still before snapping
const HOLD_TOLERANCE = 10;  // px of wobble still counted as "still"
let holdAnchor = null;
let holdStart = 0;
let flashUntil = 0; // brief ring around the cursor when a shape snaps

// Handwriting
let beautify = true;          // B: pen-like ink (thick/thin) for freehand lines
let nextStrokeId = 1;
let lastConvertedId = 0;      // T converts writing drawn after this
let learnPending = null;      // L: strokes waiting for you to type which letter they are
const HANDWRITING_FONT = "Caveat, 'Bradley Hand', 'Segoe Print', cursive";
try { document.fonts.load(`40px ${HANDWRITING_FONT}`); } catch {}

const toast = document.getElementById('toast');
const help = document.getElementById('help');
let toastTimer = null;
function showToast(text) {
  toast.textContent = text;
  toast.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove('show'), 2000);
}

// The canvas is mirrored on screen, so flip x to get what you actually see.
function toScreen(stroke) {
  return stroke.map((p) => ({ x: canvas.width - p.x, y: p.y }));
}

// Freehand writing drawn since the last conversion (not shapes, not text).
function newWritingStrokes() {
  return strokes.filter((s) => !s.text && !s.shape && s.length && s.id > lastConvertedId);
}

// Split strokes into lines of writing by their vertical position.
function splitIntoLines(list) {
  const items = list.map((s) => {
    let minY = Infinity, maxY = -Infinity;
    for (const p of s) { minY = Math.min(minY, p.y); maxY = Math.max(maxY, p.y); }
    return { s, cy: (minY + maxY) / 2, h: maxY - minY };
  }).sort((a, b) => a.cy - b.cy);
  const hs = items.map((i) => i.h).sort((a, b) => a - b);
  const lineGap = Math.max(hs[Math.floor(hs.length / 2)] * 0.9, 25);
  const lines = [];
  for (const it of items) {
    const line = lines[lines.length - 1];
    if (line && it.cy - line.cy < lineGap) {
      line.strokes.push(it.s);
      line.cy = (line.cy * (line.strokes.length - 1) + it.cy) / line.strokes.length;
    } else {
      lines.push({ strokes: [it.s], cy: it.cy });
    }
  }
  return lines.map((l) => l.strokes);
}

function convertWriting() {
  const writing = newWritingStrokes();
  if (!writing.length) {
    showToast('Nothing new to convert. Write something first.');
    return;
  }
  const words = [];
  for (const line of splitIntoLines(writing)) {
    const result = recognizeWriting(line.map(toScreen));
    if (!result || !result.text.trim()) continue;
    const size = Math.max(16, result.xHeight * 2.2);
    ctx.font = `${size}px ${HANDWRITING_FONT}`;
    const item = Object.assign([], {
      text: result.text,
      x: canvas.width - result.box.minX, // canvas x of the on-screen left edge
      baseline: result.baseline,
      size,
      width: ctx.measureText(result.text).width,
      color: line[0].color,
      originals: line,
      id: nextStrokeId++,
    });
    words.push(item);
  }
  if (words.length) saveHistory();
  strokes = strokes.filter((s) => !writing.includes(s)).concat(words);
  lastConvertedId = nextStrokeId - 1;
  showToast(words.length ? `"${words.map((w) => w.text).join(' / ')}"  (Z to undo)` : 'Could not read that');
}

function clearAll() {
  if (!strokes.length) return;
  saveHistory();
  strokes = [];
  currentStroke = [];
  drawing = false;
  showToast('Cleared (Z to bring it back)');
}

function startLearning() {
  const writing = newWritingStrokes();
  if (!writing.length) {
    showToast('Write ONE letter first, then press L');
    return;
  }
  learnPending = writing;
  showToast('Now type the letter you just wrote (a-z), or Esc to cancel');
}

function finishLearning(letter) {
  const count = teachLetter(letter, learnPending.map(toScreen));
  saveHistory();
  strokes = strokes.filter((s) => !learnPending.includes(s));
  learnPending = null;
  showToast(`Learned "${letter}". ${count} example${count === 1 ? '' : 's'} saved.`);
}

// Only the middle of the camera view maps to the screen, so small hand
// movements cover the whole wall. 0.15 = ignore 15% on each edge.
const ACTIVE_MARGIN = 0.15;

// One Euro filter: smooths jitter when the hand is slow, stays responsive when fast.
class OneEuro {
  constructor(minCutoff = 1.5, beta = 0.01, dCutoff = 1.0) {
    this.minCutoff = minCutoff;
    this.beta = beta;
    this.dCutoff = dCutoff;
    this.reset();
  }
  reset() {
    this.x = null;
    this.dx = 0;
    this.t = null;
  }
  static alpha(cutoff, dt) {
    const tau = 1 / (2 * Math.PI * cutoff);
    return 1 / (1 + tau / dt);
  }
  filter(value, t) {
    if (this.x === null) {
      this.x = value;
      this.t = t;
      return value;
    }
    const dt = Math.max((t - this.t) / 1000, 1e-3);
    this.t = t;
    const rawDx = (value - this.x) / dt;
    this.dx += OneEuro.alpha(this.dCutoff, dt) * (rawDx - this.dx);
    const cutoff = this.minCutoff + this.beta * Math.abs(this.dx);
    this.x += OneEuro.alpha(cutoff, dt) * (value - this.x);
    return this.x;
  }
}
// Lower first number = steadier but slightly more lag.
const filterX = new OneEuro(0.8, 0.005);
const filterY = new OneEuro(0.8, 0.005);

function strokeLength(stroke) {
  let len = 0;
  for (let i = 1; i < stroke.length; i++) len += dist(stroke[i - 1], stroke[i]);
  return len;
}

// Finish the current stroke, cleaning up pinch artefacts.
function endStroke() {
  holdAnchor = null;
  if (drawing && strokeFromPinch && !currentStroke.snapped) {
    currentStroke.splice(Math.max(1, currentStroke.length - TRIM_END_POINTS));
    if (strokeLength(currentStroke) < MIN_STROKE_LENGTH) {
      strokes = strokes.filter((s) => s !== currentStroke);
      undoHistory.pop(); // the stroke vanished, so its undo step is pointless
    }
  }
  drawing = false;
}

function mapToScreen(v) {
  const t = (v - ACTIVE_MARGIN) / (1 - 2 * ACTIVE_MARGIN);
  return Math.min(1, Math.max(0, t));
}

function dist(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

const MIN_CANVAS = 50; // px: ignore tiny/zero sizes (minimising, dragging very small)

function resizeCanvas() {
  // A zero or tiny size would squash every point into one corner for good,
  // so wait until the window has a real size again.
  if (window.innerWidth < MIN_CANVAS || window.innerHeight < MIN_CANVAS) return;

  const oldWidth = canvas.width >= MIN_CANVAS ? canvas.width : window.innerWidth;
  const oldHeight = canvas.height >= MIN_CANVAS ? canvas.height : window.innerHeight;

  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight;

  const scaleX = canvas.width / oldWidth;
  const scaleY = canvas.height / oldHeight;

  // Scale the drawing and every saved undo/redo copy (shared points only once).
  const items = new Set(strokes);
  for (const state of [...undoHistory, ...redoStack]) state.strokes.forEach((s) => items.add(s));
  for (const s of [...items]) if (s.originals) s.originals.forEach((o) => items.add(o));
  const points = new Set();
  for (const s of items) for (const p of s) points.add(p);
  for (const point of points) {
    point.x *= scaleX;
    point.y *= scaleY;
  }
  for (const stroke of items) {
    if (stroke.text) {
      stroke.x *= scaleX;
      stroke.baseline *= scaleY;
      stroke.size *= scaleY;
      stroke.width *= scaleX;
    }
  }

  if (smoothX !== null) smoothX *= scaleX;
  if (smoothY !== null) smoothY *= scaleY;
  if (typeof filterX !== 'undefined') {
    if (filterX.x !== null) filterX.x *= scaleX;
    if (filterY.x !== null) filterY.x *= scaleY;
  }
}

setColor(0);
resizeCanvas();

// ---------- saving ----------
// Positions are stored as fractions of the screen, so a project opens correctly
// on a different screen or projector.
const AUTOSAVE_KEY = 'air-pen-autosave';
const r3 = (v) => Math.round(v * 10000) / 10000;

function serialize() {
  const W = canvas.width, H = canvas.height;
  return JSON.stringify({
    app: 'air-pen',
    version: 1,
    savedAt: new Date().toISOString(),
    lastConvertedId,
    items: strokes.map((s) => s.text
      ? { type: 'text', text: s.text, color: s.color, id: s.id,
          x: r3(s.x / W), baseline: r3(s.baseline / H), size: r3(s.size / H), width: r3(s.width / W) }
      : { type: 'stroke', color: s.color, id: s.id, sharp: !!s.sharp, shape: !!s.shape,
          points: s.map((p) => [r3(p.x / W), r3(p.y / H)]) }),
  });
}

function deserialize(json) {
  const data = JSON.parse(json);
  if (data.app !== 'air-pen' || !Array.isArray(data.items)) throw new Error('Not an Air Pen project');
  const W = canvas.width, H = canvas.height;
  const items = data.items.map((it) => it.type === 'text'
    ? Object.assign([], { text: it.text, color: it.color, id: it.id,
        x: it.x * W, baseline: it.baseline * H, size: it.size * H, width: it.width * W })
    : Object.assign(it.points.map(([x, y]) => ({ x: x * W, y: y * H })),
        { color: it.color, id: it.id, sharp: it.sharp, shape: it.shape }));
  strokes = items;
  lastConvertedId = data.lastConvertedId || 0;
  nextStrokeId = Math.max(0, ...items.map((s) => s.id || 0)) + 1;
  drawing = false;
}

function download(filename, href) {
  const a = document.createElement('a');
  a.href = href;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
}

const stamp = () => new Date().toISOString().slice(0, 16).replace('T', '_').replace(':', '-');

function saveProject() {
  const url = URL.createObjectURL(new Blob([serialize()], { type: 'application/json' }));
  download(`air-pen_${stamp()}.json`, url);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  showToast('Project saved to your Downloads');
}

const fileInput = document.getElementById('file-input');
function openProject() {
  fileInput.value = '';
  fileInput.click();
}
fileInput.addEventListener('change', async () => {
  const file = fileInput.files[0];
  if (!file) return;
  try {
    const text = await file.text();
    saveHistory(); // Z goes back to what was on screen before opening
    deserialize(text);
    showToast(`Opened ${file.name}`);
  } catch (err) {
    undoHistory.pop();
    showToast('Could not open that file');
    console.error(err);
  }
});

// Picture of the wall as you see it (the canvas is mirrored on screen, so flip it back).
function exportImage() {
  ctx.fillStyle = '#000000';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  drawStrokes(); // fresh render without the cursor
  ctx.shadowBlur = 0;
  const out = document.createElement('canvas');
  out.width = canvas.width;
  out.height = canvas.height;
  const octx = out.getContext('2d');
  octx.translate(out.width, 0);
  octx.scale(-1, 1);
  octx.drawImage(canvas, 0, 0);
  download(`air-pen_${stamp()}.png`, out.toDataURL('image/png'));
  showToast('Picture saved to your Downloads');
}

// Autosave: keep the current drawing in this browser so a reload doesn't lose it.
let lastAutosave = '';
function autosave() {
  const data = serialize().replace(/"savedAt":"[^"]*",/, '');
  if (data === lastAutosave) return;
  lastAutosave = data;
  try {
    localStorage.setItem(AUTOSAVE_KEY, data);
  } catch {
    // storage unavailable or full: skip quietly
  }
}
try {
  const saved = localStorage.getItem(AUTOSAVE_KEY);
  if (saved) {
    deserialize(saved);
    lastAutosave = saved;
    if (strokes.length) showToast('Restored your last drawing (Space clears, Z brings it back)');
  }
} catch (err) {
  console.error('Could not restore autosave:', err);
}
setInterval(autosave, 2000);
window.addEventListener('beforeunload', autosave);
window.addEventListener('resize', resizeCanvas);

async function toggleFullscreen() {
  try {
    if (!document.fullscreenElement) {
      await document.documentElement.requestFullscreen();
    } else {
      await document.exitFullscreen();
    }
  } catch (err) {
    console.error('Fullscreen failed:', err);
  }
}

window.addEventListener('keydown', (e) => {
  // Cmd/Ctrl shortcuts: save and open projects.
  if (e.metaKey || e.ctrlKey) {
    const k = e.key.toLowerCase();
    if (k === 's') { e.preventDefault(); saveProject(); }
    if (k === 'o') { e.preventDefault(); openProject(); }
    return;
  }

  // While teaching a letter, the next key is the letter's name, not a command.
  if (learnPending) {
    if (/^[a-z]$/i.test(e.key)) finishLearning(e.key.toLowerCase());
    else if (e.key === 'Escape') { learnPending = null; showToast('Cancelled'); }
    if (e.key !== 'Shift') return;
  }

  if (e.key.toLowerCase() === 'h' && !e.repeat) {
    help.classList.toggle('open');
  }

  if (e.key === 'Escape') {
    help.classList.remove('open');
  }

  if (e.key.toLowerCase() === 't' && !e.repeat) {
    convertWriting();
  }

  if (e.key.toLowerCase() === 'l' && !e.repeat) {
    startLearning();
  }

  if (e.key.toLowerCase() === 'p' && !e.repeat) {
    TOOLBAR_ACTIONS.pen();
  }

  if (e.key.toLowerCase() === 'i' && !e.repeat && !learnPending) {
    exportImage();
  }

  if (e.key.toLowerCase() === 'b' && !e.repeat) {
    beautify = !beautify;
    showToast(beautify ? 'Ink style on' : 'Ink style off');
  }

  if (e.key === 'Shift') {
    shiftHeld = true;
  }

  if (e.code === 'Space') {
    e.preventDefault();
    clearAll();
  }

  if (/^[1-9]$/.test(e.key) && Number(e.key) <= COLORS.length) {
    setColor(Number(e.key) - 1);
  }

  if (e.key.toLowerCase() === 'c' && !e.repeat) {
    setColor(colorIndex + 1);
  }

  if (e.key.toLowerCase() === 's' && !e.repeat) {
    shapeCorrection = !shapeCorrection;
    showToast(shapeCorrection ? 'Shape correction on' : 'Shape correction off');
  }

  if (e.key.toLowerCase() === 'e') {
    if (!e.repeat) pendingSnapshot = true;
    eraserHeld = true;
    drawing = false;
  }

  if (e.key.toLowerCase() === 'r') {
    if (!e.repeat) pendingSnapshot = true;
    recolorHeld = true;
    drawing = false;
  }

  if (e.key.toLowerCase() === 'z' && !e.repeat) {
    if (e.shiftKey) redo();
    else undo();
  }

  if (e.key.toLowerCase() === 'y' && !e.repeat) {
    redo();
  }

  if (e.key.toLowerCase() === 'f' && !e.repeat) {
    toggleFullscreen();
  }
});

window.addEventListener('keyup', (e) => {
  if (e.key === 'Shift') {
    shiftHeld = false;
    drawing = false;
  }

  if (e.key.toLowerCase() === 'e') {
    eraserHeld = false;
  }

  if (e.key.toLowerCase() === 'r') {
    recolorHeld = false;
  }
});

window.addEventListener('blur', () => {
  shiftHeld = false;
  eraserHeld = false;
  recolorHeld = false;
  drawing = false;
});

function drawStrokes() {
  ctx.shadowBlur = 15;
  ctx.lineWidth = 6;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  for (const stroke of strokes) {
    ctx.shadowColor = stroke.color;
    ctx.strokeStyle = stroke.color;
    if (stroke.text) {
      drawText(stroke);
      continue;
    }
    if (stroke.length === 1) {
      ctx.beginPath();
      ctx.arc(stroke[0].x, stroke[0].y, ctx.lineWidth / 2, 0, Math.PI * 2);
      ctx.fillStyle = stroke.color;
      ctx.fill();
      continue;
    }
    if (stroke.sharp) {
      ctx.beginPath();
      ctx.moveTo(stroke[0].x, stroke[0].y);
      for (let i = 1; i < stroke.length; i++) ctx.lineTo(stroke[i].x, stroke[i].y);
      ctx.stroke();
      continue;
    }
    if (beautify && stroke.length > 2) {
      drawInk(stroke);
      continue;
    }
    // Draw curves through the midpoints between points for a smoother line.
    ctx.beginPath();
    ctx.moveTo(stroke[0].x, stroke[0].y);
    for (let i = 1; i < stroke.length - 1; i++) {
      const midX = (stroke[i].x + stroke[i + 1].x) / 2;
      const midY = (stroke[i].y + stroke[i + 1].y) / 2;
      ctx.quadraticCurveTo(stroke[i].x, stroke[i].y, midX, midY);
    }
    const end = stroke[stroke.length - 1];
    ctx.lineTo(end.x, end.y);
    ctx.stroke();
  }
}

function drawText(item) {
  ctx.save();
  ctx.translate(item.x, item.baseline);
  ctx.scale(-1, 1); // undo the mirror so the text reads the right way round
  ctx.font = `${item.size}px ${HANDWRITING_FONT}`;
  ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = item.color;
  ctx.shadowColor = item.color;
  ctx.shadowBlur = 15;
  ctx.fillText(item.text, 0, 0);
  ctx.restore();
}

// Pen-like ink: thicker when you move slowly, thinner when fast, tapered ends.
function drawInk(stroke) {
  const n = stroke.length;
  const widths = new Array(n);
  let w = 6;
  for (let i = 0; i < n; i++) {
    const d = i > 0 ? dist(stroke[i - 1], stroke[i]) : 0;
    const target = 9 * Math.min(1.25, Math.max(0.4, 1.2 - d / 30));
    w += (target - w) * 0.35; // ease width changes so they flow
    const taper = Math.min(1, (i + 1) / 6, (n - i) / 6);
    widths[i] = Math.max(1.5, w * (0.35 + 0.65 * taper));
  }

  // Soft glow underneath (one path, cheap).
  ctx.beginPath();
  ctx.moveTo(stroke[0].x, stroke[0].y);
  for (let i = 1; i < n - 1; i++) {
    ctx.quadraticCurveTo(stroke[i].x, stroke[i].y, (stroke[i].x + stroke[i + 1].x) / 2, (stroke[i].y + stroke[i + 1].y) / 2);
  }
  ctx.lineTo(stroke[n - 1].x, stroke[n - 1].y);
  ctx.lineWidth = 3;
  ctx.stroke();

  // Ink on top: each curve piece at its own width.
  ctx.save();
  ctx.shadowBlur = 0;
  let prev = stroke[0];
  for (let i = 1; i < n - 1; i++) {
    const mid = { x: (stroke[i].x + stroke[i + 1].x) / 2, y: (stroke[i].y + stroke[i + 1].y) / 2 };
    ctx.beginPath();
    ctx.moveTo(prev.x, prev.y);
    ctx.quadraticCurveTo(stroke[i].x, stroke[i].y, mid.x, mid.y);
    ctx.lineWidth = widths[i];
    ctx.stroke();
    prev = mid;
  }
  ctx.beginPath();
  ctx.moveTo(prev.x, prev.y);
  ctx.lineTo(stroke[n - 1].x, stroke[n - 1].y);
  ctx.lineWidth = widths[n - 1];
  ctx.stroke();
  ctx.restore();
  ctx.lineWidth = 6;
}

function textHit(item, x, y, r) {
  const left = item.x - item.width; // mirrored: text runs toward smaller canvas x
  const top = item.baseline - item.size * 0.8;
  const bottom = item.baseline + item.size * 0.3;
  const cx = Math.max(left, Math.min(x, item.x));
  const cy = Math.max(top, Math.min(y, bottom));
  return Math.hypot(x - cx, y - cy) <= r;
}

// Remove every point within the eraser radius, splitting strokes where they get cut.
function eraseAt(x, y) {
  const r2 = ERASER_RADIUS * ERASER_RADIUS;
  const before = pendingSnapshot ? snapshot() : null; // only copy when an undo step is needed
  let changed = false;
  const kept = [];
  for (const stroke of strokes) {
    if (stroke.text) {
      if (!textHit(stroke, x, y, ERASER_RADIUS)) kept.push(stroke); // rubbing text removes the word
      else changed = true;
      continue;
    }
    const newPiece = () => Object.assign([], {
      color: stroke.color, sharp: stroke.sharp, shape: stroke.shape, id: stroke.id,
    });
    let piece = newPiece();
    for (const p of stroke) {
      const dx = p.x - x;
      const dy = p.y - y;
      if (dx * dx + dy * dy <= r2) {
        changed = true;
        if (piece.length) kept.push(piece);
        piece = newPiece();
      } else {
        piece.push(p);
      }
    }
    if (piece.length) kept.push(piece);
  }
  if (!changed) return;
  if (pendingSnapshot) {
    undoHistory.push(before);
    redoStack = [];
    pendingSnapshot = false;
  }
  strokes = kept;
}

// Recolour brush: anything under the ring takes the current pen colour.
function recolorAt(x, y) {
  const r2 = ERASER_RADIUS * ERASER_RADIUS;
  for (const item of strokes) {
    if (item.color === penColor) continue;
    const hit = item.text
      ? textHit(item, x, y, ERASER_RADIUS)
      : item.some((p) => (p.x - x) ** 2 + (p.y - y) ** 2 <= r2);
    if (!hit) continue;
    if (pendingSnapshot) {
      saveHistory();
      pendingSnapshot = false;
    }
    item.color = penColor;
  }
}

function drawCursor() {
  if (performance.now() < flashUntil) {
    ctx.beginPath();
    ctx.arc(smoothX, smoothY, 22, 0, Math.PI * 2);
    ctx.shadowBlur = 0;
    ctx.strokeStyle = '#FFFFFF';
    ctx.lineWidth = 2;
    ctx.stroke();
  }
  const eraserMode = eraserHeld || (tool === 'eraser' && !recolorHeld);
  const recolorMode = !eraserMode && (recolorHeld || tool === 'recolor');
  const pressing = penDown && !paletteClick;
  if (recolorMode) {
    ctx.beginPath();
    ctx.arc(smoothX, smoothY, ERASER_RADIUS, 0, Math.PI * 2);
    ctx.shadowColor = penColor;
    ctx.shadowBlur = 10;
    ctx.strokeStyle = penColor;
    ctx.lineWidth = pressing || recolorHeld ? 4 : 2;
    ctx.setLineDash([6, 5]);
    ctx.stroke();
    ctx.setLineDash([]);
    return;
  }
  if (eraserMode) {
    ctx.beginPath();
    ctx.arc(smoothX, smoothY, ERASER_RADIUS, 0, Math.PI * 2);
    ctx.shadowBlur = 0;
    if (pressing || eraserHeld) {
      ctx.fillStyle = 'rgba(255, 128, 128, 0.18)';
      ctx.fill();
    }
    ctx.strokeStyle = '#FF8080';
    ctx.lineWidth = 2;
    ctx.stroke();
    return;
  }
  ctx.beginPath();
  ctx.arc(smoothX, smoothY, 6, 0, Math.PI * 2);
  ctx.shadowColor = penColor;
  ctx.shadowBlur = 15;
  ctx.fillStyle = (shiftHeld || penDown) ? '#FFFFFF' : penColor;
  ctx.fill();
}

function onResults(results) {
  ctx.fillStyle = '#000000';
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  drawStrokes();

  if (!results.multiHandLandmarks || results.multiHandLandmarks.length === 0) {
    missedFrames++;
    if (missedFrames > MAX_MISSED_FRAMES) {
      endStroke();
      pinching = false;
      penDown = false;
      pinchCount = 0;
      openCount = 0;
      smoothX = null;
      smoothY = null;
      filterX.reset();
      filterY.reset();
    }
    ctx.shadowBlur = 0;
    return;
  }
  missedFrames = 0;

  const hand = results.multiHandLandmarks[0];
  const thumbTip = hand[4];
  const indexTip = hand[8];
  const handSize = dist(hand[0], hand[9]) || 1e-6; // wrist -> middle knuckle

  const pinchRatio = dist(thumbTip, indexTip) / handSize;
  if (!pinching && pinchRatio < PINCH_ON) pinching = true;
  else if (pinching && pinchRatio > PINCH_OFF) pinching = false;

  // Debounce: only change pen state after it's been stable for a few frames.
  if (pinching) {
    pinchCount++;
    openCount = 0;
    if (pinchCount >= PEN_DOWN_FRAMES) penDown = true;
  } else {
    openCount++;
    pinchCount = 0;
    if (openCount >= PEN_UP_FRAMES) penDown = false;
  }

  // Pen point = midpoint of thumb and index tips, so it doesn't jump when you pinch.
  const px = (thumbTip.x + indexTip.x) / 2;
  const py = (thumbTip.y + indexTip.y) / 2;
  const now = performance.now();
  smoothX = filterX.filter(mapToScreen(px) * canvas.width, now);
  smoothY = filterY.filter(mapToScreen(py) * canvas.height, now);

  // Press colours and toolbar buttons with your hand: move the dot over one and pinch.
  const screenX = canvas.width - smoothX; // canvas is mirrored on screen
  const hit = handTargets.findIndex(({ el }) => {
    const r = el.getBoundingClientRect();
    const pad = 8; // a little extra room: hands aren't precise
    return screenX >= r.left - pad && screenX <= r.right + pad && smoothY >= r.top - pad && smoothY <= r.bottom + pad;
  });
  if (hit !== hoverSwatch) {
    handTargets.forEach(({ el }, j) => el.classList.toggle('hover', j === hit));
    hoverSwatch = hit;
  }
  const pinchStarted = penDown && !wasPenDown;
  if (pinchStarted && hit !== -1) {
    handTargets[hit].press();
    paletteClick = true; // this pinch pressed a button, so it doesn't draw
  }
  if (!penDown) paletteClick = false;
  wasPenDown = penDown;

  // Rubber/recolour: hold E/R, or pick the tool and pinch.
  const handActive = penDown && !paletteClick;
  const erasing = eraserHeld || (tool === 'eraser' && handActive);
  const recoloring = !erasing && (recolorHeld || (tool === 'recolor' && handActive));
  if (pinchStarted && !paletteClick && tool !== 'pen') pendingSnapshot = true;

  if (erasing) {
    eraseAt(smoothX, smoothY);
  } else if (recoloring) {
    recolorAt(smoothX, smoothY);
  }

  drawCursor();

  if (erasing || recoloring || eraserHeld || recolorHeld) {
    endStroke();
  } else if (shiftHeld || (handActive && tool === 'pen')) {
    if (!drawing) {
      drawing = true;
      strokeFromPinch = !shiftHeld;
      saveHistory();
      currentStroke = Object.assign([], { color: penColor, id: nextStrokeId++ });
      strokes.push(currentStroke);
    }
    const point = { x: smoothX, y: smoothY };

    if (!currentStroke.snapped) {
      const last = currentStroke[currentStroke.length - 1];
      if (!last || dist(last, point) >= MIN_POINT_GAP) currentStroke.push(point);

      // Held still long enough? Try to snap to a clean shape.
      if (!holdAnchor || dist(holdAnchor, point) > HOLD_TOLERANCE) {
        holdAnchor = point;
        holdStart = now;
      } else if (shapeCorrection && now - holdStart > HOLD_MS) {
        // Ignore the points from the hold itself.
        const pts = currentStroke.filter((p) => dist(p, holdAnchor) > HOLD_TOLERANCE || p === currentStroke[0]);
        pts.push(holdAnchor);
        const shape = recognizeShape(pts);
        if (shape) {
          currentStroke.length = 0;
          currentStroke.push(...shape.points);
          currentStroke.sharp = shape.sharp;
          currentStroke.shape = true;
          flashUntil = now + 250;
        }
        currentStroke.snapped = true; // stop adding points until the pen lifts
      }
    }
  } else {
    endStroke();
  }

  ctx.shadowBlur = 0;
}

const hands = new Hands({
  locateFile: (file) => `https://cdn.jsdelivr.net/npm/@mediapipe/hands/${file}`
});

hands.setOptions({
  maxNumHands: 1,
  modelComplexity: 1,
  minDetectionConfidence: 0.5,
  minTrackingConfidence: 0.5
});

hands.onResults(onResults);

const camera = new Camera(video, {
  onFrame: async () => {
    await hands.send({ image: video });
  },
  width: 1280,
  height: 720
});

camera.start();
