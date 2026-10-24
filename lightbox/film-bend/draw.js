/* Drawing film that is bent: the slices, the light and shade, the shadow it casts, and where it lifts off the surface.
 *
 * This is the one place that knows how to PAINT a bend. film-bend/physics.js decides the shape (s.bk); shape.js turns it into heights; this file
 * turns heights into pixels. It is used by the page (layers.js: separate canvases in the film's stack) and by both glasses (raster.js drawScene).
 *
 * It needs three things from the renderer that owns it (raster.js), handed over once with bindHost(): drawStrip (a flat strip, which a bent strip
 * is cut into slices from), polyPath (a polygon as a canvas path) and stripQuad (a strip's four corners). Nothing else is imported from it, so the
 * renderer can change without this file noticing, and this file can be lifted out with only those three to supply.
 */

import { EDGE_SHRINK, PERSP, lighting, overRim, profile } from "./shape.js";

let host = null;
export function bindHost(h) { host = h; }                               // { drawStrip, polyPath, stripQuad }
const drawStrip = (...a) => host.drawStrip(...a);
const polyPath = (...a) => host.polyPath(...a);
const stripQuad = (...a) => host.stripQuad(...a);

/* How much a hole in a bent strip still lets the light box shine through (0..1), by how high the film is there (ly px along the strip): film
   lifted off the surface has no board under it to catch the light, so a hole glows less and less as its film rises, and not at all once it is up. */
export function holeFade(s, ly) {
  const z = s.bk && (s.bk.a > 0 || s.bk.d > 0) ? profile(s.bk, ly).z : 0;
  return 1 - Math.min(1, Math.max(0, (z - 0.6) / 1.6));
}

/* The shadow a lifted (bent) strip casts on whatever is below it, as a soft gradient, not a hard shape. Light is from the upper left, so the
 * shadow falls to the lower right, further the higher the film is. Two layers: where the film is low the shadow is close, dark and fairly sharp
 * (contact); where it is high it is far, lighter and very soft. Each layer is drawn small and scaled up, which is what blurs it, so no
 * blur filter is needed. The sprocket holes let light through, so the near layer has gaps in the same pattern.
 * Used by the page (over the film, under the bent strip itself) and by both glasses. ctx is in sheet px. */
const shadowLayers = [];
function shadowLayer(i, W, H, div, x0 = 0, y0 = 0) {
  let L = shadowLayers[i];
  const w = Math.max(2, Math.ceil(W / div)), h = Math.max(2, Math.ceil(H / div));
  if (!L) L = shadowLayers[i] = document.createElement("canvas");
  if (L.width !== w || L.height !== h) { L.width = w; L.height = h; }
  const g = L.getContext("2d");
  g.setTransform(1, 0, 0, 1, 0, 0);
  g.clearRect(0, 0, w, h);
  g.setTransform(1 / div, 0, 0, 1 / div, -x0 / div, -y0 / div);
  return [L, g];
}
export function paintBendShadows(ctx, strips, W, H, x0 = 0, y0 = 0) {
  const bent = strips.filter((s) => s.bk && (s.bk.a >= 0.4 || s.bk.d >= 0.4));
  if (!bent.length) return;
  const [near, gn] = shadowLayer(0, W, H, 4, x0, y0);
  const [far, gf] = shadowLayer(1, W, H, 12, x0, y0);
  for (const s of bent) {
    const bk = s.bk, lo = Math.min(bk.hand, bk.pin), hi = Math.max(bk.hand, bk.pin);
    const c = Math.cos(s.rot), n = Math.sin(s.rot), tx = s.left + s.w / 2 + s.ox, ty = s.top + s.oy;
    // The shadow of the peak is one continuous shape (the silhouette of the lifted film, thrown toward the lower right by its height), not
    // a row of pieces. Each contour of it (where the film is higher than some height) is filled once; stacked, they make the shadow denser
    // where the film is higher or lower, and the scaling-up blurs the steps away.
    const ribbon = (zMin) => {
      const L = [], R = [];
      for (let y = lo; y <= hi + 0.01; y += 1) {
        const p = profile(bk, y);
        if (p.z < zMin) { if (L.length) break; else continue; }
        const ox = p.z * 0.85, oy = p.z * 1.15, yy = y + p.by;
        L.push([tx - (s.w / 2) * c - yy * n + ox, ty - (s.w / 2) * n + yy * c + oy]);
        R.push([tx + (s.w / 2) * c - yy * n + ox, ty + (s.w / 2) * n + yy * c + oy]);
      }
      return L.length > 1 ? [...L, ...R.reverse()] : null;
    };
    const peak = bk.a * bk.amp, lift = Math.min(1, peak / 70);
    const fill = (g, zMin, alpha) => {
      const poly = ribbon(zMin);
      if (!poly) return;
      g.fillStyle = `rgba(30,18,6,${alpha.toFixed(3)})`;
      g.beginPath();
      poly.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y)));
      g.closePath();
      g.fill();
    };
    // near: close and fairly dark where the film is low; far: wide, light and very soft where it is high
    // (kept light: the shadow of thin film is faint, and it lies only under the wave itself)
    fill(gn, 0.6, 0.08 * (1 - 0.5 * lift)); fill(gn, peak * 0.2, 0.06 * (1 - 0.5 * lift)); fill(gn, peak * 0.5, 0.05 * (1 - 0.5 * lift));
    fill(gf, 0.6, 0.04 * lift + 0.015); fill(gf, peak * 0.25, 0.05 * lift); fill(gf, peak * 0.55, 0.06 * lift);
    // light through the sprocket holes
    gn.globalCompositeOperation = "destination-out";
    for (const cell of s.cells) {
      const tile0 = cell.index === 0 ? s.pt : 0;
      for (let y = tile0 - Math.ceil(tile0 / s.hp) * s.hp; y < cell.h; y += s.hp) {
        const hy = cell.top + y + 0.5 * s.hp, pr = profile(bk, hy);
        if (pr.z < 1) continue;
        for (const hx of [-s.w / 2 + 0.37 * s.b, s.w / 2 - 0.37 * s.b]) {
          const wx = tx + hx * c - (hy + pr.by) * n + pr.z * 0.85, wy = ty + hx * n + (hy + pr.by) * c + pr.z * 1.15;
          const rg = gn.createRadialGradient(wx, wy, 0, wx, wy, 0.55 * s.hp);
          rg.addColorStop(0, "rgba(0,0,0,.6)"); rg.addColorStop(1, "rgba(0,0,0,0)");
          gn.fillStyle = rg;
          gn.fillRect(wx - 0.6 * s.hp, wy - 0.6 * s.hp, 1.2 * s.hp, 1.2 * s.hp);
        }
      }
    }
    gn.globalCompositeOperation = "source-over";
  }
  ctx.save();
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(far, x0, y0, W, H);
  ctx.drawImage(near, x0, y0, W, H);
  ctx.restore();
}

/* ---------- bent strips ----------
 * A strip that is bent (lifted into an arch, see film-bend/shape.js) or hangs over the rim of the panel is drawn as thin slices, each slice with its
 * own scale and shift, so the bend is smooth along the film instead of one step per frame. The strip is first drawn flat into a
 * texture (once, redrawn only when its pictures change), then the slices are cut from it. Slices lit from the upper left are
 * brighter, slices facing away darker, and slices curving away over the rim darker and smaller. */
const BENT_MARGIN_Y = 130, BENT_MARGIN_X = 0.2;

/* The strip drawn flat and straight, alone, once per look ("opaque", "alpha" = see-through by density, "mult" = to be multiplied onto what is below),
 * in a canvas of its own: what a bent strip is cut into slices from. Redrawn only when its pictures change. */
const texCache = new WeakMap();
function flatTexture(scene, s, mode, kk, variant = "opaque") {
  const sig = s.cells.map((c) => (c.frame.neg ? 1 : 0) + (c.frame.hi ? 2 : 0)).join("");
  const key = `${kk}|${sig}`;
  let t = texCache.get(s);
  if (!t) texCache.set(s, (t = {}));
  const e = t[mode + variant];
  if (e && e.key === key) return e.canvas;
  const cv = e?.canvas ?? document.createElement("canvas");
  cv.width = Math.ceil(s.w * kk); cv.height = Math.ceil(s.h * kk);
  const g = cv.getContext("2d");
  g.clearRect(0, 0, cv.width, cv.height);
  const saved = { ox: s.ox, oy: s.oy, rot: s.rot, over: s.over, cells: s.cells.map((c) => [c.x, c.dy, c.ang, c.k]), ds: scene.drawScale };
  s.ox = -s.left; s.oy = -s.top; s.rot = 0; s.over = [];
  s.cells.forEach((c) => { c.x = 0; c.dy = 0; c.ang = 0; c.k = 1; });
  g.setTransform(kk, 0, 0, kk, 0, 0);
  scene.drawScale = kk;
  drawStrip(g, scene, s, mode, null, variant);
  s.ox = saved.ox; s.oy = saved.oy; s.rot = saved.rot; s.over = saved.over;
  s.cells.forEach((c, i) => { [c.x, c.dy, c.ang, c.k] = saved.cells[i]; });
  scene.drawScale = saved.ds;
  t[mode + variant] = { canvas: cv, key };
  return cv;
}

/* Where each slice of a bent strip goes, and the light that falls on it. The strip is cut into slices half a pixel of film thick; each is moved
   lengthwise by the film's arc shift and scaled by how high it is (and by how far it has curved away over the panel's rim). */
function bentGeometry(scene, s) {
  const bk = s.bk;
  const SLICE = 0.5;                                                        // each slice is half a pixel of film: far finer than the eye can pick out
  const flatStrip = bk.a <= 0 && bk.d <= 0;
  const N = flatStrip ? 1 : Math.min(3600, Math.max(40, Math.ceil(s.h / SLICE)));     // (a strip drawn here only for its overlaps is flat: one slice)
  const mx = s.w * BENT_MARGIN_X, W = s.w + 2 * mx, H = s.h + 2 * BENT_MARGIN_Y;
  const topX = s.left + s.w / 2 + s.ox, topY = s.top + s.oy, ce = Math.cos(s.rot), se = Math.sin(s.rot);
  const edge = scene.edge, edgeK = scene.bendEdge ?? 1;
  const oAt = (y) => {
    // TEST (commented out, not deleted): film over the panel's rim no longer curves away (smaller and darker). Put this back to restore it.
    // if (!edge || edgeK <= 0) return 0;
    // const wx = topX - y * se, wy = topY + y * ce;                       // the point y along the strip, on the sheet
    // return Math.min(1, overRim(wx, wy, scene.W, scene.H, edge.m) * edgeK);
    return 0;
  };
  const sl = [], dark = [], light = [], gloss = [];
  let yTop = Infinity, yBot = -Infinity;
  for (let j = 0; j < N; j++) {
    const y0 = (s.h * j) / N, y1 = (s.h * (j + 1)) / N, yc = (y0 + y1) / 2;
    const p0 = profile(bk, y0), p1 = profile(bk, y1), pc = profile(bk, yc);
    const o = oAt(yc + pc.by);
    const kx = (1 + PERSP * pc.z) * (1 - EDGE_SHRINK * o);
    const dy0 = y0 + p0.by, dy1 = y1 + p1.by;
    sl.push([y0, y1, mx + (s.w * (1 - kx)) / 2, BENT_MARGIN_Y + dy0, s.w * kx, dy1 - dy0 + 0.7]);
    // Light from the upper left. Film is glossy, so a bend shows three things, each a smooth gradient along the strip (no seams):
    //  - the side of the arch that faces the light is a little brighter, the side that faces away clearly darker;
    //  - a narrow specular sheen where the surface mirrors the light toward the eye (a soft white band, the glint on a glossy surface);
    //  - film curving away over the rim of the panel darker still.
    const L = lighting(pc.dz, pc.z, o);
    const at = BENT_MARGIN_Y + (dy0 + dy1) / 2;
    dark.push([at, L.dark]); light.push([at, L.diff]); gloss.push([at, L.spec]);
    yTop = Math.min(yTop, BENT_MARGIN_Y + dy0); yBot = Math.max(yBot, BENT_MARGIN_Y + dy1);
  }
  // Blend each lighting curve into itself over a short distance either side, so where the peak begins and ends the highlight and the shadow
  // fade out gently into the flat film instead of stopping.
  const soften = (stops) => {
    const K = [1, 2, 3, 4, 3, 2, 1], ks = 16, n = stops.length, st = Math.max(1, Math.round(8 / (s.h / N)));      // (taps spaced so the blend still spans the same length of film)
    for (let pass = 0; pass < 2; pass++) {
      const v = stops.map(([, a]) => a);
      for (let i = 0; i < n; i++) {
        let acc = 0;
        for (let k = -3; k <= 3; k++) acc += K[k + 3] * (v[Math.min(n - 1, Math.max(0, i + k * st))] ?? 0);
        stops[i][1] = acc / ks;
      }
    }
  };
  soften(dark); soften(light); soften(gloss);
  return { sl, dark, light, gloss, yTop, yBot, mx, W, H, topX, topY };
}

const scratchCache = new WeakMap();
function scratchCanvas(s, name, pw, ph) {
  let set = scratchCache.get(s);
  if (!set) scratchCache.set(s, (set = {}));
  const c = set[name] ?? (set[name] = document.createElement("canvas"));
  if (c.width !== pw || c.height !== ph) { c.width = pw; c.height = ph; }
  const g = c.getContext("2d");
  g.setTransform(1, 0, 0, 1, 0, 0);
  g.clearRect(0, 0, pw, ph);
  return [c, g];
}

/* the strip in one look, cut into slices and set where the bend puts them: a canvas in a box round the strip (its own coordinates) */
function bentLook(scene, s, mode, kk, variant, geo, name = null) {
  const pw = Math.ceil(geo.W * kk), ph = Math.ceil(geo.H * kk);
  const [c, g] = scratchCanvas(s, name ?? mode + variant, pw, ph);
  const tex = flatTexture(scene, s, mode, kk, variant);
  g.setTransform(kk, 0, 0, kk, 0, 0);
  g.imageSmoothingEnabled = true;
  for (const [y0, y1, dx, dy, w, h] of geo.sl) g.drawImage(tex, 0, y0 * kk, tex.width, (y1 - y0) * kk + 0.5, dx, dy, w, h);
  return { sc: c, pw, ph };
}

/* The light and shade on the bend, as an overlay of its own, laid over the strip and whatever shows through it, never baked into the film's own
   layers: the shading belongs to the surface of the film, so what lies under the film cannot show through it. It follows the strip's outline
   (so the sprocket holes stay open), and each layer is a smooth gradient along the strip. */
function bentShade(scene, s, mode, kk, geo) {
  const pw = Math.ceil(geo.W * kk), ph = Math.ceil(geo.H * kk);
  const look = bentLook(scene, s, mode, kk, "opaque", geo, mode + "sil");              // the outline
  const [out, og] = scratchCanvas(s, mode + "shade", pw, ph);
  const [tmp, tg] = scratchCanvas(s, mode + "tmp", pw, ph);
  const layer = (stops, rgb) => {
    if (!stops.some(([, a]) => a > 0.004) || geo.yBot <= geo.yTop) return;
    tg.setTransform(1, 0, 0, 1, 0, 0);
    tg.globalCompositeOperation = "source-over";
    tg.clearRect(0, 0, pw, ph);
    tg.drawImage(look.sc, 0, 0);
    const gr = tg.createLinearGradient(0, geo.yTop * kk, 0, geo.yBot * kk);
    for (const [at, a] of stops) gr.addColorStop(Math.min(1, Math.max(0, (at - geo.yTop) / (geo.yBot - geo.yTop))), `rgba(${rgb},${a.toFixed(3)})`);
    tg.globalCompositeOperation = "source-in";
    tg.fillStyle = gr;
    tg.fillRect(0, 0, pw, ph);
    og.drawImage(tmp, 0, 0);
  };
  layer(geo.dark, "14,8,2");
  layer(geo.light, "255,244,222");
  layer(geo.gloss, "255,253,248");
  return { sc: out, pw, ph };
}

/* Draw strip s bent, onto ctx (in sheet px). kk: pixels per sheet px of the context's target (for the picture's sharpness). Where the strip lies over
   another one it is see-through by density, or multiplied onto it, just as a flat strip is (see drawScene); elsewhere it is opaque, so every slice
   shows the film beneath it exactly as flat film does, and one that comes down to the ground looks like flat film at once. On the page the strip goes
   into separate canvases (parts: opaque, alpha, mult, shade), because a multiply has to happen against the film beneath, which lies in the page and not
   in the canvas: the page blends the `mult` canvas by multiplying and fades the `alpha` one. In the glasses everything is drawn into one canvas. The
   light and shade (`shade`) always go over all of it. */
export function drawBentStrip(ctx, scene, s, mode, kk, parts = null) {
  kk = Math.min(kk || 1, 2.5);
  const geo = bentGeometry(scene, s);
  const blit = (c, b) => {
    c.save();
    c.translate(geo.topX, geo.topY);
    c.rotate(s.rot);
    c.drawImage(b.sc, 0, 0, b.pw, b.ph, -s.w / 2 - geo.mx, -BENT_MARGIN_Y, geo.W, geo.H);
    c.restore();
  };
  const outsideOver = (c) => { c.beginPath(); c.rect(-1e5, -1e5, 2e5, 2e5); s.over.forEach((p) => polyPath(c, p)); c.clip("evenodd"); };
  const insideOver = (c) => { c.beginPath(); s.over.forEach((p) => polyPath(c, p)); c.clip(); };
  const look = (v) => bentLook(scene, s, mode, kk, v, geo);
  if (!s.over.length) blit(parts ? parts.opaque : ctx, look("opaque"));
  else {
    const m = mode === "pos" ? 0 : scene.stack;
    const o = parts ? parts.opaque : ctx;
    o.save(); outsideOver(o); blit(o, look("opaque")); o.restore();
    if (m < 1) {
      const c = parts ? parts.alpha : ctx;
      c.save(); insideOver(c);
      if (!parts) c.globalAlpha = 1 - m;
      blit(c, look("alpha"));
      c.restore();
    }
    if (m > 0) {
      const c = parts ? parts.mult : ctx;
      c.save(); insideOver(c);
      if (!parts) { c.globalCompositeOperation = "multiply"; c.globalAlpha = m; }
      blit(c, look("mult"));
      c.restore();
    }
  }
  blit(parts ? parts.shade : ctx, bentShade(scene, s, mode, kk, geo));
}

/* where a bent strip and its shadow can reach, as a box in sheet px: {x, y, w, h} */
export function bentBounds(s, margin = 170) {
  const q = stripQuad(s), xs = q.map((p) => p[0]), ys = q.map((p) => p[1]);
  const x = Math.min(...xs) - margin, y = Math.min(...ys) - margin;
  return { x, y, w: Math.max(...xs) + margin - x, h: Math.max(...ys) + margin - y };
}

/* The parts of a bent strip that are lifted off the surface (higher than minZ px), as one polygon per unbroken run along the strip, in sheet px
   ({poly, z}, z = the highest it gets). Light that seeps onto the film's edge only does so where the film lies on the light box; these runs are
   cut out of it (softly: bleed.js blurs the cut). One polygon per run, so there are no seams where pieces would meet. */
export function liftedPatches(s, minZ = 0.6, step = 3) {
  const out = [];
  if (!s.bk || (s.bk.a <= 0 && s.bk.d <= 0)) return out;
  const bk = s.bk, top = [s.left + s.w / 2 + s.ox, s.top + s.oy], c = Math.cos(s.rot), n = Math.sin(s.rot);
  const lo = Math.min(bk.hand, bk.pin), hi = Math.max(bk.hand, bk.pin);
  const mx = s.w * 0.12;
  const toWorld = ([x, yy]) => [top[0] + x * c - yy * n, top[1] + x * n + yy * c];
  let L = [], R = [], zmax = 0;
  const flush = () => { if (L.length > 1) out.push({ poly: [...L, ...R.reverse()].map(toWorld), z: zmax }); L = []; R = []; zmax = 0; };
  for (let y = lo; y <= hi + 0.01; y += step) {
    const p = profile(bk, y);
    if (p.z < minZ) { flush(); continue; }
    const yy = y + p.by;
    L.push([-s.w / 2 - mx, yy]); R.push([s.w / 2 + mx, yy]);
    if (p.z > zmax) zmax = p.z;
  }
  flush();
  return out;
}
