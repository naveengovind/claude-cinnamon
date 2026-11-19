/// <reference path="../../types/cinnamon.d.ts" />
// A playable falling-blocks game that docks at the side while Claude is working.
// Click the panel to give it the keyboard; click the chat box to go back to typing.

const COLS = 10, ROWS = 20, S = 20;
const SHAPES = [
  [[1,1,1,1]], [[1,1],[1,1]], [[0,1,0],[1,1,1]], [[0,1,1],[1,1,0]],
  [[1,1,0],[0,1,1]], [[1,0,0],[1,1,1]], [[0,0,1],[1,1,1]],
];
const COLORS = ['#ff9e5e', '#f4c95d', '#e0607e', '#8bd17c', '#ef5b3c', '#6aa8ff', '#c38cf2'];
const color = (c: number): string => COLORS[c - 1] ?? COLORS[0]!;

type P = { m: number[][]; c: number; x: number; y: number };

// ---- DOM ----
const root = document.createElement('div');
root.className = 'cin-blocks'; root.tabIndex = 0; root.dataset.on = '0';
root.innerHTML = `
  <canvas class="board" width="${COLS*S}" height="${ROWS*S}"></canvas>
  <div class="side">
    <div><div class="lbl">Next</div><canvas class="next" width="80" height="60"></canvas></div>
    <div><div class="lbl">Score</div><div class="val score">0</div></div>
    <div><div class="lbl">Lines</div><div class="val lines">0</div></div>
    <div><div class="lbl">Best</div><div class="val best">0</div></div>
    <div class="help">← → move<br>↑ rotate<br>↓ soft drop<br>space drop<br>P pause</div>
  </div>
  <div class="msg"></div>
  <button class="x" title="Hide until the next prompt">✕</button>`;
document.body.append(root);
const board = root.querySelector<HTMLCanvasElement>('.board')!;
const nextC = root.querySelector<HTMLCanvasElement>('.next')!;
const g = board.getContext('2d')!, ng = nextC.getContext('2d')!;
const $ = (s: string) => root.querySelector<HTMLElement>(s)!;
const msg = $('.msg');

// ---- game state ----
let grid: number[][], cur: P, nxt: P, score = 0, lines = 0, over = false, paused = false;
let best = Number(cinnamon.settings.get('best') ?? 0) || 0;
let dropAcc = 0, last = 0, raf = 0, busy = false, dismissed = false, focused = false;

const rnd = (): P => { const c = Math.floor(Math.random() * 7); return { m: SHAPES[c]!, c: c + 1, x: 0, y: 0 }; };
const rot = (m: number[][]): number[][] => m[0]!.map((_, i) => m.map(r => r[i]!).reverse());
const fits = (m: number[][], x: number, y: number) =>
  m.every((r, i) => r.every((v, j) => !v || (x + j >= 0 && x + j < COLS && y + i < ROWS && (y + i < 0 || !grid[y + i]![x + j]))));

function reset() {
  grid = Array.from({ length: ROWS }, () => Array(COLS).fill(0));
  score = 0; lines = 0; over = false; nxt = rnd(); spawn();
}
function spawn() {
  cur = nxt; nxt = rnd();
  cur.x = Math.floor((COLS - cur.m[0]!.length) / 2); cur.y = -1;
  if (!fits(cur.m, cur.x, cur.y)) {
    over = true;
    if (score > best) { best = score; cinnamon.settings.set('best', best); }
  }
}
function lock() {
  cur.m.forEach((r, i) => r.forEach((v, j) => { if (v && cur.y + i >= 0) grid[cur.y + i]![cur.x + j] = cur.c; }));
  let n = 0;
  for (let y = ROWS - 1; y >= 0; y--) if (grid[y]!.every(Boolean)) { grid.splice(y, 1); grid.unshift(Array(COLS).fill(0)); n++; y++; }
  lines += n; score += ([0, 100, 300, 500, 800][n] ?? 800) * (1 + Math.floor(lines / 10));
  spawn();
}
function step() { if (fits(cur.m, cur.x, cur.y + 1)) cur.y++; else lock(); }
const level = () => Math.floor(lines / 10);
const interval = () => Math.max(0.08, 0.8 - level() * 0.07);

// ---- drawing ----
function cell(ctx: CanvasRenderingContext2D, x: number, y: number, s: number, color: string, a = 1) {
  ctx.globalAlpha = a;
  ctx.fillStyle = color; ctx.fillRect(x + 1, y + 1, s - 2, s - 2);
  ctx.fillStyle = 'rgba(255,255,255,0.35)'; ctx.fillRect(x + 1, y + 1, s - 2, 3);
  ctx.fillStyle = 'rgba(0,0,0,0.3)'; ctx.fillRect(x + 1, y + s - 4, s - 2, 3);
  ctx.globalAlpha = 1;
}
function draw() {
  g.clearRect(0, 0, board.width, board.height);
  g.strokeStyle = 'rgba(255,255,255,0.04)';
  for (let x = 1; x < COLS; x++) { g.beginPath(); g.moveTo(x*S+.5, 0); g.lineTo(x*S+.5, ROWS*S); g.stroke(); }
  grid.forEach((r, y) => r.forEach((v, x) => v && cell(g, x*S, y*S, S, color(v))));
  if (!over) {
    let gy = cur.y; while (fits(cur.m, cur.x, gy + 1)) gy++;
    cur.m.forEach((r, i) => r.forEach((v, j) => v && cell(g, (cur.x+j)*S, (gy+i)*S, S, color(cur.c), 0.22)));
    cur.m.forEach((r, i) => r.forEach((v, j) => v && cur.y+i >= 0 && cell(g, (cur.x+j)*S, (cur.y+i)*S, S, color(cur.c))));
  }
  ng.clearRect(0, 0, 80, 60);
  const ns = 16, ox = (80 - nxt.m[0]!.length*ns)/2, oy = (60 - nxt.m.length*ns)/2;
  nxt.m.forEach((r, i) => r.forEach((v, j) => v && cell(ng, ox+j*ns, oy+i*ns, ns, color(nxt.c))));
  $('.score').textContent = String(score); $('.lines').textContent = String(lines); $('.best').textContent = String(best);
  const text = over ? 'Game over<br><br>press Enter<br>to play again'
    : !busy ? 'Claude is done ✓'
    : paused ? 'Paused<br><br>P to resume'
    : !focused ? 'Click here to play' : '';
  msg.innerHTML = text; msg.hidden = !text;
}

function frame(t: number) {
  try {
    const dt = Math.min(0.1, (t - (last || t)) / 1000); last = t;
    if (busy && focused && !paused && !over) {
      dropAcc += dt;
      while (dropAcc > interval()) { dropAcc -= interval(); step(); }
    }
    draw();
  } catch { /* keep going */ }
  raf = busy || root.dataset.on === '1' ? requestAnimationFrame(frame) : 0;
  if (!raf) last = 0;
}

// ---- input (only while the panel has focus, so the chat box keeps its keys) ----
function onKey(e: KeyboardEvent) {
  try {
    if (!busy) return;
    const k = e.key;
    const handled = ['ArrowLeft','ArrowRight','ArrowDown','ArrowUp',' ','p','P','Enter','x','z'].includes(k);
    if (!handled) return;
    e.preventDefault(); e.stopPropagation();
    if (over) { if (k === 'Enter') reset(); return; }
    if (k === 'p' || k === 'P') { paused = !paused; return; }
    if (paused) return;
    if (k === 'ArrowLeft' && fits(cur.m, cur.x - 1, cur.y)) cur.x--;
    else if (k === 'ArrowRight' && fits(cur.m, cur.x + 1, cur.y)) cur.x++;
    else if (k === 'ArrowDown') { step(); score += 1; dropAcc = 0; }
    else if (k === 'ArrowUp' || k === 'x' || k === 'z') {
      const m = k === 'z' ? rot(rot(rot(cur.m))) : rot(cur.m);
      for (const kick of [0, -1, 1, -2, 2]) if (fits(m, cur.x + kick, cur.y)) { cur.m = m; cur.x += kick; break; }
    } else if (k === ' ') { while (fits(cur.m, cur.x, cur.y + 1)) { cur.y++; score += 2; } lock(); dropAcc = 0; }
  } catch { /* ignore */ }
}
root.addEventListener('keydown', onKey);
const onFocus = () => { focused = true; }, onBlur = () => { focused = false; };
root.addEventListener('focus', onFocus); root.addEventListener('blur', onBlur);
root.addEventListener('mousedown', (e) => { if (!(e.target as HTMLElement).closest('.x')) { e.preventDefault(); root.focus(); } });
$('.x').addEventListener('click', () => { dismissed = true; show(false); });

// ---- show while a prompt is running ----
function isBusy() {
  return !!document.querySelector('button[aria-label="Stop"], button[aria-label="Stop response"], button[aria-label^="Stop generating"]');
}
let hideTimer = 0;
function show(on: boolean) {
  clearTimeout(hideTimer);
  root.dataset.on = on ? '1' : '0';
  if (!on && document.activeElement === root) root.blur();
  if (on && !raf) raf = requestAnimationFrame(frame);
}
const poll = setInterval(() => {
  try {
    const b = isBusy();
    if (b === busy) return;
    busy = b;
    if (busy) { if (!dismissed) show(true); }
    else {
      dismissed = false;
      // let the player see "Claude is done", then tuck away. Game state is kept for next time.
      hideTimer = window.setTimeout(() => show(false), 1800);
    }
  } catch { /* never break the page */ }
}, 300);

reset();
draw();

cinnamon.onDispose(() => {
  clearInterval(poll); clearTimeout(hideTimer);
  if (raf) cancelAnimationFrame(raf);
  root.remove();
});
export {}; // a module: its names stay its own (Bun wraps it for the page)
