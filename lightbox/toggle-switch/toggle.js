/* toggle-switch: a brass toggle switch (brushed brass plate, slot screws, knurled lever) that turns something on and off.
 *
 *   import { createToggleSwitch, paintToggle } from "./toggle-switch/toggle.js";
 *
 *   const sw = createToggleSwitch({ label: "Light", on: false, onChange: (on) => ... });
 *   row.append(sw.el);                  // a <button role="switch">; click, tap, Enter or Space flips it
 *   sw.set(true);                       // move it from the outside (does not call onChange); sw.on is its state
 *   paintToggle(ctx, { x, y, w, h, on });   // the same switch on a canvas (x, y: its centre), for anything that redraws the surface (a magnifier)
 *
 * The lever stands up when it is on and points down when it is off. Self-contained: it loads its own stylesheet (toggle.css) beside this file.
 */

const CSS_URL = new URL("./toggle.css", import.meta.url).href;

function ensureStyles() {
  if ([...document.styleSheets].some((s) => s.href === CSS_URL) || document.querySelector(`link[href="${CSS_URL}"]`)) return;
  const link = document.createElement("link");
  link.rel = "stylesheet";
  link.href = CSS_URL;
  document.head.append(link);
}

export function createToggleSwitch({ label = "Switch", on = false, onChange } = {}) {
  ensureStyles();
  const el = document.createElement("button");
  el.type = "button";
  el.className = "ts";
  el.dataset.icon = "toggle";
  el.setAttribute("role", "switch");
  el.setAttribute("aria-label", label);
  el.title = label;
  el.innerHTML = `<span class="ts-slot"></span><span class="ts-arm"><span class="ts-lever"></span></span>`;
  const api = {
    el,
    get on() { return el.getAttribute("aria-checked") === "true"; },
    set(v) { el.setAttribute("aria-checked", String(!!v)); },
  };
  api.set(on);
  el.addEventListener("click", () => { const next = !api.on; api.set(next); onChange?.(next); });
  return api;
}

/* the switch drawn on a canvas, centred on (x, y), w by h px. Same shapes as the stylesheet, drawn to the plate's own size (30 by 58 units). */
export function paintToggle(ctx, { x, y, w = 30, h = 58, on = false }) {
  const k = w / 30;
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(k, k);
  const W = 30, H = h / k, px = -W / 2, py = -H / 2;
  const rr = (rx, ry, rw, rh, r) => { ctx.beginPath(); ctx.roundRect ? ctx.roundRect(rx, ry, rw, rh, r) : ctx.rect(rx, ry, rw, rh); };
  // the plate: it casts a small shadow to the lower right, then brass with a lit bevel on the upper left
  ctx.save(); ctx.shadowColor = "rgba(40,24,8,.38)"; ctx.shadowBlur = 5; ctx.shadowOffsetX = 2.5; ctx.shadowOffsetY = 3.5;
  rr(px, py, W, H, 3); const g = ctx.createLinearGradient(px, py, px + W, py + H);
  g.addColorStop(0, "#e6c985"); g.addColorStop(0.48, "#d3ad60"); g.addColorStop(1, "#b98f40"); ctx.fillStyle = g; ctx.fill(); ctx.restore();
  ctx.strokeStyle = "rgba(255,244,205,.75)"; ctx.lineWidth = 1; rr(px + 0.5, py + 0.5, W - 1, H - 1, 2.5); ctx.stroke();
  ctx.save(); ctx.globalAlpha = 0.5; ctx.strokeStyle = "rgba(112,76,24,.6)"; ctx.beginPath(); ctx.moveTo(px + W - 0.5, py + 1); ctx.lineTo(px + W - 0.5, py + H - 0.5); ctx.lineTo(px + 1, py + H - 0.5); ctx.stroke(); ctx.restore();
  // the two slot screws
  for (const sy of [py + 6.5, py + H - 6.5]) {
    const sg = ctx.createRadialGradient(-1, sy - 0.8, 0.3, 0, sy, 2.6); sg.addColorStop(0, "#f1d994"); sg.addColorStop(1, "#bd9446");
    ctx.fillStyle = sg; ctx.beginPath(); ctx.arc(0, sy, 2.5, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = "rgba(70,46,12,.85)"; ctx.lineWidth = 0.8; ctx.beginPath(); ctx.moveTo(-1.8, sy + 1.8); ctx.lineTo(1.8, sy - 1.8); ctx.stroke();
  }
  // the slot
  ctx.fillStyle = "#14100b"; rr(-5, -13, 10, 26, 1.5); ctx.fill();
  ctx.strokeStyle = "rgba(86,58,20,.75)"; ctx.lineWidth = 1; rr(-5.5, -13.5, 11, 27, 2); ctx.stroke();
  // the lever: from the slot's middle, up when on and down when off, with its shadow to the lower right
  ctx.save(); ctx.shadowColor = "rgba(30,18,6,.5)"; ctx.shadowBlur = 2; ctx.shadowOffsetX = 2; ctx.shadowOffsetY = 3;
  ctx.rotate(on ? Math.PI : 0);
  const lg = ctx.createLinearGradient(-3, 0, 3, 0);
  lg.addColorStop(0, "#86692a"); lg.addColorStop(0.32, "#e8cd8c"); lg.addColorStop(0.48, "#fff2c8"); lg.addColorStop(0.68, "#cfa853"); lg.addColorStop(1, "#7d5f22");
  ctx.fillStyle = lg; ctx.fillRect(-3, 0, 6, 20);
  ctx.globalAlpha = 0.35; ctx.strokeStyle = "rgba(60,38,8,1)"; ctx.lineWidth = 0.8;                              // the knurling
  for (let ky = 1; ky < 20; ky += 2.4) { ctx.beginPath(); ctx.moveTo(-3, ky); ctx.lineTo(3, ky + 2.2); ctx.stroke(); }
  ctx.globalAlpha = 1;
  const tg = ctx.createRadialGradient(-0.9, 20 - 0.9, 0.3, 0, 20, 3.7); tg.addColorStop(0, "#fff8dc"); tg.addColorStop(0.55, "#dcbb6a"); tg.addColorStop(1, "#8d6c2c");
  ctx.fillStyle = tg; ctx.beginPath(); ctx.arc(0, 20, 3.5, 0, Math.PI * 2); ctx.fill();
  ctx.restore();
  ctx.restore();
}
