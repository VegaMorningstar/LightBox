/* nav-bar: a glossy wooden bar that rests on top of a surface and carries its controls: a dark rosewood veneer with a book-matched sunburst grain, a varnished
 * shine, and a cream inlay line round it with a flourish in each corner. Light is from the upper left.
 *
 *   import { createNavBar, paintNavBar, BAR_H } from "./nav-bar/nav-bar.js";
 *
 *   const bar = createNavBar();
 *   bar.left.append(knob, lightButton);       // controls, centred on the bar's own middle line, from its left end
 *   bar.right.append(settings, revert);       // ...and from its right end
 *   stage.append(bar.el);                     // the bar is positioned absolutely inside it
 *   bar.place({ x, y, w, h: BAR_H }, dpr);    // where it lies (px in the stage) and the pixel density its wood is drawn at; redraws the wood if the size changed
 *   paintNavBar(ctx, { x, y, w, h, wood: bar.wood });   // the same bar on a canvas, for anything that redraws the surface itself (a magnifier)
 *
 * The wood is drawn once on a canvas per size (so the page and the magnifier show the very same picture); it is made again at the new pixel density when the
 * window is resized or zoomed. Self-contained: it loads its own stylesheet (nav-bar.css) beside this file.
 */

const CSS_URL = new URL("./nav-bar.css", import.meta.url).href;

function ensureStyles() {
  if ([...document.styleSheets].some((s) => s.href === CSS_URL) || document.querySelector(`link[href="${CSS_URL}"]`)) return;
  const link = document.createElement("link");
  link.rel = "stylesheet";
  link.href = CSS_URL;
  document.head.append(link);
}

export const BAR_H = 96;                       // the bar's height, css px: tall enough for the volume knob and the scale round it

const RADIUS = 7;
const INLAY = "rgba(236, 220, 176, .93)";

/* a small seeded random generator, so the grain is the same every time it is drawn */
function rng(seed) {
  let s = seed >>> 0;
  return () => { s = (s + 0x6d2b79f5) >>> 0; let t = Math.imul(s ^ (s >>> 15), 1 | s); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

const PALETTE = ["#3a1a0b", "#552610", "#6f3314", "#86421a", "#a2561f", "#4a2110", "#2c1208"];

/* draw the wood into g (a 2D context, already scaled so one unit is one css px) for a bar W by H */
function drawWood(g, W, H) {
  const rand = rng(20261027);
  g.save();
  g.beginPath(); g.roundRect(0, 0, W, H, RADIUS); g.clip();
  g.fillStyle = "#2a1209"; g.fillRect(0, 0, W, H);
  // two sunbursts of veneer, one each side of the middle, as in book-matched pieces: wedges of different browns fanning from a point
  const fan = (cx, x0, x1, mirror) => {
    g.save();
    g.beginPath(); g.rect(x0, 0, x1 - x0, H); g.clip();
    const cy = H * 0.5, L = W;
    for (let a = 0; a < 360;) {
      const wdt = 3 + rand() * 6.5, a2 = a + wdt;
      const col = PALETTE[Math.floor(rand() * PALETTE.length)], al = 0.3 + rand() * 0.36;
      g.fillStyle = col;
      // each wedge is laid down three times, wide and faint, then narrower and stronger, so its edges melt into its neighbours instead of cutting
      for (const [grow, k] of [[3.4, 0.3], [1.9, 0.35], [0.5, 0.5]]) {
        const t1 = (((mirror ? 180 - (a - grow) : a - grow)) * Math.PI) / 180, t2 = (((mirror ? 180 - (a2 + grow) : a2 + grow)) * Math.PI) / 180;
        g.globalAlpha = al * k;
        g.beginPath(); g.moveTo(cx, cy); g.lineTo(cx + Math.cos(t1) * L, cy + Math.sin(t1) * L); g.lineTo(cx + Math.cos(t2) * L, cy + Math.sin(t2) * L); g.closePath(); g.fill();
      }
      a = a2;
    }
    // where the grain meets at its centre it would pinch to a hard point: a soft warm glow there takes the point away
    const hub = g.createRadialGradient(cx, cy, 0, cx, cy, 46);
    hub.addColorStop(0, "rgba(96, 48, 18, .85)"); hub.addColorStop(.55, "rgba(70, 34, 12, .4)"); hub.addColorStop(1, "rgba(60, 28, 10, 0)");
    g.globalAlpha = 1; g.fillStyle = hub; g.beginPath(); g.arc(cx, cy, 46, 0, Math.PI * 2); g.fill();
    g.globalAlpha = 1;
    // fine grain along the same directions
    for (let i = 0; i < 380; i++) {
      const a = rand() * Math.PI * 2, r0 = rand() * W * 0.5, r1 = r0 + 10 + rand() * 60;
      g.strokeStyle = rand() < 0.62 ? "rgba(14, 5, 0, .20)" : "rgba(214, 130, 64, .09)";
      g.lineWidth = 0.5 + rand() * 0.7;
      g.beginPath(); g.moveTo(cx + Math.cos(a) * r0, cy + Math.sin(a) * r0); g.lineTo(cx + Math.cos(a) * r1, cy + Math.sin(a) * r1); g.stroke();
    }
    g.restore();
  };
  fan(W * 0.27, 0, W / 2, false);
  fan(W * 0.73, W / 2, W, true);
  // the seam between the two pieces
  const seam = g.createLinearGradient(W / 2 - 5, 0, W / 2 + 5, 0);
  seam.addColorStop(0, "rgba(0,0,0,0)"); seam.addColorStop(.5, "rgba(0,0,0,.26)"); seam.addColorStop(1, "rgba(0,0,0,0)");
  g.fillStyle = seam; g.fillRect(W / 2 - 5, 0, 10, H);
  // varnish: a long diagonal sheen from the upper left, and a darker fall toward the lower right
  const sheen = g.createLinearGradient(0, 0, W * 0.55, H * 2.2);
  sheen.addColorStop(0, "rgba(255, 226, 190, .38)"); sheen.addColorStop(.18, "rgba(255, 226, 190, .14)"); sheen.addColorStop(.42, "rgba(255, 226, 190, 0)");
  g.fillStyle = sheen; g.fillRect(0, 0, W, H);
  const band = g.createLinearGradient(0, 0, 0, H);                         // the shine of the varnish: a soft light band across the upper part, a faint one below
  band.addColorStop(0, "rgba(255, 236, 210, .16)"); band.addColorStop(.38, "rgba(255, 236, 210, .03)"); band.addColorStop(.7, "rgba(255, 236, 210, 0)"); band.addColorStop(.86, "rgba(255, 236, 210, .07)"); band.addColorStop(1, "rgba(255, 236, 210, 0)");
  g.fillStyle = band; g.fillRect(0, 0, W, H);
  const fall = g.createLinearGradient(0, H * 0.3, W, H);
  fall.addColorStop(0, "rgba(0,0,0,0)"); fall.addColorStop(1, "rgba(0,0,0,.30)");
  g.fillStyle = fall; g.fillRect(0, 0, W, H);
  // the inlay: a cream line round the bar with a fan of leaves in each corner
  const IN = 8, R = 11;
  g.lineWidth = 1.5;
  const lay = (dx, dy, col, alpha) => {
    g.save(); g.translate(dx, dy); g.strokeStyle = col; g.globalAlpha = alpha; g.fillStyle = col;
    g.beginPath(); g.roundRect(IN, IN, W - 2 * IN, H - 2 * IN, R); g.stroke();
    for (const [cx, cy, sx, sy] of [[IN, IN, 1, 1], [W - IN, IN, -1, 1], [IN, H - IN, 1, -1], [W - IN, H - IN, -1, -1]]) {
      for (let k = -2; k <= 2; k++) {                                          // five leaves fanning out from the corner
        const a = Math.PI / 4 + k * 0.33, len = 9 - Math.abs(k) * 1.1;
        g.lineWidth = 1.2 - Math.abs(k) * 0.12;
        g.beginPath(); g.moveTo(cx + sx * 4, cy + sy * 4); g.lineTo(cx + sx * (4 + Math.cos(a) * len), cy + sy * (4 + Math.sin(a) * len)); g.stroke();
      }
      g.beginPath(); g.arc(cx + sx * 3.2, cy + sy * 3.2, 1.7, 0, Math.PI * 2); g.fill();
    }
    g.restore();
  };
  lay(0.8, 1, "rgba(8, 3, 0, 1)", 0.55);                // the inlay is let into the wood: a dark edge on its lower right...
  lay(0, 0, INLAY, 1);
  lay(-0.5, -0.6, "rgba(255, 248, 224, 1)", 0.35);       // ...and a lit one on its upper left
  // the bevel of the bar's edge, and the shade just inside it
  g.globalAlpha = 1;
  g.strokeStyle = "rgba(255, 214, 160, .4)"; g.lineWidth = 1.2; g.beginPath(); g.roundRect(0.6, 0.6, W - 1.2, H - 1.2, RADIUS - 0.5); g.stroke();
  g.strokeStyle = "rgba(0, 0, 0, .55)"; g.lineWidth = 1.6; g.beginPath(); g.moveTo(RADIUS, H - 0.8); g.lineTo(W - RADIUS, H - 0.8); g.moveTo(W - 0.8, RADIUS); g.lineTo(W - 0.8, H - RADIUS); g.stroke();
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
    el, wood, left, right,
    /* box: { x, y, w, h } in px of the element it lies in; dpr: the pixel density to draw the wood at. Cheap to call again: it only redraws when the size changed. */
    place({ x, y, w, h }, dpr = 1) {
      Object.assign(el.style, { left: `${x}px`, top: `${y}px`, width: `${w}px`, height: `${h}px` });
      const k = `${Math.round(w)}x${Math.round(h)}@${dpr}`;
      if (k === key) return;
      key = k;
      wood.width = Math.max(1, Math.round(w * dpr)); wood.height = Math.max(1, Math.round(h * dpr));
      const g = wood.getContext("2d");
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      g.clearRect(0, 0, w, h);
      drawWood(g, w, h);
    },
  };
}

/* the bar on a canvas: bar = { x, y, w, h, wood } (x, y: its top left, in the context's units). Its shadow falls to the lower right. */
export function paintNavBar(ctx, { x, y, w, h, wood }) {
  if (!wood || !wood.width) return;
  ctx.save();
  ctx.shadowColor = "rgba(10, 4, 0, .5)"; ctx.shadowBlur = 9; ctx.shadowOffsetX = 3; ctx.shadowOffsetY = 5;
  ctx.drawImage(wood, x, y, w, h);
  ctx.restore();
}
