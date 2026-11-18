/// <reference path="../../types/cinnamon.d.ts" />
// An original pixel alien critter piloting a little saucer around the window. Purely decorative: clicks pass through.
const S = 3, GW = 40, GH = 50;
const wrap = document.createElement('div');
wrap.className = 'cin-ufo';
wrap.setAttribute('aria-hidden', 'true');
const cv = document.createElement('canvas');
cv.width = GW; cv.height = GH;
wrap.append(cv);
document.body.append(wrap);
const g = cv.getContext('2d')!;

const O = '#ff7a1a', OD = '#d9520a', OL = '#ffb066', EYE = '#1a0700';
const px = (x: number, y: number, c: string, w = 1, h = 1) => { g.fillStyle = c; g.fillRect(x, y, w, h); };

function draw(f: number, beam: number, panic = false) {
  g.clearRect(0, 0, GW, GH);
  // tractor beam
  if (beam > 0) {
    for (let y = 20; y < GH; y++) {
      const half = 4 + (y - 20) * 0.45;
      const a = beam * 0.32 * (1 - (y - 20) / (GH - 20));
      g.fillStyle = `rgba(255, 214, 140, ${a.toFixed(3)})`;
      g.fillRect(Math.round(20 - half), y, Math.round(half * 2), 1);
    }
    for (let i = 0; i < 5; i++) {
      const sy = 22 + ((f * 2 + i * 6) % 26), sx = 20 + Math.round(Math.sin(f * 0.7 + i * 2) * (2 + (sy - 20) * 0.3));
      px(sx, sy, `rgba(255,245,220,${(beam * 0.9).toFixed(2)})`);
    }
  }
  // glass dome
  g.fillStyle = 'rgba(200, 240, 255, 0.22)';
  for (let y = 2; y <= 14; y++) {
    const dy = 14 - y, half = Math.round(Math.sqrt(Math.max(0, 81 - dy * dy * 0.62)));
    g.fillRect(20 - half, y, half * 2, 1);
  }
  // critter: antennae with glowing tips
  const blink = f % 40 === 0 || f % 40 === 1;
  const glow = (f >> 2) % 2 ? '#fff3a8' : '#ffd23a';
  px(17, 5, OD, 1, 2); px(22, 5, OD, 1, 2); px(16, 4, glow, 2, 1); px(22, 4, glow, 2, 1);
  // body
  px(15, 7, O, 10, 7); px(15, 7, OL, 10, 1); px(15, 13, OD, 10, 1);
  // eyes
  if (blink) { px(17, 10, EYE, 2, 1); px(21, 10, EYE, 2, 1); }
  else { px(17, 9, EYE, 2, 2); px(21, 9, EYE, 2, 2); px(17, 9, '#fff', 1, 1); px(21, 9, '#fff', 1, 1); }
  // waving arms
  const up = (f >> 3) % 2 === 0;
  px(13, up ? 9 : 11, O, 2, 2); px(25, up ? 11 : 9, O, 2, 2);
  // saucer
  px(9, 14, '#fff0e0', 22, 1);
  px(4, 15, '#e9d6c6', 32, 1);
  px(3, 16, '#cdb6a4', 34, 2);
  px(5, 18, '#8a6f5e', 30, 1);
  px(10, 19, '#5c463a', 20, 1);
  for (let i = 0; i < 8; i++) {
    const on = (i + (f >> 1)) % 4 === 0;
    px(5 + i * 4, 16, on ? '#ff5a00' : '#7a3a14', 2, 1);
  }
  if (panic) { const c = (f >> 1) % 2 ? '#ffffff' : '#ffe14a'; px(27, 0, c, 2, 4); px(27, 5, c, 2, 2); }
  // dome rim highlight
  px(14, 4, 'rgba(255,255,255,0.55)', 2, 1); px(12, 6, 'rgba(255,255,255,0.4)', 1, 2);
}

const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
const speed = reduce ? 0.3 : 1;

// ---------- cows ----------
// A small original pixel cow, 16x11, drawn facing right.
const CW = 16, CH = 11, CS = 3;
const COW = [
  '..........hh....',
  '.........hWWh...',
  '..WWBBWWWWWWWBW.',
  '.WWBBBWWWBBWWWWE',
  '.WWWBWWWWBBWWWWW',
  'TWWWWWWWBWWWWPPP',
  '.WWWWWWWWWWWWPNP',
  '..WWWWWWWWWWW...',
  '..L.L.....L.L...',
  '..L.L.....L.L...',
  '..K.K.....K.K...',
];
const CC: Record<string, string> = { W: '#fff8f0', B: '#2a1a12', h: '#d8c3a5', E: '#1a0700', T: '#2a1a12', P: '#ffaab0', N: '#c25a6a', L: '#efe4d8', K: '#3a2a20' };
type Cow = { el: HTMLCanvasElement; g: CanvasRenderingContext2D; x: number; y: number; dir: number; v: number; state: 'walk' | 'lift' | 'fall' | 'gone'; lift: number; fallV: number; frame: number };
const cows: Cow[] = [];
const groundY = () => innerHeight - CH * CS - 10;
function drawCow(c: Cow) {
  const g2 = c.g; g2.clearRect(0, 0, CW, CH);
  const step = c.state === 'walk' ? (c.frame >> 2) % 2 : 0;
  COW.forEach((row, yy) => {
    for (let xx = 0; xx < CW; xx++) {
      const ch = row[xx]; if (!ch || ch === '.') continue;
      let dy = 0;
      if ((ch === 'L' || ch === 'K') && ((xx === 2 || xx === 10) ? step : 1 - step)) dy = -1; // alternate legs
      if (c.state === 'lift' && (ch === 'L' || ch === 'K')) dy = (c.frame >> 1) % 2 ? -1 : 0; // kicking
      g2.fillStyle = CC[ch] ?? "#000"; g2.fillRect(xx, yy + dy, 1, 1);
    }
  });
}
function spawnCow() {
  const el = document.createElement('canvas');
  el.width = CW; el.height = CH; el.className = 'cin-cow'; el.setAttribute('aria-hidden', 'true');
  const dir = Math.random() < 0.5 ? 1 : -1;
  const c: Cow = { el, g: el.getContext('2d')!, x: dir > 0 ? -60 : innerWidth + 20, y: groundY(), dir, v: 22 + Math.random() * 14, state: 'walk', lift: 0, fallV: 0, frame: 0 };
  document.body.append(el); cows.push(c); drawCow(c);
}
function placeCow(c: Cow) {
  const s = c.state === 'lift' ? 1 - c.lift * 0.65 : 1;
  const wob = c.state === 'lift' ? Math.sin(c.frame * 0.6) * 12 : 0;
  c.el.style.transform = `translate3d(${c.x.toFixed(1)}px, ${c.y.toFixed(1)}px, 0) scale(${(c.dir * s).toFixed(3)}, ${s.toFixed(3)}) rotate(${(wob * c.dir).toFixed(1)}deg)`;
  c.el.style.opacity = c.state === 'lift' && c.lift > 0.85 ? String(Math.max(0, (1 - c.lift) / 0.15)) : '1';
}

// ---------- the UFO ----------
let raf = 0, frame = -1, t0 = performance.now(), last = t0;
const seed = Math.random() * 100;
let mx = -9999, my = -9999;
const onMove = (e: PointerEvent) => { mx = e.clientX; my = e.clientY; };
const onLeave = () => { mx = my = -9999; };
addEventListener('pointermove', onMove, { passive: true });
document.documentElement.addEventListener('pointerleave', onLeave);

let x = innerWidth / 2, y = innerHeight / 4;
let mode: 'wander' | 'flee' | 'hunt' = 'wander';
let fleeUntil = 0, fleeTx = 0, fleeTy = 0, nextCow = performance.now() + 6000;
const UW = 120, UH = 150, NEAR = 170;

function tick(now: number) {
  try {
    const dt = Math.min(0.05, (now - last) / 1000) * speed; last = now;
    const t = (now - t0) / 1000 * speed + seed;
    const cx = x + UW / 2, cy = y + 45;
    const md = Math.hypot(mx - cx, my - cy);

    // --- mouse gets close: run away ---
    if (md < NEAR) {
      if (mode !== 'flee' || md < NEAR * 0.7) {
        let ax = cx - mx, ay = cy - my; const n = Math.hypot(ax, ay) || 1; ax /= n; ay /= n;
        fleeTx = cx + ax * 340 - UW / 2; fleeTy = cy + ay * 260 - 45;
        const cxT = Math.max(0, Math.min(innerWidth - UW, fleeTx)), cyT = Math.max(0, Math.min(innerHeight - UH, fleeTy));
        // cornered: dash to the far side instead
        if (Math.hypot(cxT + UW / 2 - mx, cyT + 45 - my) < 220) { fleeTx = mx > innerWidth / 2 ? 20 : innerWidth - UW - 20; fleeTy = my > innerHeight / 2 ? 30 : innerHeight - UH - 60; }
        else { fleeTx = cxT; fleeTy = cyT; }
      }
      mode = 'flee'; fleeUntil = now + 1800;
    } else if (mode === 'flee' && now > fleeUntil) mode = 'wander';

    // --- cows ---
    if (now > nextCow && cows.filter((c) => c.state !== 'gone').length === 0) { spawnCow(); nextCow = now + 25000 + Math.random() * 20000; }
    const prey = cows.find((c) => c.state === 'walk' || c.state === 'lift');
    if (mode !== 'flee') mode = prey ? 'hunt' : 'wander';

    let tx: number, ty: number, k: number;
    if (mode === 'flee') { tx = fleeTx; ty = fleeTy; k = 6; }
    else if (mode === 'hunt' && prey) {
      tx = prey.x + (CW * CS) / 2 - UW / 2 + prey.dir * prey.v * 0.4;
      ty = groundY() - 118 + Math.sin(t * 2.4) * 3; k = 2.2;
    } else {
      const W = innerWidth - UW - 10, H = innerHeight - UH - 120;
      tx = (0.5 + 0.42 * Math.sin(t * 0.11) + 0.08 * Math.sin(t * 0.37)) * W;
      ty = (0.4 + 0.35 * Math.sin(t * 0.083 + 1.3) + 0.1 * Math.sin(t * 0.29)) * H + Math.sin(t * 2.2) * 6;
      k = 1.1;
    }
    tx = Math.max(-10, Math.min(innerWidth - UW + 10, tx)); ty = Math.max(-10, Math.min(innerHeight - UH + 10, ty));
    const a = 1 - Math.exp(-k * dt);
    const nx = x + (tx - x) * a, ny = y + (ty - y) * a;
    const vx = (nx - x) / Math.max(dt, 0.001); x = nx; y = ny;
    const shake = mode === 'flee' ? Math.sin(now / 30) * 4 : 0;
    const tilt = Math.max(-18, Math.min(18, vx * 0.05)) + shake;
    wrap.style.transform = `translate3d(${x.toFixed(1)}px, ${y.toFixed(1)}px, 0) rotate(${tilt.toFixed(1)}deg)`;

    // --- abduction ---
    let beam = 0;
    const ux = x + UW / 2;
    for (const c of cows) {
      c.frame++;
      const ccx = c.x + (CW * CS) / 2;
      if (c.state === 'walk') {
        c.x += c.dir * c.v * dt; c.y = groundY();
        if (mode === 'hunt' && c === prey && Math.abs(ccx - ux) < 14 && Math.abs(y - (groundY() - 118)) < 16) c.state = 'lift';
        if (c.x < -80 || c.x > innerWidth + 80) c.state = 'gone';
      } else if (c.state === 'lift') {
        if (mode === 'flee') { c.state = 'fall'; c.fallV = 0; c.v = 80; continue; } // spooked: drop it, it bolts
        beam = 1;
        c.lift = Math.min(1, c.lift + dt / 2.6);
        const g0 = groundY(), top = y + 52;
        c.y = g0 + (top - g0) * (c.lift * c.lift * (3 - 2 * c.lift));
        c.x += (ux - (CW * CS) / 2 - c.x) * (1 - Math.exp(-6 * dt));
        if (c.lift >= 1) c.state = 'gone';
      } else if (c.state === 'fall') {
        c.fallV += 900 * dt; c.y += c.fallV * dt; c.lift = Math.max(0, c.lift - dt * 2);
        if (c.y >= groundY()) { c.y = groundY(); c.state = 'walk'; c.lift = 0; c.dir = ccx < ux ? -1 : 1; } // runs away from the UFO
      }
      if (c.state === 'gone') { c.el.remove(); continue; }
      placeCow(c);
      if (c.frame % 2 === 0) drawCow(c);
    }
    for (let i = cows.length - 1; i >= 0; i--) if (cows[i]!.state === 'gone') cows.splice(i, 1);

    const f = Math.floor(t * 10);
    if (f !== frame || beam) { frame = f; draw(f, beam, mode === 'flee'); }
  } catch { /* never break the page */ }
  raf = requestAnimationFrame(tick);
}
raf = requestAnimationFrame(tick);
cinnamon.onDispose(() => {
  cancelAnimationFrame(raf);
  removeEventListener('pointermove', onMove);
  document.documentElement.removeEventListener('pointerleave', onLeave);
  cows.forEach((c) => c.el.remove());
  wrap.remove();
});
