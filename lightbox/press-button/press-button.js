/* press-button: a latching push button on a weathered plate (patinated teal-green metal with rust showing through, screw holes, eyelets, and a brass-rimmed
 * recess holding a cream knob with a fluted edge). Press it and it goes in and stays in (on); press again and it springs out (off).
 *
 *   import { createPressButton, paintPressButton } from "./press-button/press-button.js";
 *
 *   const pb = createPressButton({ label: "Light", on: false, onChange: (on) => ... });
 *   row.append(pb.el);                  // a <button role="switch">; click, tap, Enter or Space presses it
 *   pb.set(true);                       // move it from the outside (does not call onChange); pb.on is its state
 *   paintPressButton(ctx, { x, y, w, h, on });   // the same button on a canvas (x, y: its centre), for anything that redraws the surface (a magnifier)
 *
 * The plate is one SVG (plateSvg), used both on the page and, as an image, on canvases, so the two agree and it stays sharp at any zoom.
 * Self-contained: it loads its own stylesheet (press-button.css) beside this file.
 */

const CSS_URL = new URL("./press-button.css", import.meta.url).href;

function ensureStyles() {
  if ([...document.styleSheets].some((s) => s.href === CSS_URL) || document.querySelector(`link[href="${CSS_URL}"]`)) return;
  const link = document.createElement("link");
  link.rel = "stylesheet";
  link.href = CSS_URL;
  document.head.append(link);
}

const VW = 168, VH = 76;                      // the plate's drawing units
const PAD = 8;                                // drawing units of room all round the plate for the socket it is set into

/* The plate with its knob. `id` keeps the gradient names of one drawing apart from another's. `baked`: null for the page (the stylesheet moves the knob), or
   "out" / "in" to draw the knob already out or pressed in (for the canvas copy). */
function plateSvg(id, cls = "", baked = null) {
  const P = "M6,2 H162 Q166,2 166,6 V70 Q166,74 162,74 H6 Q2,74 2,70 V6 Q2,2 6,2 Z";
  const hole = (cx, cy, r) =>
    `<circle cx="${cx}" cy="${cy}" r="${r}" fill="url(#${id}-hole)"/>` +
    `<circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="rgba(0,0,0,.7)" stroke-width="1" transform="translate(-.5 -.6)"/>` +
    `<circle cx="${cx}" cy="${cy}" r="${r + .4}" fill="none" stroke="rgba(236,214,170,.55)" stroke-width=".9" transform="translate(.6 .8)" clip-path="url(#${id}-lip-${cx}-${cy})"/>`;
  const holes = [[9, 9, 3], [159, 9, 3], [9, 67, 3], [159, 67, 3], [20, 38, 5.6], [148, 38, 5.6]];
  const grommet = (cx, cy) =>
    `<circle cx="${cx + .7}" cy="${cy + 1}" r="5.4" fill="rgba(10,5,0,.5)" filter="url(#${id}-b1)"/>` +
    `<circle cx="${cx}" cy="${cy}" r="4.4" fill="none" stroke="url(#${id}-brass)" stroke-width="2.2"/>` +
    `<circle cx="${cx}" cy="${cy}" r="3.3" fill="#1b130b"/>`;
  const capTf = baked === "in" ? ` transform="translate(84 38) scale(.9) translate(-84 -38)"` : "";
  return `<svg class="${cls}" viewBox="${-PAD} ${-PAD} ${VW + 2 * PAD} ${VH + 2 * PAD}" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">` +
    `<defs>` +
    `<linearGradient id="${id}-plate" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#5c8d87"/><stop offset=".5" stop-color="#43736f"/><stop offset="1" stop-color="#2d4f4d"/></linearGradient>` +
    `<linearGradient id="${id}-brass" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#f1d98a"/><stop offset=".5" stop-color="#c49b3d"/><stop offset="1" stop-color="#6f5118"/></linearGradient>` +
    `<radialGradient id="${id}-cream" cx=".36" cy=".3" r=".85"><stop offset="0" stop-color="#fcf6dc"/><stop offset=".55" stop-color="#eadfbd"/><stop offset="1" stop-color="#c9bc94"/></radialGradient>` +
    `<radialGradient id="${id}-spec" cx=".5" cy=".5" r=".5"><stop offset="0" stop-color="#fff" stop-opacity=".85"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></radialGradient>` +
    `<radialGradient id="${id}-hole" cx=".6" cy=".62" r=".7"><stop offset="0" stop-color="#2b1e12"/><stop offset="1" stop-color="#080502"/></radialGradient>` +
    `<clipPath id="${id}-clip"><path d="${P}"/></clipPath>` +
    holes.map(([cx, cy, r]) => `<clipPath id="${id}-lip-${cx}-${cy}"><rect x="${cx}" y="${cy - r - 2}" width="${r + 3}" height="${2 * r + 4}"/><rect x="${cx - r - 2}" y="${cy}" width="${2 * r + 4}" height="${r + 3}"/></clipPath>`).join("") +
    `<filter id="${id}-b1" x="-30%" y="-30%" width="160%" height="160%"><feGaussianBlur stdDeviation="1.3"/></filter>` +
    `<filter id="${id}-b2" x="-20%" y="-30%" width="140%" height="160%"><feGaussianBlur stdDeviation="3.2"/></filter>` +
    // rust coming through the green: blotches where a slow noise is high, and fine dark flecks
    `<filter id="${id}-rust" x="0" y="0" width="100%" height="100%" color-interpolation-filters="sRGB"><feTurbulence type="fractalNoise" baseFrequency=".045 .065" numOctaves="3" seed="11"/>` +
    `<feColorMatrix type="matrix" values="0 0 0 0 .37  0 0 0 0 .22  0 0 0 0 .14  6.2 0 0 0 -3.2"/></filter>` +
    `<filter id="${id}-fleck" x="0" y="0" width="100%" height="100%" color-interpolation-filters="sRGB"><feTurbulence type="fractalNoise" baseFrequency=".55" numOctaves="1" seed="4"/>` +
    `<feColorMatrix type="matrix" values="0 0 0 0 .12  0 0 0 0 .08  0 0 0 0 .05  5 0 0 0 -2.9"/></filter>` +
    `</defs>` +
    // SET INTO THE PANEL, not floating on it: the plate sits in a socket cut in the surface. A dark gap right round it, the far lip catching the light on the
    // lower right, the near lip in shade on the upper left, and a soft shadow thrown to the lower right (light from the upper left)
    `<path d="${P}" fill="rgba(30,18,6,.34)" filter="url(#${id}-b2)" transform="translate(4.5 6)"/>` +
    `<path d="${P}" fill="none" stroke="rgba(255,252,240,.95)" stroke-width="3.4" filter="url(#${id}-b1)" transform="translate(2.6 3.4)"/>` +
    `<path d="${P}" fill="none" stroke="rgba(70,48,26,.5)" stroke-width="3" filter="url(#${id}-b1)" transform="translate(-1.4 -1.8)"/>` +
    `<path d="${P}" fill="none" stroke="rgba(32,20,8,.9)" stroke-width="4.6" filter="url(#${id}-b1)"/>` +
    // the plate: green metal, rust through it, a worn rim
    `<path d="${P}" fill="url(#${id}-plate)"/>` +
    `<rect x="2" y="2" width="164" height="72" fill="none" filter="url(#${id}-rust)" clip-path="url(#${id}-clip)"/>` +
    `<rect x="2" y="2" width="164" height="72" fill="none" filter="url(#${id}-fleck)" clip-path="url(#${id}-clip)"/>` +
    `<path d="${P}" fill="none" stroke="rgba(14,8,2,.8)" stroke-width="1.5" transform="translate(.8 1)"/>` +
    `<path d="${P}" fill="none" stroke="rgba(214,238,228,.45)" stroke-width="1" transform="translate(-.6 -.8)"/>` +
    `<path d="${P}" fill="none" stroke="rgba(72,46,28,.85)" stroke-width="1.8"/>` +
    // the screw holes, the two big holes and the two eyelets
    holes.map(([cx, cy, r]) => hole(cx, cy, r)).join("") + grommet(46, 38) + grommet(122, 38) +
    // the recess: a brass ring round a dark gap
    `<circle cx="84.8" cy="39" r="34" fill="rgba(0,0,0,.4)" filter="url(#${id}-b1)"/>` +
    `<circle cx="84" cy="38" r="31" fill="#1a1109"/>` +
    `<circle cx="84" cy="38" r="31.5" fill="none" stroke="url(#${id}-brass)" stroke-width="3.6"/>` +
    `<circle cx="84" cy="38" r="29.6" fill="none" stroke="rgba(8,4,0,.7)" stroke-width="1.6" transform="translate(-.5 -.7)" clip-path="url(#${id}-clip)"/>` +
    // the knob: its shadow (it stands proud) and the cream knob with its fluted edge
    `<circle class="pb-capshadow" cx="86.6" cy="41.4" r="25" fill="rgba(5,3,0,.6)" filter="url(#${id}-b1)"${baked === "in" ? ` opacity=".15"` : ""}/>` +
    `<g class="pb-cap"${capTf}>` +
    `<circle cx="84" cy="38" r="25.4" fill="none" stroke="#b9a97c" stroke-width="2.8" stroke-dasharray="1.25 1.25"/>` +
    `<circle cx="84" cy="38" r="24" fill="url(#${id}-cream)"/>` +
    `<circle cx="84" cy="38" r="24" fill="none" stroke="rgba(110,92,52,.45)" stroke-width="1"/>` +
    `<circle cx="84" cy="38" r="24" fill="none" stroke="rgba(255,255,255,.6)" stroke-width=".9" transform="translate(-.6 -.8)"/>` +
    `<ellipse cx="75" cy="28" rx="12" ry="7.5" fill="url(#${id}-spec)" transform="rotate(-24 75 28)"/>` +
    (baked === "in" ? `<circle cx="84" cy="38" r="25.4" fill="rgba(40,24,6,.13)"/>` : "") +
    `</g>` +
    `</svg>`;
}

let counter = 0;

export function createPressButton({ label = "Button", on = false, onChange } = {}) {
  ensureStyles();
  const el = document.createElement("button");
  el.type = "button";
  el.className = "pb";
  el.dataset.icon = "press";
  el.setAttribute("role", "switch");
  el.setAttribute("aria-label", label);
  el.title = label;
  el.innerHTML = plateSvg(`pb${++counter}`, "pb-plate");
  const api = {
    el,
    get on() { return el.getAttribute("aria-checked") === "true"; },
    set(v) { el.setAttribute("aria-checked", String(!!v)); },
  };
  api.set(on);
  el.addEventListener("click", () => { const next = !api.on; api.set(next); onChange?.(next); });
  return api;
}

/* the plate as an image, for canvases: one with the knob out, one with it pressed in (made once each; drawn only when loaded) */
const images = {};
function plateImage(on) {
  const k = on ? "in" : "out";
  if (!images[k]) {
    images[k] = new Image();
    images[k].src = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(plateSvg("pbc" + k, "", k));
  }
  return images[k];
}

/* the button drawn on a canvas, centred on (x, y), w by h px: the same drawing as the page's, with the knob out (off) or pressed in (on) */
export function paintPressButton(ctx, { x, y, w = 95.9, h = 43.4, on = false }) {
  const img = plateImage(on);
  if (!img.complete || !img.naturalWidth) return;
  const px = (PAD * w) / VW, py = (PAD * h) / VH;                // the image has room round the plate for its socket
  ctx.drawImage(img, x - w / 2 - px, y - h / 2 - py, w + 2 * px, h + 2 * py);
}
