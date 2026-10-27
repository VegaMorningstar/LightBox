/* nav-bar: a glossy wooden bar that rests on top of a surface and carries its controls: a dark rosewood veneer with a book-matched sunburst grain whose wedges
 * blend softly into each other, a varnished shine, a cream inlay line round it with a flourish in each corner, a THICK edge (you see its right and lower sides
 * in shade, as a real plank has) and a shadow on the surface below it. Light is from the upper left.
 *
 *   import { createNavBar, paintNavBar, BAR_H, EDGE_T } from "./nav-bar/nav-bar.js";
 *
 *   const bar = createNavBar();
 *   bar.left.append(knob, lightButton);       // controls, centred on the bar's own middle line, from its left end
 *   bar.right.append(settings, revert);       // ...and from its right end
 *   stage.append(bar.el);                     // the bar is positioned absolutely inside it
 *   bar.place({ x, y, w, h: BAR_H, radii: [tl, tr, br, bl] }, dpr);   // where it lies (px in the stage), its corner radii, and the pixel density its wood is drawn at
 *   paintNavBar(ctx, { x, y, w, h, wood: bar.wood });                  // the same bar on a canvas, for anything that redraws the surface itself (a magnifier)
 *
 * The bar's box (x, y, w, h) includes its thick edge (the last EDGE_T px on the right and at the bottom). Pass radii that follow the lit panel's own corners so the
 * bar lies flush with the top edge of the light box. The wood, edge and shadow are drawn once on a canvas per size (so the page and the magnifier show the very
 * same picture); it is made again at the new pixel density when the window is resized or zoomed. Self-contained: it loads its own stylesheet (nav-bar.css).
 */

const CSS_URL = new URL("./nav-bar.css", import.meta.url).href;

function ensureStyles() {
  if ([...document.styleSheets].some((s) => s.href === CSS_URL) || document.querySelector(`link[href="${CSS_URL}"]`)) return;
  const link = document.createElement("link");
  link.rel = "stylesheet";
  link.href = CSS_URL;
  document.head.append(link);
}

export const BAR_H = 96;                       // the bar's height, css px, edge included
export const EDGE_T = 6;                       // how thick the bar looks: px of its side showing on the right and at the bottom
export const SHADOW_M = 26;                    // room round the bar, in the wood canvas, for the shadow it casts
const INLAY = "rgba(236, 220, 176, .93)";

/* a small seeded random generator, so the grain is the same every time it is drawn */
function rng(seed) {
  let s = seed >>> 0;
  return () => { s = (s + 0x6d2b79f5) >>> 0; let t = Math.imul(s ^ (s >>> 15), 1 | s); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

const PALETTE = ["#3a1a0b", "#552610", "#6f3314", "#86421a", "#a2561f", "#4a2110", "#2c1208"];

/* a rounded rectangle path with a radius of its own at each corner [tl, tr, br, bl], from (0, 0) to (w, h) */
function roundPath(g, w, h, [tl, tr, br, bl]) {
  g.beginPath();
  g.moveTo(tl, 0); g.lineTo(w - tr, 0); g.arcTo(w, 0, w, tr, tr);
  g.lineTo(w, h - br); g.arcTo(w, h, w - br, h, br);
  g.lineTo(bl, h); g.arcTo(0, h, 0, h - bl, bl);
  g.lineTo(0, tl); g.arcTo(0, 0, tl, 0, tl);
  g.closePath();
}

/* draw the bar into g (a 2D context, already scaled so one unit is one css px) for a bar W by H, edge and shadow included; the drawing is offset by SHADOW_M */
function drawBar(g, W, H, radii) {
  const T = EDGE_T, w = W - T, h = H - T;                                   // the front face, not counting the thickness
  const rad = radii.map((r) => Math.max(1, Math.min(r, h / 2, w / 2)));
  g.save();
  g.translate(SHADOW_M, SHADOW_M);
  // The whole bar, edge included, is the SAME shape as the lit panel's top (radii [R, R, small, small], from (0, 0) to (W, H)): that is what lies flush with the
  // panel's edge. The front face is that shape drawn smaller on the right and at the bottom, and what shows of the full shape beyond it is the bar's side, in
  // shade: nothing at the top and left, EDGE_T thick on the right and at the bottom, and tapering round the top right corner as a real plank's side does.
  const full = rad.map((r, i) => (i === 1 || i === 2 ? r : r));
  // its shadow on the surface below: a tight dark line where it rests and a wide soft one thrown to the lower right (light from the upper left)
  g.save();
  g.shadowColor = "rgba(8, 3, 0, .6)"; g.shadowBlur = 3; g.shadowOffsetX = 1; g.shadowOffsetY = 2; g.fillStyle = "#000"; roundPath(g, W, H, full); g.fill();
  g.shadowColor = "rgba(8, 3, 0, .5)"; g.shadowBlur = 17; g.shadowOffsetX = 4; g.shadowOffsetY = 11; roundPath(g, W, H, full); g.fill();
  g.restore();
  // the side of the bar: dark, a little lighter toward its top and a faint lit line along its lower rim
  const side = g.createLinearGradient(0, 0, W, H);
  side.addColorStop(0, "#3a1b0d"); side.addColorStop(.5, "#1e0d06"); side.addColorStop(1, "#0b0402");
  g.fillStyle = side; roundPath(g, W, H, full); g.fill();
  g.save(); roundPath(g, W, H, full); g.clip();
  g.strokeStyle = "rgba(255, 196, 140, .13)"; g.lineWidth = 1.6; roundPath(g, W, H, full); g.stroke();
  g.restore();
  // the front face
  const rand = rng(20261027);
  g.save();
  roundPath(g, w, h, rad); g.clip();
  g.fillStyle = "#2a1209"; g.fillRect(0, 0, w, h);
  // two sunbursts of veneer, one each side of the middle, as in book-matched pieces: wedges of different browns fanning from a point
  const fan = (cx, x0, x1, mirror) => {
    g.save();
    g.beginPath(); g.rect(x0, 0, x1 - x0, h); g.clip();
    const cy = h * 0.5, L = w;
    for (let a = 0; a < 360;) {
      const wdt = 3 + rand() * 6.5, a2 = a + wdt;
      const col = PALETTE[Math.floor(rand() * PALETTE.length)], al = 0.3 + rand() * 0.36;
      g.fillStyle = col;
      // each wedge is laid down three times, wide and faint, then narrower and stronger, so its edges melt into its neighbours instead of cutting
      for (const [grow, k] of [[3.4, 0.3], [1.9, 0.35], [0.5, 0.5]]) {
        const t1 = ((mirror ? 180 - (a - grow) : a - grow) * Math.PI) / 180, t2 = ((mirror ? 180 - (a2 + grow) : a2 + grow) * Math.PI) / 180;
        g.globalAlpha = al * k;
        g.beginPath(); g.moveTo(cx, cy); g.lineTo(cx + Math.cos(t1) * L, cy + Math.sin(t1) * L); g.lineTo(cx + Math.cos(t2) * L, cy + Math.sin(t2) * L); g.closePath(); g.fill();
      }
      a = a2;
    }
    // where the grain meets at its centre it would pinch to a hard point: a soft warm glow there takes the point away
    const hub = g.createRadialGradient(cx, cy, 0, cx, cy, 46);
    hub.addColorStop(0, "rgba(96, 48, 18, .85)"); hub.addColorStop(.55, "rgba(70, 34, 12, .4)"); hub.addColorStop(1, "rgba(60, 28, 10, 0)");
    g.globalAlpha = 1; g.fillStyle = hub; g.beginPath(); g.arc(cx, cy, 46, 0, Math.PI * 2); g.fill();
    // fine grain along the same directions
    for (let i = 0; i < 380; i++) {
      const a = rand() * Math.PI * 2, r0 = rand() * w * 0.5, r1 = r0 + 10 + rand() * 60;
      g.strokeStyle = rand() < 0.62 ? "rgba(14, 5, 0, .20)" : "rgba(214, 130, 64, .09)";
      g.lineWidth = 0.5 + rand() * 0.7;
      g.beginPath(); g.moveTo(cx + Math.cos(a) * r0, cy + Math.sin(a) * r0); g.lineTo(cx + Math.cos(a) * r1, cy + Math.sin(a) * r1); g.stroke();
    }
    g.restore();
  };
  fan(w * 0.27, 0, w / 2, false);
  fan(w * 0.73, w / 2, w, true);
  const seam = g.createLinearGradient(w / 2 - 5, 0, w / 2 + 5, 0);
  seam.addColorStop(0, "rgba(0,0,0,0)"); seam.addColorStop(.5, "rgba(0,0,0,.26)"); seam.addColorStop(1, "rgba(0,0,0,0)");
  g.fillStyle = seam; g.fillRect(w / 2 - 5, 0, 10, h);
  // varnish: a long diagonal sheen from the upper left, a soft light band across the upper part, and a darker fall toward the lower right
  const sheen = g.createLinearGradient(0, 0, w * 0.55, h * 2.2);
  sheen.addColorStop(0, "rgba(255, 226, 190, .38)"); sheen.addColorStop(.18, "rgba(255, 226, 190, .14)"); sheen.addColorStop(.42, "rgba(255, 226, 190, 0)");
  g.fillStyle = sheen; g.fillRect(0, 0, w, h);
  const band = g.createLinearGradient(0, 0, 0, h);
  band.addColorStop(0, "rgba(255, 236, 210, .16)"); band.addColorStop(.38, "rgba(255, 236, 210, .03)"); band.addColorStop(.7, "rgba(255, 236, 210, 0)"); band.addColorStop(.86, "rgba(255, 236, 210, .07)"); band.addColorStop(1, "rgba(255, 236, 210, 0)");
  g.fillStyle = band; g.fillRect(0, 0, w, h);
  const fall = g.createLinearGradient(0, h * 0.3, w, h);
  fall.addColorStop(0, "rgba(0,0,0,0)"); fall.addColorStop(1, "rgba(0,0,0,.30)");
  g.fillStyle = fall; g.fillRect(0, 0, w, h);
  // the inlay: a cream line inside the edge, following the bar's own corners, with a fan of leaves in each
  const IN = 8;
  const inRad = rad.map((r) => Math.max(4, r - IN));
  const lay = (dx, dy, col, alpha) => {
    g.save(); g.translate(dx, dy); g.strokeStyle = col; g.globalAlpha = alpha; g.fillStyle = col; g.lineWidth = 1.5;
    g.save(); g.translate(IN, IN); roundPath(g, w - 2 * IN, h - 2 * IN, inRad); g.stroke(); g.restore();
    // the corner flourishes sit on the arc of each corner, at 45 degrees
    const corners = [[0, 0, 1, 1, inRad[0]], [w - 2 * IN, 0, -1, 1, inRad[1]], [w - 2 * IN, h - 2 * IN, -1, -1, inRad[2]], [0, h - 2 * IN, 1, -1, inRad[3]]];
    for (const [ox, oy, sx, sy, R] of corners) {
      const px = IN + ox + sx * (R - R * Math.SQRT1_2), py = IN + oy + sy * (R - R * Math.SQRT1_2);
      for (let k = -2; k <= 2; k++) {
        const a = Math.PI / 4 + k * 0.33, len = 9 - Math.abs(k) * 1.1;
        g.lineWidth = 1.2 - Math.abs(k) * 0.12;
        g.beginPath(); g.moveTo(px + sx * 4, py + sy * 4); g.lineTo(px + sx * (4 + Math.cos(a) * len), py + sy * (4 + Math.sin(a) * len)); g.stroke();
      }
      g.beginPath(); g.arc(px + sx * 3.2, py + sy * 3.2, 1.7, 0, Math.PI * 2); g.fill();
    }
    g.restore();
  };
  lay(0.8, 1, "rgba(8, 3, 0, 1)", 0.55);                // the inlay is let into the wood: a dark edge on its lower right...
  lay(0, 0, INLAY, 1);
  lay(-0.5, -0.6, "rgba(255, 248, 224, 1)", 0.35);       // ...and a lit one on its upper left
  g.restore();
  // the rim of the front face: a lit bevel on the upper left fading away toward the lower right, and a thin dark line all round
  g.save();
  const bev = g.createLinearGradient(0, 0, w * 0.5, h * 1.6);
  bev.addColorStop(0, "rgba(255, 220, 170, .62)"); bev.addColorStop(.5, "rgba(255, 220, 170, .12)"); bev.addColorStop(1, "rgba(255, 220, 170, 0)");
  g.translate(0.7, 0.7); g.strokeStyle = bev; g.lineWidth = 1.4; roundPath(g, w - 1.4, h - 1.4, rad.map((r) => Math.max(1, r - 0.7))); g.stroke();
  g.restore();
  g.strokeStyle = "rgba(0, 0, 0, .55)"; g.lineWidth = 1; roundPath(g, w, h, rad); g.stroke();
  g.restore();
}

export function createNavBar() {
  ensureStyles();
  const el = document.createElement("div");
  el.className = "nb";
  const wood = document.createElement("canvas");
  wood.className = "nb-wood";
  const left = document.createElement("div"); left.className = "nb-row nb-left";
  const right = document.createElement("div"); right.className = "nb-row nb-right";
  el.append(wood, left, right);
  let key = "";
  return {
    el, wood, left, right, thickness: EDGE_T,
    /* box: { x, y, w, h, radii } in px of the element it lies in (w and h include the thick edge); dpr: the pixel density to draw the wood at.
       Cheap to call again: it only redraws when something changed. */
    place({ x, y, w, h, radii = [8, 8, 6, 6] }, dpr = 1) {
      Object.assign(el.style, { left: `${x}px`, top: `${y}px`, width: `${w}px`, height: `${h}px` });
      const k = `${Math.round(w)}x${Math.round(h)}@${dpr}|${radii.join(",")}`;
      if (k === key) return;
      key = k;
      const cw = w + 2 * SHADOW_M, ch = h + 2 * SHADOW_M;
      wood.width = Math.max(1, Math.round(cw * dpr)); wood.height = Math.max(1, Math.round(ch * dpr));
      const g = wood.getContext("2d");
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      g.clearRect(0, 0, cw, ch);
      drawBar(g, w, h, radii);
    },
  };
}

/* the bar on a canvas: bar = { x, y, w, h, wood } (x, y: the bar's top left, in the context's units). The picture includes its edge and its shadow, which falls to the lower right. */
export function paintNavBar(ctx, { x, y, w, h, wood }) {
  if (!wood || !wood.width) return;
  ctx.drawImage(wood, x - SHADOW_M, y - SHADOW_M, w + 2 * SHADOW_M, h + 2 * SHADOW_M);
}
