/* The shape of bent film.
 *
 * A strip that is pushed lengthwise against something that holds it (the eyepiece resting on it) cannot slide, so it buckles: the length
 * it cannot use becomes slack, and the slack lifts into a single peak somewhere between the hand and the thing holding it. Film is stiff and thin, so the arch is one smooth bow, not a wobble, and the arc length is kept: where the film
 * lifts, it also draws in lengthwise.
 *
 * This file holds only the shape. film.js works out the slack and the pushing; raster.js draws the strip bent.
 *
 *   bk = { d: slack (px), a: arch height (px), sign: +1 when the hand is above the holder, hand: where the hand holds (px along the
 *          strip from its top), pin: where the holder's near edge is, L: the free length between them, m: 1 or 2 arches }
 */

export const PERSP = 0.0014;         // how much bigger a lifted part looks, per px of height (the view is from above)
export const EDGE_REACH = 140;       // px: how far past the panel's rim film has curved fully away
export const EDGE_SHRINK = 0.2;      // how much smaller it looks, curved fully away
export const EDGE_DARK = 0.6;        // and how much darker

/* How one arch is shaped. No two bends are alike: each strip has its own lean (the peak sits nearer one end), its own height and a
   faint ripple, set from `bk.seed` (a number 0..1 per strip, kept for the strip's life). The shape is 0 at the hand and at the holder. */
function arch(bk, u) { return u > 0 && u < 1 ? Math.abs(Math.sin(Math.PI * Math.pow(u, bk.g))) : 0; }

/* The bend is a single peak (one wave) lying between the hand and the holder. Its wavelength grows with the distance between them, but it
   is shorter than that distance and sits wherever it likes in it: the film either side of the peak lies flat. t0..t1 is where the peak
   is, as a share of the way from the hand (0) to the holder (1); set each frame from the free length and the strip's own character. */
export function placeBend(bk) {
  const wl = Math.min(1, bk.wl * (0.7 + 0.3 * Math.min(1, bk.L / 500)));        // share of the free length the wave takes
  const half = wl / 2;
  const centre = Math.min(1 - half, Math.max(half, bk.at));
  bk.t0 = centre - half; bk.t1 = centre + half;
}

function shape(bk, t) {
  const u = (t - bk.t0) / (bk.t1 - bk.t0);
  return arch(bk, u) * (1 + bk.rip * Math.sin(2 * Math.PI * u + bk.ph));
}

/* how tall the peak gets for a given slack d: the slack is taken up by the one wave, of length wl (the film's length is kept) */
export function archHeight(d, span) {
  return (2 / Math.PI) * Math.sqrt(d * span);
}

/* set the strip's own bend character from its seed (called once) */
export function seedBend(bk, seed) {
  const r = (k) => { const x = Math.sin(seed * 12.9898 * (k + 1) + k * 78.233) * 43758.5453; return x - Math.floor(x); };
  bk.g = 0.78 + 0.55 * r(1);          // lean of the peak: below 1 it sits toward the holder, above 1 toward the hand
  bk.amp = 0.8 + 0.4 * r(2);          // this strip's own height
  bk.rip = 0.05 + 0.08 * r(3);        // faint ripple on top of the bow
  bk.ph = r(4) * Math.PI * 2;
  bk.at = 0.3 + 0.4 * r(5);           // where in the free length the peak likes to sit
  bk.wl = 0.5 + 0.35 * r(6);          // how much of the free length its wave takes
  bk.t0 = 0; bk.t1 = 1;
}

/* how the slack is spread along the peak: the share of the arc length used up by the film from the start of the wave to u (0..1). It follows
   where the film is steep (its slope squared), so the film lifts and draws in together. Cached per shape. */
function arcTable(bk) {
  const key = `${bk.g}|${bk.rip}|${bk.ph}`;
  if (bk._tabKey === key) return bk._tab;
  const N = 64, tab = new Float32Array(N + 1);
  const f = (u) => arch(bk, u) * (1 + bk.rip * Math.sin(2 * Math.PI * u + bk.ph));
  let acc = 0;
  for (let i = 1; i <= N; i++) {
    const u = (i - 0.5) / N, e = 0.5 / N;
    const sl = (f(Math.min(1, u + e)) - f(Math.max(0, u - e))) / (2 * e);
    acc += sl * sl;
    tab[i] = acc;
  }
  for (let i = 1; i <= N; i++) tab[i] /= acc || 1;
  bk._tabKey = key; bk._tab = tab;
  return tab;
}

/* height z, slope dz (along +y) and lengthwise shift `by` of the film at y (px along the strip from its top). The shift is the
   cumulative arc taken up by the wave, so the film beyond the wave has moved by the whole slack. */
export function profile(bk, y) {
  if (!bk || (bk.a <= 0 && bk.d <= 0) || bk.g === undefined) return { z: 0, by: 0, dz: 0 };
  const t = bk.sign > 0 ? (y - bk.hand) / bk.L : (bk.hand - y) / bk.L;      // 0 at the hand, 1 at the holder
  const span = (bk.t1 - bk.t0) * bk.L;
  let z = 0, dz = 0;
  if (t > bk.t0 && t < bk.t1) {
    z = bk.a * bk.amp * shape(bk, t);
    const e = 0.004;
    dz = (bk.a * bk.amp * (shape(bk, Math.min(bk.t1, t + e)) - shape(bk, Math.max(bk.t0, t - e)))) / (2 * e * bk.L) * (bk.sign > 0 ? 1 : -1);
  }
  let cum = 0;
  if (t >= bk.t1) cum = 1;
  else if (t > bk.t0) { const tab = arcTable(bk), u = ((t - bk.t0) / (bk.t1 - bk.t0)) * (tab.length - 1), i = Math.floor(u); cum = tab[i] + (tab[i + 1] - tab[i]) * (u - i); }
  return { z, by: -bk.sign * bk.d * cum, dz };
}

/* how far film at world point (x, y) has curved away over the rim of the panel (0 on the panel, 1 fully away) */
export function overRim(x, y, W, H, m) {
  const ex = Math.max(m - x, x - (W - m), 0), ey = Math.max(m - y, y - (H - m), 0);
  const d = Math.hypot(ex, ey);
  const t = Math.min(1, d / EDGE_REACH);
  return t * t * (3 - 2 * t);
}
