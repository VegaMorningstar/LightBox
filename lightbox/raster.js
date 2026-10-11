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
const BASE_ALPHA = filmAlpha(0.1);    // the film base and borders (about #1b1917)
const TAG_ALPHA = 0.75;               // printed edge text, relative to the film

/* the same rule as an SVG filter: sets each pixel's alpha from its brightness, keeping holes see-through */
export function buildFilmFilter(id) {
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
  </filter></defs>`;
  return svg;
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

export async function readScene(stage, root) {
  const sheet = stage.querySelector(".lb-neg");
  await Promise.all([...sheet.querySelectorAll("img")].map((i) => i.decode().catch(() => {})));

  const cs = getComputedStyle(root);
  const css = (name, fallback) => cs.getPropertyValue(name).trim() || fallback;
  const ghost = stage.querySelector(".lb-ghost");      // a copy of the sheet that shows the lower strip through the upper one
  const ghostStrips = ghost ? [...ghost.querySelectorAll(".lb-strip")] : [];
  const strips = [...sheet.querySelectorAll(".lb-strip")].map((strip, si) => {
    const first = strip.querySelector(".lb-frame");
    const fw = first.offsetWidth, fh = first.offsetHeight;
    const g = fw * 0.06;
    return {
      el: strip,
      gel: ghostStrips[si] ?? null,
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
          top: cell.offsetTop, h: cell.offsetHeight,
          x: 0, dy: 0, ang: 0, omega: 0,                // this piece shifted / tilted against its neighbours
          frame: {
            x: f.offsetLeft, y: f.offsetTop,
            img: f.querySelector("img"),
            tagL: f.querySelector(".lb-tag.l")?.textContent ?? "",
            tagR: f.querySelector(".lb-tag.r")?.textContent ?? "",
            neg: null,
          },
        };
      }),
    };
  });
  return {
    W: stage.clientWidth, H: stage.offsetHeight, strips,
    bg: css("--lb-bg", "#ddd0b6"), lit: css("--lb-lit", "#fff7e2"),
    film: css("--lb-film", "#1b1917"), ink: css("--lb-edge-ink", "#d89a4c"),
  };
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
function drawTranslucentPhoto(ctx, f, s, mode) {
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
  else t.drawImage(f.img, ...coverCrop(f.img, w, h), 0, 0, w, h);
  t.globalCompositeOperation = "destination-in";
  if (f.mask) t.drawImage(f.mask, 0, 0, w, h);
  else { t.fillStyle = `rgba(0,0,0,${filmAlpha(0.35)})`; t.fillRect(0, 0, w, h); }
  t.globalCompositeOperation = "source-over";
  ctx.drawImage(scratch, 0, 0, w, h, f.x, f.y, s.fw, s.fh);
}

function drawCell(ctx, scene, s, c, mode, translucent = false) {
  // film base with see-through sprocket holes
  ctx.beginPath();
  ctx.rect(0, 0, s.w, c.h);
  const tile0 = c.index === 0 ? s.pt : 0;          // where the hole pattern starts in this cell
  for (let y = tile0 - Math.ceil(tile0 / s.hp) * s.hp; y < c.h; y += s.hp) {
    ellipticRect(ctx, 0.14 * s.b, y + 0.26 * s.hp, 0.46 * s.b, 0.48 * s.hp, 0.14 * s.b, 0.12 * s.hp);
    ellipticRect(ctx, s.w - s.b + 0.4 * s.b, y + 0.26 * s.hp, 0.46 * s.b, 0.48 * s.hp, 0.14 * s.b, 0.12 * s.hp);
  }
  ctx.fillStyle = scene.film;
  const outer = ctx.globalAlpha;
  if (translucent) ctx.globalAlpha = outer * BASE_ALPHA;
  ctx.fill("evenodd");
  ctx.globalAlpha = outer;

  const f = c.frame;
  if (f.img.naturalWidth) {
    if (translucent) {
      if (mode !== "neg" || f.neg) drawTranslucentPhoto(ctx, f, s, mode);
    } else if (mode === "neg") {
      if (f.neg) ctx.drawImage(f.neg, f.x, f.y, s.fw, s.fh);
    } else {
      ctx.drawImage(f.img, ...coverCrop(f.img, s.fw, s.fh), f.x, f.y, s.fw, s.fh);
    }
  }

  // edge printing
  const size = s.fw * 0.045;
  ctx.font = `600 ${size}px ui-monospace, "SF Mono", Menlo, monospace`;
  if ("letterSpacing" in ctx) ctx.letterSpacing = `${size * 0.12}px`;
  ctx.fillStyle = scene.ink;
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

function drawStrip(ctx, scene, s, mode, view, translucent = false) {
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
    drawCell(ctx, scene, s, c, mode, translucent);
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

      ctx.save();
      ctx.beginPath();
      s.over.forEach((p) => polyPath(ctx, p));
      ctx.clip();
      drawStrip(ctx, scene, s, mode, view, true);
      ctx.restore();
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
  ctx.imageSmoothingQuality = "high";
  let size = 0;
  return {
    canvas,
    resize(cssSize) {
      size = cssSize;
      canvas.width = canvas.height = Math.max(1, Math.round(cssSize * dpr));
    },
    render(cx, cy, scale = 1) {
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.fillStyle = bg;
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      const k = dpr * scale;
      ctx.setTransform(k, 0, 0, k, (canvas.width - k * 2 * cx) / 2, (canvas.height - k * 2 * cy) / 2);
      const half = size / 2 / scale;
      drawScene(ctx, scene, { mode, view: { x0: cx - half, y0: cy - half, x1: cx + half, y1: cy + half } });
    },
  };
}

/* the negative sheet around the eyepiece, for the outer glass to refract */
export const createNegView = (scene, dpr) => createWindowView(scene, dpr, { mode: "neg", bg: scene.bg });

/* the lit positive sheet, magnified, for the inner glass. It is (G + 2*pad) css px across so the
 * glass shader can bend the rim outward without running off the edge. */
export const createLensView = (scene, dpr) => createWindowView(scene, dpr, { mode: "pos", bg: scene.lit });
