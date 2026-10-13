/* Draws the contact sheet onto 2D canvases for the glass shaders.
 *
 *   readScene(stage, root)        reads the laid-out DOM sheet into a plain description
 *   warmNegatives(scene, rs)      bakes every photo as a negative once, up front
 *   createNegView / createLensView
 *                                 small windows onto the sheet, redrawn every frame around the
 *                                 eyepiece: the negative sheet for the outer glass, and the lit
 *                                 positive sheet, magnified, for the inner glass
 *
 * Each strip is a chain of cells (one per frame). A cell can be shifted and tilted a little against
 * its neighbours, which is how the film bends and flutters. film.js sets those values and the DOM
 * and these canvases both read them, so the three always agree.
 *
 * Geometry is read back from the DOM, so it stays in step with lightbox.css.
 */

import { paintHoles } from "./bleed.js";
import { paintSocketButton } from "./socket-buttons/buttons.js";

const ORANGE = [217 / 255, 132 / 255, 58 / 255]; // film-mask cast, matches .lb-neg .lb-img::after
const ORANGE_MIX = 0.55;

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);

/* Film is slightly transparent, by how much light registered. Dense (dark) parts of the negative, which are
 * where the original photo was bright, let little through; clear (bright) parts of the negative, where the
 * original was darkest, let the most through. The sprocket borders are almost fully dense. This only shows
 * where one strip lies over another; against the bare board the film stays opaque.
 *
 * `alpha` is how much of the upper strip remains visible at a pixel whose negative has this brightness. */
export const FILM_DENSE = 0.93;       // alpha of a fully dark pixel
export const FILM_CLEAR = 0.3;        // alpha of the brightest pixels of a negative
export const FILM_LUM_REF = 0.7;      // negative brightness that counts as fully clear
export const filmAlpha = (lum) => FILM_DENSE - ((FILM_DENSE - FILM_CLEAR) * Math.min(1, lum / FILM_LUM_REF));
const BASE_ALPHA = filmAlpha(0.1);    // the film base and borders (about #1b1917), seen as a negative
const BASE_ALPHA_POS = 0.5;           // ...and seen through the eyepiece as a positive: dark film is the most see-through there
const TAG_ALPHA = 0.75;               // printed edge text, relative to the film

/* ---------- the light panel ----------
 * A real light box is not perfectly even: it falls off toward the edges and has faint patchy zones. The film
 * is lit by that panel, so the panel scales the light that reaches the board and the film together. It is
 * applied multiplicatively (never painted over), so black film stays black. One definition is used by the
 * page (CSS gradients) and by both glasses (canvas gradients), so they always agree.
 * Each layer is a soft ellipse of darkening: centre and radii as fractions of the sheet, and [position, alpha]
 * stops. `fall` scales the whole effect (0 = a perfectly even panel). */
const PANEL_INK = "40,28,8";
const PANEL_LAYERS = [
  { cx: 0.5, cy: 0.42, rx: 0.95, ry: 0.85, stops: [[0.4, 0], [1, 0.34]] },      // falloff toward the edges and corners
  { cx: 0.12, cy: 0.3, rx: 0.4, ry: 0.55, stops: [[0, 0.06], [1, 0]] },         // a slightly dimmer zone
  { cx: 0.88, cy: 0.78, rx: 0.36, ry: 0.5, stops: [[0, 0.05], [1, 0]] },
];

/* The brighter patches and the faint warm / cool drift across the panel. They raise the light by a proportional
 * gain (color-dodge: the gain is 1 / (1 - colour), so a dark pixel gets only a little brighter in absolute terms
 * and pure black stays black), which is what a brighter patch of panel does to the film in front of it.
 * `glow` scales them (0 = none). */
const PANEL_GLOW = [
  { cx: 0.5, cy: 0.5, rx: 1.2, ry: 1.2, color: "255,243,218", stops: [[0, 0.11], [1, 0.11]] },      // the whole panel burning brighter
  { cx: 0.34, cy: 0.34, rx: 0.34, ry: 0.42, color: "70,70,66", stops: [[0, 0.14], [1, 0]] },   // a brighter patch
  { cx: 0.72, cy: 0.58, rx: 0.38, ry: 0.46, color: "70,70,66", stops: [[0, 0.11], [1, 0]] },
  { cx: 0.5, cy: 0.95, rx: 0.5, ry: 0.22, color: "70,70,66", stops: [[0, 0.09], [1, 0]] },
  { cx: 0.18, cy: 0.82, rx: 0.42, ry: 0.4, color: "60,22,0", stops: [[0, 0.22], [1, 0]] },     // warm drift
  { cx: 0.86, cy: 0.18, rx: 0.42, ry: 0.4, color: "0,22,64", stops: [[0, 0.2], [1, 0]] },      // cool drift
];

const gradientCss = (l, ink, k) =>
  `radial-gradient(ellipse ${l.rx * 100}% ${l.ry * 100}% at ${l.cx * 100}% ${l.cy * 100}%, ` +
  l.stops.map(([o, a]) => `rgba(${ink},${(a * k).toFixed(4)}) ${o * 100}%`).join(", ") + ")";

/* the darkening layers, as a CSS background */
export function panelBackground(fall) {
  return PANEL_LAYERS.map((l) => gradientCss(l, PANEL_INK, fall)).join(", ");
}
/* the glow layers, as a CSS background (shown with mix-blend-mode: color-dodge) */
export function panelGlowBackground(glow) {
  return PANEL_GLOW.map((l) => gradientCss(l, l.color, glow)).join(", ");
}

function paintLayers(ctx, W, H, layers, inkOf, k) {
  for (const l of layers) {
    ctx.save();
    ctx.translate(l.cx * W, l.cy * H);
    ctx.scale(l.rx * W, l.ry * H);
    const g = ctx.createRadialGradient(0, 0, 0, 0, 0, 1);
    for (const [o, a] of l.stops) g.addColorStop(o, `rgba(${inkOf(l)},${(a * k).toFixed(4)})`);
    ctx.fillStyle = g;
    ctx.fillRect(-l.cx / l.rx, -l.cy / l.ry, 1 / l.rx, 1 / l.ry);
    ctx.restore();
  }
}

/* The falloff and the glow only change when a slider moves or the sheet is resized, never while things slide
 * over them. So each is baked once into a cached layer (half resolution: they are smooth gradients) and every
 * frame only draws the part of it that is in view. Painting the gradients afresh each frame cost more than
 * everything else in the frame put together. */
const PANEL_SCALE = 0.5;
const panelCache = new WeakMap();

function bakeLayer(W, H, layers, inkOf, k) {
  const c = document.createElement("canvas");
  c.width = Math.max(1, Math.round(W * PANEL_SCALE));
  c.height = Math.max(1, Math.round(H * PANEL_SCALE));
  const t = c.getContext("2d");
  t.scale(PANEL_SCALE, PANEL_SCALE);
  paintLayers(t, W, H, layers, inkOf, k);
  return c;
}

function paintPanel(ctx, scene) {
  const { W, H, fall, glow } = scene;
  let c = panelCache.get(scene);
  if (!c || c.W !== W || c.H !== H || c.fall !== fall || c.glow !== glow) {
    c = {
      W, H, fall, glow,
      fallLayer: fall > 0 ? bakeLayer(W, H, PANEL_LAYERS, () => PANEL_INK, fall) : null,
      glowLayer: glow > 0 ? bakeLayer(W, H, PANEL_GLOW, (l) => l.color, glow) : null,
    };
    panelCache.set(scene, c);
  }
  if (c.fallLayer) {
    ctx.save();
    ctx.globalCompositeOperation = "multiply";
    ctx.drawImage(c.fallLayer, 0, 0, W, H);
    ctx.restore();
  }
  if (c.glowLayer) {
    ctx.save();
    ctx.globalCompositeOperation = "color-dodge";
    ctx.drawImage(c.glowLayer, 0, 0, W, H);
    ctx.restore();
  }
}

/* ---------- the panel's matte grain ----------
 * A frosted diffuser has a fine micro-texture that scatters the light, which is what makes a light box's glow
 * even. It belongs to the panel, so it stays put while film slides over it, and it magnifies in the lens. It
 * modulates the light multiplicatively (like the panel falloff), so it shows on the board and through clear
 * film and barely at all on the dark borders. One seamless tile feeds the page (a CSS background) and both
 * glasses (a canvas pattern). `grain` scales it (0 = a perfectly smooth panel). */
export const GRAIN_TILE = 256;       // css px per tile
const GRAIN_RES = 2;                 // tile pixels per css px: grain finer than a pixel on a standard screen
export const GRAIN_MAX = 0.16;       // darkest speck, as a fraction of the light, at grain = 2
let grainTile = null;

export function grainCanvas() {
  if (grainTile) return grainTile;
  const n = GRAIN_TILE * GRAIN_RES;
  let seed = 0x9e3779b9;
  const rnd = () => { seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  const raw = new Float32Array(n * n);
  for (let i = 0; i < raw.length; i++) raw[i] = rnd();
  // wrap-around box blur, so the tile repeats without a seam
  const blur = (src, r) => {
    const tmp = new Float32Array(n * n), out = new Float32Array(n * n), k = 2 * r + 1;
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) { let a = 0; for (let d = -r; d <= r; d++) a += src[y * n + ((x + d + n) % n)]; tmp[y * n + x] = a / k; }
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) { let a = 0; for (let d = -r; d <= r; d++) a += tmp[((y + d + n) % n) * n + x]; out[y * n + x] = a / k; }
    return out;
  };
  const soft = blur(raw, 2);            // clumps a couple of pixels across
  let lo = 1, hi = 0;
  for (let i = 0; i < soft.length; i++) { lo = Math.min(lo, soft[i]); hi = Math.max(hi, soft[i]); }
  const c = document.createElement("canvas");
  c.width = c.height = n;
  const t = c.getContext("2d");
  const img = t.createImageData(n, n);
  for (let i = 0; i < n * n; i++) {
    // fine speckle plus softer clumps, stretched to 0..1, then bent so only some specks are strong
    const clump = (soft[i] - lo) / (hi - lo || 1);
    let v = Math.pow(0.55 * raw[i] + 0.45 * clump, 1.5);
    v = Math.min(1, v * 1.35);
    const g = Math.round(255 * (1 - GRAIN_MAX * v));      // 255 = no effect, darker = a speck that scatters light away
    img.data[i * 4] = img.data[i * 4 + 1] = img.data[i * 4 + 2] = g;
    img.data[i * 4 + 3] = 255;
  }
  t.putImageData(img, 0, 0);
  grainTile = c;
  return c;
}

const grainPatterns = new WeakMap();
function paintGrain(ctx, W, H, grain) {
  if (grain <= 0) return;
  let pat = grainPatterns.get(ctx);
  if (!pat) { pat = ctx.createPattern(grainCanvas(), "repeat"); grainPatterns.set(ctx, pat); }
  ctx.save();
  ctx.globalCompositeOperation = "multiply";
  ctx.globalAlpha = Math.min(1, grain / 2);
  ctx.scale(1 / GRAIN_RES, 1 / GRAIN_RES);
  ctx.fillStyle = pat;
  ctx.fillRect(0, 0, W * GRAIN_RES, H * GRAIN_RES);
  ctx.restore();
}

/* ---------- the page's overlay layers ----------
 * The panel's falloff, its matte grain and the dust all darken the light the same way (multiply), so the page draws
 * them together onto ONE canvas instead of three separate full-size layers. That is a third of the memory for the
 * same picture, which is what a slower device runs out of first. The glow works differently (it brightens), so it
 * stays its own layer, but it is smooth, so it is drawn at a quarter of the resolution and stretched. */
export function paintOverlay(ctx, W, H, { fall, grain }) {
  ctx.save();
  ctx.globalCompositeOperation = "source-over";
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, W, H);                                    // white: multiplying by white changes nothing
  if (fall > 0) { ctx.globalCompositeOperation = "multiply"; paintLayers(ctx, W, H, PANEL_LAYERS, () => PANEL_INK, fall); }
  ctx.restore();
  paintGrain(ctx, W, H, grain);
}

/* The dark room around the lit panel, the fall of its light toward the rim, and the highlight where the rim curves away, baked once
 * as a picture of the whole sheet. The page shows this picture over the sheet and the glasses draw the same one, so they always
 * agree. From the inside out: the lit surface, a fall to dark (a warm brown glow, then a dark one), a thin soft highlight where the
 * edge turns over, then the dark room. m: the dark margin, f: how far the light falls off inside the rim, blur: how frosted the fall
 * is, all in css px. */
export function bakeEdge(W, H, m, f, blur, S = 1) {
  const P = 40;                                            // spare room round the picture so the blur has something to blur
  const w = Math.ceil((W + 2 * P) * S), h = Math.ceil((H + 2 * P) * S);
  const c = document.createElement("canvas");
  c.width = w; c.height = h;
  const g = c.getContext("2d");
  g.scale(S, S);
  g.translate(P, P);
  const rrPath = (ctx, inset) => {                         // the panel: its rounded rectangle, shrunk by `inset`
    const x = m + inset, y = m + inset, ww = W - 2 * (m + inset), hh = H - 2 * (m + inset);
    const r = Math.max(0, f * 0.9 - inset);
    ctx.moveTo(x + r, y); ctx.arcTo(x + ww, y, x + ww, y + hh, r); ctx.arcTo(x + ww, y + hh, x, y + hh, r); ctx.arcTo(x, y + hh, x, y, r); ctx.arcTo(x, y, x + ww, y, r); ctx.closePath();
  };
  const big = () => g.rect(-P - 200, -P - 200, W + 2 * P + 400, H + 2 * P + 400);
  // the dark room, outside the panel
  g.beginPath(); big(); rrPath(g, 0); g.fillStyle = "#120c08"; g.fill("evenodd");
  // two inset glows inside the rim: a warm brown one, then a dark one
  for (const [colour, blurK, spreadK] of [["rgba(84,52,24,.5)", 0.9, 0.05], ["rgba(20,12,6,.9)", 0.95, 0.12]]) {
    g.save();
    g.beginPath(); rrPath(g, 0); g.clip();
    g.shadowColor = colour; g.shadowBlur = f * blurK * S; g.shadowOffsetX = 0; g.shadowOffsetY = 0;
    g.beginPath(); big(); rrPath(g, f * spreadK); g.fillStyle = colour; g.fill("evenodd");
    g.restore();
  }
  // frost the fall and the edge of the room, then cut away the spare room
  const out = document.createElement("canvas");
  out.width = Math.ceil(W * S); out.height = Math.ceil(H * S);
  const o = out.getContext("2d");
  o.filter = `blur(${blur * S}px)`;
  o.drawImage(c, -P * S, -P * S);
  o.filter = "none";
  // Reading the rim from the dark room inward: the dark room; a faint warm glow just outside the edge; the edge itself, softened; a
  // narrow highlight where the edge bends, with a little glow so the light seems to be inside the box; the dark gradient above; then the
  // lit surface. The edge and highlight are brightest toward the light (the upper left). (The dark fall is drawn above.)
  const hl = document.createElement("canvas");
  hl.width = out.width; hl.height = out.height;
  const hc = hl.getContext("2d");
  const grad = hc.createLinearGradient(0, 0, out.width, out.height);
  grad.addColorStop(0, "rgba(232,206,166,1)"); grad.addColorStop(.55, "rgba(232,206,166,.5)"); grad.addColorStop(1, "rgba(232,206,166,.75)");
  hc.scale(S, S);
  const layer = (inset, lw, alpha, blurPx, style = grad) => {
    hc.filter = blurPx > 0 ? `blur(${blurPx * S}px)` : "none";
    hc.globalAlpha = alpha; hc.lineWidth = lw; hc.strokeStyle = style;
    hc.beginPath(); rrPath(hc, inset); hc.stroke();
  };
  layer(-4, 7, 0.2, 5, "rgba(170,128,84,1)");   // the glow just outside the edge
  layer(2.5, 16, 0.11, 5);                        // the wide, faint fall-off of the light, fading out both ways
  layer(2.5, 7, 0.18, 2.6);                       // a nearer, brighter band of it
  layer(2.4, 1.6, 0.34, 1);                       // the highlight itself: narrow at its core, with the fade round it
  hc.filter = "none"; hc.globalAlpha = 1;
  o.drawImage(hl, 0, 0);
  return out;
}

export function paintGlowLayer(canvas, W, H, glow, scale = 0.25) {
  canvas.width = Math.max(1, Math.round(W * scale));
  canvas.height = Math.max(1, Math.round(H * scale));
  const c = canvas.getContext("2d");
  c.clearRect(0, 0, canvas.width, canvas.height);
  if (glow <= 0) return;
  c.scale(scale, scale);
  paintLayers(c, W, H, PANEL_GLOW, (l) => l.color, glow);
}

export function parseColor(str) {
  const c = document.createElement("canvas");
  c.width = c.height = 1;
  const t = c.getContext("2d", { willReadFrequently: true });
  t.fillStyle = str;
  t.fillRect(0, 0, 1, 1);
  const d = t.getImageData(0, 0, 1, 1).data;
  return [d[0], d[1], d[2]];
}

/* the same rule as an SVG filter: sets each pixel's alpha from its brightness, keeping holes see-through */
export function buildFilmFilter(id, boardRgb = [221, 208, 182]) {
  const NS = "http://www.w3.org/2000/svg";
  const k = (FILM_DENSE - FILM_CLEAR) / FILM_LUM_REF;
  const svg = document.createElementNS(NS, "svg");
  svg.setAttribute("width", "0"); svg.setAttribute("height", "0");
  svg.setAttribute("aria-hidden", "true");
  svg.style.cssText = "position:absolute;width:0;height:0;overflow:hidden";
  svg.innerHTML = `<defs><filter id="${id}" color-interpolation-filters="sRGB" x="0" y="0" width="100%" height="100%">
    <feColorMatrix in="SourceGraphic" type="matrix" result="m"
      values="1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  ${(-k * 0.2126).toFixed(4)} ${(-k * 0.7152).toFixed(4)} ${(-k * 0.0722).toFixed(4)} 0 ${FILM_DENSE}"/>
    <feComposite in="m" in2="SourceAlpha" operator="in"/>
  </filter>
  <filter id="${id}-mult" color-interpolation-filters="sRGB" x="0" y="0" width="100%" height="100%">
    <feColorMatrix in="SourceGraphic" type="matrix"
      values="${(255 / boardRgb[0]).toFixed(4)} 0 0 0 0  0 ${(255 / boardRgb[1]).toFixed(4)} 0 0 0  0 0 ${(255 / boardRgb[2]).toFixed(4)} 0 0  0 0 0 1 0"/>
  </filter></defs>`;
  return svg;
}

/* the picture frames of every strip, as four-corner outlines in sheet px (the same transform as stripQuad) */
export function frameQuads(s) {
  const tx = s.left + s.w / 2 + s.ox, ty = s.top + s.oy;
  const c = Math.cos(s.rot), n = Math.sin(s.rot);
  return s.cells.map((cell) => {
    const x0 = cell.frame.x - s.w / 2 + cell.x, y0 = cell.top + cell.dy + cell.frame.y;
    return [[x0, y0], [x0 + s.fw, y0], [x0 + s.fw, y0 + s.fh], [x0, y0 + s.fh]].map(([x, y]) => [tx + x * c - y * n, ty + x * n + y * c]);
  });
}

/* A steady pseudo-random number in 0..1 from a few whole numbers: the same inputs always give the same answer, so
 * anything chosen with it does not flicker or change when the page is redrawn. */
const hash01 = (a, b, c) => {
  let h = (Math.imul(a + 1, 374761393) ^ Math.imul(b + 1, 668265263) ^ Math.imul(c + 1, 2147483647)) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177) >>> 0;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
};

/* The sprocket holes of every strip that the light box shines through brightly: for each strip (index si), a row of
 * holes down each side makes one "set" per frame and side (the four holes beside one picture). A light box is not
 * perfectly even, so only some sets glow, each by a different amount. Each hole is {x, y, rx, ry, k} in sheet px:
 * its centre, its half-size, the strip's tilt, which strip it is in and how brightly it lets light through. */
export function holeSpots(strips) {
  const out = [];
  strips.forEach((s, si) => {
    const tx = s.left + s.w / 2 + s.ox, ty = s.top + s.oy;
    const cs = Math.cos(s.rot), sn = Math.sin(s.rot);
    for (const c of s.cells) {
      for (let side = 0; side < 2; side++) {
        const r = hash01(si, c.index, side);
        if (r > 0.5) continue;                                   // about half of the sets stay dim
        const k = 0.35 + 0.65 * (r / 0.5);                       // the others glow by different amounts
        const lx = (side ? s.w - s.b + 0.63 * s.b : 0.37 * s.b) + c.x - s.w / 2;
        const tile0 = c.index === 0 ? s.pt : 0;
        for (let y = tile0 - Math.ceil(tile0 / s.hp) * s.hp; y < c.h; y += s.hp) {
          const ly = c.top + c.dy + y + 0.5 * s.hp;
          if (ly < c.top || ly > c.top + c.h - 6) continue;      // a hole belongs to the cell it starts in
          out.push({ x: tx + lx * cs - ly * sn, y: ty + lx * sn + ly * cs, rx: 0.23 * s.b, ry: 0.24 * s.hp, rot: s.rot, si, k });
        }
      }
    }
  });
  return out;
}

/* a strip's four corners in sheet px, clockwise: top-left, top-right, bottom-right, bottom-left */
export function stripQuad(s) {
  const tx = s.left + s.w / 2 + s.ox, ty = s.top + s.oy;
  const c = Math.cos(s.rot), n = Math.sin(s.rot);
  return [[-s.w / 2, 0], [s.w / 2, 0], [s.w / 2, s.h], [-s.w / 2, s.h]].map(([x, y]) => [tx + x * c - y * n, ty + x * n + y * c]);
}

/* Same chain as the CSS: invert, contrast .82, brightness .82, saturate .8, orange multiply. */
function toNegative(data) {
  for (let i = 0; i < data.length; i += 4) {
    let r = 1 - data[i] / 255, g = 1 - data[i + 1] / 255, b = 1 - data[i + 2] / 255;
    r = clamp01((r - 0.5) * 0.82 + 0.5); g = clamp01((g - 0.5) * 0.82 + 0.5); b = clamp01((b - 0.5) * 0.82 + 0.5);
    r = clamp01(r * 0.82); g = clamp01(g * 0.82); b = clamp01(b * 0.82);
    const l = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    r = clamp01(l + 0.8 * (r - l)); g = clamp01(l + 0.8 * (g - l)); b = clamp01(l + 0.8 * (b - l));
    data[i] = 255 * r * (1 - ORANGE_MIX * (1 - ORANGE[0]));
    data[i + 1] = 255 * g * (1 - ORANGE_MIX * (1 - ORANGE[1]));
    data[i + 2] = 255 * b * (1 - ORANGE_MIX * (1 - ORANGE[2]));
  }
}

/* rounded rect with elliptical corners (the sprocket holes are stretched, like the CSS mask) */
function ellipticRect(ctx, x, y, w, h, rx, ry) {
  ctx.moveTo(x + rx, y);
  ctx.lineTo(x + w - rx, y);
  ctx.ellipse(x + w - rx, y + ry, rx, ry, 0, -Math.PI / 2, 0);
  ctx.lineTo(x + w, y + h - ry);
  ctx.ellipse(x + w - rx, y + h - ry, rx, ry, 0, 0, Math.PI / 2);
  ctx.lineTo(x + rx, y + h);
  ctx.ellipse(x + rx, y + h - ry, rx, ry, 0, Math.PI / 2, Math.PI);
  ctx.lineTo(x, y + ry);
  ctx.ellipse(x + rx, y + ry, rx, ry, 0, Math.PI, Math.PI * 1.5);
  ctx.closePath();
}

/* object-fit: cover source rectangle */
function coverCrop(img, w, h) {
  const k = Math.max(w / img.naturalWidth, h / img.naturalHeight);
  const sw = w / k, sh = h / k;
  return [(img.naturalWidth - sw) / 2, (img.naturalHeight - sh) / 2, sw, sh];
}

/* a frame's photo as a negative, sized for the given raster scale */
function negativePhoto(img, w, h, rs) {
  const pw = Math.max(1, Math.round(w * rs)), ph = Math.max(1, Math.round(h * rs));
  const tmp = document.createElement("canvas");
  tmp.width = pw; tmp.height = ph;
  const t = tmp.getContext("2d", { willReadFrequently: true });
  t.drawImage(img, ...coverCrop(img, pw, ph), 0, 0, pw, ph);
  try {
    const d = t.getImageData(0, 0, pw, ph);
    toNegative(d.data);
    t.putImageData(d, 0, 0);
  } catch {
    // cross-origin photos can't be read back; fall back to the canvas filter where it exists
    t.globalCompositeOperation = "copy";
    t.filter = "invert(1) contrast(.82) brightness(.82) saturate(.8)";
    t.drawImage(tmp, 0, 0);
  }
  return tmp;
}

/* a small alpha mask for a photo: how much of the film shows at each point, from its negative's brightness */
function transparencyMask(img) {
  const w = 40, h = 52;
  const c = document.createElement("canvas");
  c.width = w; c.height = h;
  const t = c.getContext("2d", { willReadFrequently: true });
  t.drawImage(img, ...coverCrop(img, w, h), 0, 0, w, h);
  try {
    const d = t.getImageData(0, 0, w, h);
    toNegative(d.data);
    for (let i = 0; i < d.data.length; i += 4) {
      const lum = (0.2126 * d.data[i] + 0.7152 * d.data[i + 1] + 0.0722 * d.data[i + 2]) / 255;
      d.data[i] = d.data[i + 1] = d.data[i + 2] = 0;
      d.data[i + 3] = Math.round(255 * filmAlpha(lum));
    }
    t.putImageData(d, 0, 0);
    return c;
  } catch {
    return null;         // cross-origin photo: fall back to an even transparency
  }
}

/* ---------- sharper photos, only when they are needed ----------
 * The film strips and the outer glass use the small thumbnails. The eyepiece lens shows a frame magnified, and
 * only when that needs more pixels than the thumbnail has does it load the mid-size version of that frame, and
 * only for the few frames it is looking at (the least recently used are let go again). At the default zoom on a
 * screen with 2x pixel density the thumbnail is already sharp enough, so nothing more is ever downloaded. */
const HI_MAX = 10;                 // mid-size frames kept in memory at once
const HI_FROM_PX = 560;            // use the mid-size version once a frame is drawn wider than this, in device pixels
export const midOf = (src) => src.replace(/([^/]+)$/, "mid/$1");
let hiFrame = 0;

function posImage(scene, s, f) {
  if (scene.drawScale * s.fw < HI_FROM_PX) return f.img;            // the thumbnail has enough pixels
  f.hiUse = ++hiFrame;
  if (f.hi) return f.hi;
  if (!f.hiLoading && f.src) {
    f.hiLoading = true;
    const im = new Image();
    im.decoding = "async";
    im.onerror = () => { if (im.src.endsWith(f.src)) { f.hiLoading = false; f.hiFailed = true; } else im.src = f.src; };   // no mid-size file: use the original
    im.onload = () => {
      im.decode().catch(() => {}).then(() => {
        f.hi = im; f.hiLoading = false;
        const held = scene.strips.flatMap((st) => st.cells.map((c) => c.frame)).filter((fr) => fr.hi);
        if (held.length > HI_MAX) held.sort((a, b) => a.hiUse - b.hiUse).slice(0, held.length - HI_MAX).forEach((fr) => { fr.hi = null; });
        scene.hiLoaded?.();                                          // redraw with the sharper picture
      });
    };
    im.src = f.hiFailed ? f.src : midOf(f.src);
  }
  return f.img;
}

export async function readScene(stage, root) {
  const sheet = stage.querySelector(".lb-neg");
  await Promise.all([...sheet.querySelectorAll("img")].map((i) => i.decode().catch(() => {})));

  const cs = getComputedStyle(root);
  const css = (name, fallback) => cs.getPropertyValue(name).trim() || fallback;
  const ghost = stage.querySelector(".lb-ghost");      // a copy of the sheet that shows the lower strip through the upper one
  const ghostStrips = ghost ? [...ghost.querySelectorAll(".lb-strip")] : [];
  const mult = stage.querySelector(".lb-mult");        // ...and a twin that multiplies instead (stacked film)
  const multStrips = mult ? [...mult.querySelectorAll(".lb-strip")] : [];
  const strips = [...sheet.querySelectorAll(".lb-strip")].map((strip, si) => {
    const first = strip.querySelector(".lb-frame");
    const fw = first.offsetWidth, fh = first.offsetHeight;
    const g = fw * 0.06;
    return {
      el: strip,
      gel: ghostStrips[si] ?? null,
      mel: multStrips[si] ?? null,
      over: [], under: [],                              // overlap polygons (sheet px) with strips beneath / above
      left: strip.offsetLeft, top: strip.offsetTop, w: strip.offsetWidth, h: strip.offsetHeight,
      rot: ((parseFloat(strip.style.getPropertyValue("--rot")) || 0) * Math.PI) / 180,
      ox: 0, oy: 0, vx: 0, vy: 0,                       // the whole strip sliding on the board
      fw, fh, b: fw * 0.21, g, hp: (fh + g) / 4, pt: g * 2,
      cells: [...strip.querySelectorAll(".lb-cell")].map((cell, index) => {
        const f = cell.querySelector(".lb-frame");
        return {
          el: cell, index,
          gel: ghostStrips[si]?.querySelectorAll(".lb-cell")[index] ?? null,
          mel: multStrips[si]?.querySelectorAll(".lb-cell")[index] ?? null,
          top: cell.offsetTop, h: cell.offsetHeight,
          x: 0, dy: 0, ang: 0, omega: 0,                // this piece shifted / tilted against its neighbours
          frame: {
            x: f.offsetLeft, y: f.offsetTop,
            img: f.querySelector("img"),
            src: f.querySelector("img")?.dataset.full ?? null,       // the original photo's address
            hi: null, hiLoading: false, hiUse: 0, hiFailed: false,
            tagL: f.querySelector(".lb-tag.l")?.textContent ?? "",
            tagR: f.querySelector(".lb-tag.r")?.textContent ?? "",
            neg: null,
          },
        };
      }),
    };
  });
  const scene = {
    W: stage.clientWidth, H: stage.offsetHeight, strips,
    bg: css("--lb-bg", "#eadec6"), lit: css("--lb-lit", "#fcf2dc"),
    film: css("--lb-film", "#1b1917"), ink: css("--lb-edge-ink", "#d89a4c"),
    stack: 1,     // 0 = film blends by transparency, 1 = stacked film multiplies the light
    fall: 1,      // panel falloff
    glow: 1,      // panel glow (brighter patches and colour drift)
    grain: 1,     // the panel's matte grain
  };
  /* Stacked negatives multiply: what shows is (lower * upper) / board, where `board` is what clear film shows
     over the bare panel. Dividing the board out keeps the colour of a lone strip unchanged. */
  const P = parseColor(scene.bg);
  const div = (rgb) => `rgb(${rgb.map((v, i) => Math.min(255, Math.round((v * 255) / P[i]))).join(",")})`;
  scene.norm = {
    neg: { film: div(parseColor(scene.film)), ink: div(parseColor(scene.ink)), dodge: `rgb(${P.map((v) => 255 - v).join(",")})` },
    pos: { film: scene.film, ink: scene.ink, dodge: null },     // positives are drawn at their own brightness
  };
  return scene;
}

/* bake every photo as a negative now, so nothing hitches later when the sheet first moves */
export function warmNegatives(scene, rs) {
  scene.rs = rs;
  for (const s of scene.strips) {
    for (const c of s.cells) {
      const f = c.frame;
      if (f.img.naturalWidth) { f.neg ??= negativePhoto(f.img, s.fw, s.fh, rs); f.mask ??= transparencyMask(f.img); }
    }
  }
}

let scratch = null;
/* a frame's photo with its own transparency baked in (drawn only where film lies over film) */
function drawTranslucentPhoto(ctx, scene, f, s, mode) {
  const m = ctx.getTransform();
  const k = Math.min(Math.hypot(m.a, m.b), 3);
  const w = Math.max(1, Math.round(s.fw * k)), h = Math.max(1, Math.round(s.fh * k));
  scratch ??= document.createElement("canvas");
  if (scratch.width < w) scratch.width = w;
  if (scratch.height < h) scratch.height = h;
  const t = scratch.getContext("2d");
  t.imageSmoothingQuality = "high";
  t.globalCompositeOperation = "source-over";
  t.clearRect(0, 0, scratch.width, scratch.height);
  if (mode === "neg") t.drawImage(f.neg, 0, 0, w, h);
  else { const im = posImage(scene, s, f); t.drawImage(im, ...coverCrop(im, w, h), 0, 0, w, h); }
  t.globalCompositeOperation = "destination-in";
  if (f.mask) t.drawImage(f.mask, 0, 0, w, h);
  else { t.fillStyle = `rgba(0,0,0,${filmAlpha(0.35)})`; t.fillRect(0, 0, w, h); }
  t.globalCompositeOperation = "source-over";
  ctx.drawImage(scratch, 0, 0, w, h, f.x, f.y, s.fw, s.fh);
}

/* a frame's photo for the multiply pass: opaque, with the board's colour divided out of a negative */
function drawMultPhoto(ctx, scene, f, s, mode, norm) {
  const m = ctx.getTransform();
  const k = Math.min(Math.hypot(m.a, m.b), 3);
  const w = Math.max(1, Math.round(s.fw * k)), h = Math.max(1, Math.round(s.fh * k));
  scratch ??= document.createElement("canvas");
  if (scratch.width < w) scratch.width = w;
  if (scratch.height < h) scratch.height = h;
  const t = scratch.getContext("2d");
  t.imageSmoothingQuality = "high";
  t.globalCompositeOperation = "source-over";
  t.clearRect(0, 0, scratch.width, scratch.height);
  if (mode === "neg") t.drawImage(f.neg, 0, 0, w, h);
  else { const im = posImage(scene, s, f); t.drawImage(im, ...coverCrop(im, w, h), 0, 0, w, h); }
  if (norm.dodge) {
    t.globalCompositeOperation = "color-dodge";          // backdrop / (1 - source) = photo / board, per channel
    t.fillStyle = norm.dodge;
    t.fillRect(0, 0, w, h);
    t.globalCompositeOperation = "source-over";
  }
  ctx.drawImage(scratch, 0, 0, w, h, f.x, f.y, s.fw, s.fh);
}

/* variant: "opaque" (a plain strip), "alpha" (see-through by density) or "mult" (to be multiplied onto what is below) */
function drawCell(ctx, scene, s, c, mode, variant = "opaque") {
  const translucent = variant === "alpha";
  const norm = variant === "mult" ? scene.norm[mode] : null;
  // film base with see-through sprocket holes. The hole at either end of a cell can reach past the cell; clip to the cell so
  // the part outside is not filled in (with the even-odd rule it would show up as dark rounded patches beside the strip).
  ctx.save();
  ctx.beginPath();
  ctx.rect(0, 0, s.w, c.h);
  ctx.clip();
  ctx.beginPath();
  ctx.rect(0, 0, s.w, c.h);
  const tile0 = c.index === 0 ? s.pt : 0;          // where the hole pattern starts in this cell
  for (let y = tile0 - Math.ceil(tile0 / s.hp) * s.hp; y < c.h; y += s.hp) {
    ellipticRect(ctx, 0.14 * s.b, y + 0.26 * s.hp, 0.46 * s.b, 0.48 * s.hp, 0.14 * s.b, 0.12 * s.hp);
    ellipticRect(ctx, s.w - s.b + 0.4 * s.b, y + 0.26 * s.hp, 0.46 * s.b, 0.48 * s.hp, 0.14 * s.b, 0.12 * s.hp);
  }
  ctx.fillStyle = norm ? norm.film : scene.film;
  const outer = ctx.globalAlpha;
  if (translucent) ctx.globalAlpha = outer * (mode === "pos" ? BASE_ALPHA_POS : BASE_ALPHA);
  ctx.fill("evenodd");
  ctx.restore();
  ctx.globalAlpha = outer;

  const f = c.frame;
  if (f.img.naturalWidth) {
    if (norm) {
      if (mode !== "neg" || f.neg) drawMultPhoto(ctx, scene, f, s, mode, norm);
    } else if (translucent) {
      if (mode !== "neg" || f.neg) drawTranslucentPhoto(ctx, scene, f, s, mode);
    } else if (mode === "neg") {
      if (f.neg) ctx.drawImage(f.neg, f.x, f.y, s.fw, s.fh);
    } else {
      const im = posImage(scene, s, f);
      ctx.drawImage(im, ...coverCrop(im, s.fw, s.fh), f.x, f.y, s.fw, s.fh);
    }
  }

  // edge printing
  const size = s.fw * 0.045;
  ctx.font = `600 ${size}px ui-monospace, "SF Mono", Menlo, monospace`;
  if ("letterSpacing" in ctx) ctx.letterSpacing = `${size * 0.12}px`;
  ctx.fillStyle = norm ? norm.ink : scene.ink;
  const baseAlpha = ctx.globalAlpha;
  ctx.globalAlpha = baseAlpha * 0.85 * (translucent ? TAG_ALPHA : 1);
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.save();
  ctx.translate(f.x - s.fw * 0.065, f.y + s.fh / 2);
  ctx.rotate(-Math.PI / 2);
  ctx.fillText(f.tagL, 0, 0);
  ctx.restore();
  ctx.save();
  ctx.translate(f.x + s.fw + s.fw * 0.065, f.y + s.fh / 2);
  ctx.rotate(Math.PI / 2);
  ctx.fillText(f.tagR, 0, 0);
  ctx.restore();
  ctx.globalAlpha = baseAlpha;
}

function polyPath(ctx, pts) {
  pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
  ctx.closePath();
}

function drawStrip(ctx, scene, s, mode, view, variant = "opaque") {
  const slack = 90;
  ctx.save();
  ctx.translate(s.left + s.w / 2 + s.ox, s.top + s.oy);   // transform-origin: 50% 0
  ctx.rotate(s.rot);
  ctx.translate(-s.w / 2, 0);
  const cos = Math.cos(s.rot), sin = Math.sin(s.rot);
  for (const c of s.cells) {
    if (view) {                                           // skip pieces nowhere near the window
      const my = c.top + c.h / 2;
      const wx = s.left + s.w / 2 + s.ox - my * sin, wy = s.top + s.oy + my * cos;
      const r = Math.hypot(s.w / 2, c.h / 2) + slack;
      if (wx + r < view.x0 || wx - r > view.x1 || wy + r < view.y0 || wy - r > view.y1) continue;
    }
    ctx.save();
    ctx.translate(s.w / 2 + c.x, c.top + c.dy);           // the cell's own transform, about its top centre
    ctx.rotate(c.ang);
    ctx.translate(-s.w / 2, 0);
    drawCell(ctx, scene, s, c, mode, variant);
    ctx.restore();
  }
  ctx.restore();
}

/* mode "neg": the cached negatives. mode "pos": the photos as they are.
 * view: {x0, y0, x1, y1} in sheet px; anything outside it (allowing for the film's own shifts) is skipped. */
function drawScene(ctx, scene, { mode, view }) {
  const slack = 90;
  // a strip that was picked up last sits on top, as in the page (stable sort keeps the page order otherwise)
  const order = scene.strips.some((s) => s.z) ? [...scene.strips].sort((a, b) => (a.z || 0) - (b.z || 0)) : scene.strips;
  for (const s of order) {
    if (view) {
      const q = stripQuad(s);
      const xs = q.map((p) => p[0]), ys = q.map((p) => p[1]);
      if (Math.max(...xs) + slack < view.x0 || Math.min(...xs) - slack > view.x1 ||
          Math.max(...ys) + slack < view.y0 || Math.min(...ys) - slack > view.y1) continue;
    }
    if (s.over.length) {
      // Where this strip lies over another it lets light through, more where the negative is clear.
      // Elsewhere it is opaque.
      ctx.save();
      ctx.beginPath();
      polyPath(ctx, stripQuad(s));
      s.over.forEach((p) => polyPath(ctx, p));
      ctx.clip("evenodd");
      drawStrip(ctx, scene, s, mode, view);
      ctx.restore();

      // stacked film multiplies the light; `stack` slides between that and a plain see-through blend
      // Through the eyepiece (positives) the top strip is always see-through by brightness: its dark parts, the
      // film base included, let the brightest parts of the strip below show through. Multiplying two positives
      // would just black everything out.
      const m = mode === "pos" ? 0 : scene.stack;
      if (m < 1) {
        ctx.save();
        ctx.beginPath();
        s.over.forEach((p) => polyPath(ctx, p));
        ctx.clip();
        ctx.globalAlpha = 1 - m;
        drawStrip(ctx, scene, s, mode, view, "alpha");
        ctx.restore();
      }
      if (m > 0) {
        ctx.save();
        ctx.beginPath();
        s.over.forEach((p) => polyPath(ctx, p));
        ctx.clip();
        ctx.globalCompositeOperation = "multiply";
        ctx.globalAlpha = m;
        drawStrip(ctx, scene, s, mode, view, "mult");
        ctx.restore();
      }
    } else {
      drawStrip(ctx, scene, s, mode, view);
    }
  }
}

/* A square window onto the sheet, centred on the eyepiece. `scale` magnifies it (1 for the outer
 * glass, the zoom for the inner lens). It is `size` css px across; call render() whenever anything moves. */
function createWindowView(scene, dpr, { mode, bg }) {
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d");
  let size = 0;
  const resize = (cssSize) => {
    size = cssSize;
    canvas.width = canvas.height = Math.max(1, Math.round(cssSize * dpr));
  };
  resize(1);
  return {
    canvas,
    resize,
    /* the pixel density this window is drawn at: lowered on a slow device, raised again when it keeps up */
    setDpr(d) { dpr = d; resize(size); },
    render(cx, cy, scale = 1) {
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.fillStyle = scene.dark ?? "#120c08";             // beyond the sheet is the dark room, not more board
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      const k = dpr * scale;
      scene.drawScale = k;                                 // lets the photo drawing pick a thumbnail or the sharper picture
      ctx.setTransform(k, 0, 0, k, (canvas.width - k * 2 * cx) / 2, (canvas.height - k * 2 * cy) / 2);
      ctx.fillStyle = bg;
      ctx.fillRect(0, 0, scene.W, scene.H);                // the sheet itself
      const half = size / 2 / scale;
      // the surface of the light box: its dark room, the fall of its light and the rim's highlight. The film, the buttons and the dust
      // lie on it, so they are drawn over it, and the panel's grain and falloff go over everything, as on the page.
      if (scene.edgeCanvas) ctx.drawImage(scene.edgeCanvas, 0, 0, scene.edgeCanvas.width, scene.edgeCanvas.height, 0, 0, scene.W, scene.H);
      for (const btn of scene.buttons ?? []) paintSocketButton(ctx, btn);      // the push buttons lie on the panel, under the film
      drawScene(ctx, scene, { mode, view: { x0: cx - half, y0: cy - half, x1: cx + half, y1: cy + half } });
      scene.specks?.draw(ctx, { x0: cx - half, y0: cy - half, x1: cx + half, y1: cy + half }, scene.frames);   // dust lying on the panel
      // Through the eyepiece the photographs must be seen as they are: none of the panel's own effects (light spilling onto the film,
      // its tint and glow, the fall of its light, its rim) may touch them. So in the lens they are applied everywhere except
      // over the picture frames.
      if (mode === "pos" && scene.frames?.length) {
        ctx.save();
        ctx.beginPath();
        ctx.rect(cx - half - 4, cy - half - 4, 2 * half + 8, 2 * half + 8);
        for (const q of scene.frames) { q.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y))); ctx.closePath(); }
        ctx.clip("evenodd");
      }
      if (scene.seepCanvas && scene.seepCanvas.width > 2) {     // light from the open board spilling onto the film's edges
        ctx.globalCompositeOperation = "screen";
        ctx.drawImage(scene.seepCanvas, 0, 0, scene.W, scene.H);
        if (scene.holes?.length) paintHoles(ctx, scene.holes, scene.holeQuads, scene.seepSpread, scene.seepStrength, { x0: cx - half, y0: cy - half, x1: cx + half, y1: cy + half }, scene.holeExclude);
        ctx.globalCompositeOperation = "source-over";
      }
      // the panel's light (its falloff and glow) belongs to the panel, not the dark room round it
      if (scene.edge) {
        const { m, f } = scene.edge, r = f * 0.9;
        ctx.save();
        ctx.beginPath();
        ctx.moveTo(m + r, m); ctx.arcTo(scene.W - m, m, scene.W - m, scene.H - m, r); ctx.arcTo(scene.W - m, scene.H - m, m, scene.H - m, r);
        ctx.arcTo(m, scene.H - m, m, m, r); ctx.arcTo(m, m, scene.W - m, m, r); ctx.closePath();
        ctx.clip();
      }
      paintPanel(ctx, scene);      // the light box itself is brighter in the middle
      if (scene.edge) ctx.restore();
      // ...and its surface is matte, not smooth. The grain belongs to the panel, so it is left out of the lens:
      // the photo seen through the eyepiece must not pick up any extra grain.
      if (mode !== "pos") paintGrain(ctx, scene.W, scene.H, scene.grain);
      if (mode === "pos" && scene.frames?.length) ctx.restore();
    },
  };
}

/* the negative sheet around the eyepiece, for the outer glass to refract */
export const createNegView = (scene, dpr) => createWindowView(scene, dpr, { mode: "neg", bg: scene.bg });

/* the lit positive sheet, magnified, for the inner glass. It is (G + 2*pad) css px across so the
 * glass shader can bend the rim outward without running off the edge. */
export const createLensView = (scene, dpr) => createWindowView(scene, dpr, { mode: "pos", bg: scene.lit });
