/* toggle-switch: a vintage brass toggle switch, lying on its side (aged-bronze plate, raised brass rim, embossed OFF and ON, a bezel with a knurled brass nut
 * and a threaded collar, and a lever with a ball tip) that turns something on and off.
 *
 *   import { createToggleSwitch, paintToggle } from "./toggle-switch/toggle.js";
 *
 *   const sw = createToggleSwitch({ label: "Light", on: false, onChange: (on) => ... });
 *   row.append(sw.el);                  // a <button role="switch">; click, tap, Enter or Space flips it
 *   sw.set(true);                       // move it from the outside (does not call onChange); sw.on is its state
 *   paintToggle(ctx, { x, y, w, h, on });   // the same switch on a canvas (x, y: its centre), for anything that redraws the surface (a magnifier)
 *
 * The lever leans left toward OFF and right toward ON. The plate is one SVG (plateSvg), used both on the page and, as an image, on canvases, so the two
 * agree and it stays sharp at any zoom. Self-contained: it loads its own stylesheet (toggle.css) beside this file.
 */

const CSS_URL = new URL("./toggle.css", import.meta.url).href;

function ensureStyles() {
  if ([...document.styleSheets].some((s) => s.href === CSS_URL) || document.querySelector(`link[href="${CSS_URL}"]`)) return;
  const link = document.createElement("link");
  link.rel = "stylesheet";
  link.href = CSS_URL;
  document.head.append(link);
}

const VW = 144, VH = 88;                      // the plate's drawing units; the cartouche, 144 by 88
const PAD = 8;                                // drawing units of room all round the plate for the socket it is set into
const LABEL_FONT = `"Futura", "Avenir Next", "Century Gothic", "Trebuchet MS", sans-serif`;

/* the plate and bezel, without the lever. `id` keeps the gradient names of one drawing apart from another's. */
function plateSvg(id, cls = "") {
  const outline = "M14,2 H130 Q142,2 142,14 V34 Q135,44 142,54 V74 Q142,86 130,86 H14 Q2,86 2,74 V54 Q9,44 2,34 V14 Q2,2 14,2 Z";
  // raised letters, small enough to sit in the clear space between the inner rim and the bezel, never touching either
  const emboss = (txt, x) =>
    `<text x="${x + 0.9}" y="48.8" text-anchor="middle" font-size="12" font-weight="700" letter-spacing=".4" fill="rgba(14,8,1,.85)">${txt}</text>` +
    `<text x="${x - 0.45}" y="47.6" text-anchor="middle" font-size="12" font-weight="700" letter-spacing=".4" fill="rgba(255,238,190,.6)">${txt}</text>` +
    `<text x="${x}" y="48.2" text-anchor="middle" font-size="12" font-weight="700" letter-spacing=".4" fill="url(#${id}-letter)">${txt}</text>`;
  return `<svg class="${cls}" viewBox="${-PAD} ${-PAD} ${VW + 2 * PAD} ${VH + 2 * PAD}" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" font-family='${LABEL_FONT.replace(/"/g, "")}'>` +
    `<defs>` +
    `<linearGradient id="${id}-plate" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#8a7650"/><stop offset=".45" stop-color="#66553a"/><stop offset="1" stop-color="#3f3220"/></linearGradient>` +
    `<linearGradient id="${id}-rim" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#f0d68a"/><stop offset=".5" stop-color="#c9a24a"/><stop offset="1" stop-color="#7c5c1c"/></linearGradient>` +
    `<linearGradient id="${id}-letter" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#f1d98f"/><stop offset="1" stop-color="#b78f35"/></linearGradient>` +
    `<radialGradient id="${id}-nut" cx=".36" cy=".3" r=".8"><stop offset="0" stop-color="#ffe9a0"/><stop offset=".45" stop-color="#e0b64d"/><stop offset="1" stop-color="#9c741f"/></radialGradient>` +
    `<radialGradient id="${id}-collar" cx=".36" cy=".3" r=".85"><stop offset="0" stop-color="#f6dd92"/><stop offset=".55" stop-color="#cfa543"/><stop offset="1" stop-color="#86631a"/></radialGradient>` +
    `<radialGradient id="${id}-well" cx=".4" cy=".35" r=".8"><stop offset="0" stop-color="#5d4d33"/><stop offset="1" stop-color="#3e3220"/></radialGradient>` +
    `<clipPath id="${id}-cc"><circle cx="72" cy="44" r="14.2"/></clipPath>` +
    `<filter id="${id}-b1" x="-20%" y="-30%" width="140%" height="160%"><feGaussianBlur stdDeviation="1.3"/></filter>` +
    `<filter id="${id}-b2" x="-20%" y="-30%" width="140%" height="160%"><feGaussianBlur stdDeviation="3.2"/></filter>` +
    `</defs>` +
    // SET INTO THE PANEL, not floating on it: the plate sits in a socket cut in the surface. A dark gap right round it (the shade inside the cut), the far lip
    // catching the light on the lower right, the near lip in shade on the upper left, and a wide soft shadow thrown to the lower right (light from the upper left)
    `<path d="${outline}" fill="rgba(30,18,6,.34)" filter="url(#${id}-b2)" transform="translate(4.5 6)"/>` +
    `<path d="${outline}" fill="none" stroke="rgba(255,252,240,.95)" stroke-width="3.4" filter="url(#${id}-b1)" transform="translate(2.6 3.4)"/>` +
    `<path d="${outline}" fill="none" stroke="rgba(70,48,26,.5)" stroke-width="3" filter="url(#${id}-b1)" transform="translate(-1.4 -1.8)"/>` +
    `<path d="${outline}" fill="none" stroke="rgba(32,20,8,.9)" stroke-width="4.6" filter="url(#${id}-b1)"/>` +
    // the plate itself, with a bevel: lit on the upper left, shaded on the lower right, and a raised brass rim just inside the edge
    `<path d="${outline}" fill="url(#${id}-plate)"/>` +
    `<path d="${outline}" fill="none" stroke="url(#${id}-rim)" stroke-width="2.4"/>` +
    `<path d="${outline}" fill="none" stroke="rgba(10,5,0,.75)" stroke-width="1.4" transform="translate(.9 1.2)"/>` +
    `<path d="${outline}" fill="none" stroke="rgba(255,240,190,.55)" stroke-width="1" transform="translate(-.7 -.9)"/>` +
    `<path d="${outline}" fill="none" stroke="rgba(10,5,0,.6)" stroke-width="1.3" transform="translate(72.7 45) scale(.9 .86) translate(-72 -44)"/>` +
    `<path d="${outline}" fill="none" stroke="url(#${id}-rim)" stroke-width="1.3" opacity=".95" transform="translate(72 44) scale(.9 .86) translate(-72 -44)"/>` +
    // OFF on the left, ON on the right: raised letters
    emboss("OFF", 27) + emboss("ON", 117) +
    // the bezel: a recess ringed in brass, holding the knurled nut and the threaded collar
    `<circle cx="72" cy="44" r="29.5" fill="url(#${id}-well)"/>` +
    `<circle cx="72" cy="44" r="29.5" fill="none" stroke="url(#${id}-rim)" stroke-width="1.6"/>` +
    `<circle cx="73" cy="45.4" r="30.6" fill="none" stroke="rgba(10,5,0,.7)" stroke-width="1.6"/>` +
    `<circle cx="72" cy="44" r="23" fill="none" stroke="#8d6a1f" stroke-width="3.4" stroke-dasharray="1.15 1.15"/>` +   // the knurled edge of the nut: a ring of fine teeth
    `<circle cx="72" cy="44" r="21.5" fill="url(#${id}-nut)"/>` +
    `<circle cx="72" cy="44" r="21.5" fill="none" stroke="rgba(255,243,200,.55)" stroke-width=".8" transform="translate(-.5 -.6)"/>` +
    `<circle cx="72" cy="44" r="14.5" fill="url(#${id}-collar)"/>` +
    `<g clip-path="url(#${id}-cc)" stroke="rgba(70,46,8,.6)" stroke-width=".9">` + [...Array(11)].map((_, i) => `<line x1="56" x2="88" y1="${32 + i * 2.5}" y2="${32 + i * 2.5}"/>`).join("") + `</g>` +   // the thread
    `<circle cx="72" cy="44" r="14.5" fill="none" stroke="rgba(60,38,6,.5)" stroke-width="1"/>` +
    `<circle cx="72" cy="44" r="7.2" fill="#17100a"/>` +
    `<circle cx="72" cy="44" r="7.2" fill="none" stroke="rgba(255,235,170,.35)" stroke-width=".8" transform="translate(.5 .7)"/>` +
    `</svg>`;
}

let counter = 0;

export function createToggleSwitch({ label = "Switch", on = false, onChange } = {}) {
  ensureStyles();
  const el = document.createElement("button");
  el.type = "button";
  el.className = "ts";
  el.dataset.icon = "toggle";
  el.setAttribute("role", "switch");
  el.setAttribute("aria-label", label);
  el.title = label;
  el.innerHTML = plateSvg(`ts${++counter}`, "ts-plate") + `<span class="ts-arm"><span class="ts-lever"></span></span>`;
  const api = {
    el,
    get on() { return el.getAttribute("aria-checked") === "true"; },
    set(v) { el.setAttribute("aria-checked", String(!!v)); },
  };
  api.set(on);
  el.addEventListener("click", () => { const next = !api.on; api.set(next); onChange?.(next); });
  return api;
}

/* the plate as an image, for canvases (made once; it is drawn only when it has loaded) */
let plateImg = null;
function plateImage() {
  if (!plateImg) {
    plateImg = new Image();
    plateImg.src = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(plateSvg("tsc"));
  }
  return plateImg;
}

/* the switch drawn on a canvas, centred on (x, y), w by h px: the plate (the same drawing as the page's), then the lever leaning to the left (off) or the right (on) */
export function paintToggle(ctx, { x, y, w = 78, h = 48, on = false }) {
  const img = plateImage();
  if (!img.complete || !img.naturalWidth) return;
  ctx.save();
  const px = (PAD * w) / VW, py = (PAD * h) / VH;                // the image has room round the plate for its socket
  ctx.drawImage(img, x - w / 2 - px, y - h / 2 - py, w + 2 * px, h + 2 * py);
  ctx.restore();
  // the lever, from the middle of the bezel
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(w / 78, w / 78);
  ctx.shadowColor = "rgba(20,12,4,.55)"; ctx.shadowBlur = 1.6; ctx.shadowOffsetX = 2; ctx.shadowOffsetY = 3;
  ctx.rotate((on ? -100 : 100) * Math.PI / 180);
  const lg = ctx.createLinearGradient(-2.6, 0, 2.6, 0);
  lg.addColorStop(0, "#8c6b25"); lg.addColorStop(0.34, "#f0d58c"); lg.addColorStop(0.48, "#fff3c4"); lg.addColorStop(0.68, "#d7b04e"); lg.addColorStop(1, "#80601f");
  ctx.fillStyle = lg; ctx.fillRect(-2.6, 0, 5.2, 9.5);
  const bg = ctx.createRadialGradient(-1.4, 11.3 - 1.4, 0.3, 0, 11.3, 4.9);
  bg.addColorStop(0, "#fffbe6"); bg.addColorStop(0.24, "#f1d98f"); bg.addColorStop(0.62, "#cfa43f"); bg.addColorStop(1, "#7d5c1b");
  ctx.fillStyle = bg; ctx.beginPath(); ctx.arc(0, 11.3, 4.7, 0, Math.PI * 2); ctx.fill();
  ctx.restore();
}
