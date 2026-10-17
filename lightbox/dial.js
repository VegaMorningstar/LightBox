/* The eyepiece bezel artwork, in SVG: a knurled edge, an engraved magnification scale, chrome
 * trim and a red index arrow. Units: the black ring's outer radius is 100.
 *
 * The scale lives on a disc that turns with the ring. Higher numbers sit anticlockwise of lower
 * ones, so turning the ring clockwise brings a higher number under the arrow at 12 o'clock.
 */

const NS = "http://www.w3.org/2000/svg";

export const ZOOM_MIN = 1;
export const ZOOM_MAX = 2.5;
export const DEG_PER_ZOOM = 180;          // ring rotation per 1.0× of magnification
export const GLASS_RATIO = 1.36;          // outer glass diameter / ring diameter
export const DETENTS = [1, 1.5, 2, 2.5];  // the numbered points on the scale, where the ring locks

const INK = "#ece4d0";           // paint colour, used as the fallback where filters are unavailable
const PAINT = "#ebe3cb";         // aged cream enamel
const LIGHT = 0.46;              // how far the engraved edges are offset by the light, in dial units

/* Engraved, then filled with paint, like the numbers on a vintage lens. The marks are cut into the black bezel,
 * and the enamel sits a little below the surface: the metal lip throws a soft shadow across the upper-left edge
 * of each mark, a thin highlight catches the metal on its lower-right edge, the groove shows as a fine dark line
 * around the paint, and the paint itself is slightly uneven, with tiny pits and a hand-filled edge.
 *
 * The scale turns with the ring, but the light does not, so setDialLight() re-aims the filter every time the
 * ring turns: the shadows and highlights stay on the same sides as the bezel's own lighting. */
function buildEngraving(svg) {
  const id = `lb-engrave-${Math.random().toString(36).slice(2, 7)}`;
  const defs = el("defs", {}, svg);
  const f = el("filter", {
    id, filterUnits: "userSpaceOnUse", x: -100, y: -100, width: 200, height: 200, "color-interpolation-filters": "sRGB",
  }, defs);
  const step = (name, attrs) => el(name, attrs, f);
  // a rough, hand-filled edge on the paint
  step("feTurbulence", { type: "fractalNoise", baseFrequency: 0.85, numOctaves: 2, seed: 3, result: "edgeNoise" });
  step("feDisplacementMap", { in: "SourceGraphic", in2: "edgeNoise", scale: 0.09, xChannelSelector: "R", yChannelSelector: "G", result: "shape" });
  step("feColorMatrix", { in: "shape", type: "matrix", values: "0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 1 0", result: "A" });
  // the groove: a fine dark line just outside the paint
  step("feMorphology", { in: "A", operator: "dilate", radius: 0.27, result: "wide" });
  step("feComposite", { in: "wide", in2: "A", operator: "out", result: "grooveBand" });
  step("feFlood", { "flood-color": "#000", "flood-opacity": 0.9 });
  step("feComposite", { in2: "grooveBand", operator: "in", result: "groove" });
  // the enamel, with a slight tonal variation
  step("feFlood", { "flood-color": PAINT });
  step("feComposite", { in2: "A", operator: "in", result: "paint" });
  step("feTurbulence", { type: "fractalNoise", baseFrequency: 1.3, numOctaves: 2, seed: 11, result: "grain" });
  step("feColorMatrix", { in: "grain", type: "matrix", values: "0 0 0 0 0.3  0 0 0 0 0.22  0 0 0 0 0.12  8 0 0 0 -5.9", result: "pitsRaw" });
  step("feComposite", { in: "pitsRaw", in2: "A", operator: "in", result: "pits" });
  // the metal lip's shadow across the upper-left of each mark, and the catch-light on its lower-right edge
  const off = step("feOffset", { in: "A", dx: LIGHT, dy: LIGHT, result: "shifted" });
  step("feComposite", { in: "A", in2: "shifted", operator: "out", result: "shadowBand" });
  step("feGaussianBlur", { in: "shadowBand", stdDeviation: 0.09, result: "shadowSoft" });
  step("feFlood", { "flood-color": "#2a2112", "flood-opacity": 0.72 });
  step("feComposite", { in2: "shadowSoft", operator: "in", result: "shadow" });
  step("feComposite", { in: "shadowSoft", in2: "A", operator: "in", result: "shadowClip" });
  step("feFlood", { "flood-color": "#2a2112", "flood-opacity": 0.7 });
  step("feComposite", { in2: "shadowClip", operator: "in", result: "shadowInPaint" });
  step("feComposite", { in: "shifted", in2: "A", operator: "out", result: "lipBand" });
  step("feFlood", { "flood-color": "#fff6e2", "flood-opacity": 0.5 });
  step("feComposite", { in2: "lipBand", operator: "in", result: "lip" });
  const merge = step("feMerge", {});
  ["groove", "paint", "pits", "shadowInPaint", "lip"].forEach((n) => el("feMergeNode", { in: n }, merge));
  svg.__engrave = { offset: off };
  return id;
}

/* point the light at the upper left of the screen, whatever angle the scale has been turned to */
export function setDialLight(svg, deg) {
  const o = svg.__engrave?.offset;
  if (!o) return;
  const a = (-deg * Math.PI) / 180, c = Math.cos(a), n = Math.sin(a);
  o.setAttribute("dx", (LIGHT * (c - n)).toFixed(3));      // the screen-space direction (1, 1), turned back into dial space
  o.setAttribute("dy", (LIGHT * (n + c)).toFixed(3));
}

function el(name, attrs = {}, parent) {
  const n = document.createElementNS(NS, name);
  for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v);
  parent?.append(n);
  return n;
}

const label = (z) => `${Number.isInteger(z) ? z : z.toFixed(1)}x`;

/* rotating part: knurling + scale + maker's mark */
export function buildDial() {
  const svg = el("svg", { class: "lb-dial", viewBox: "-100 -100 200 200", "aria-hidden": "true" });

  // knurled edge: dark grooves with raised ridges and a catch-light on each ridge
  const R = 97, TEETH = 120, pitch = (2 * Math.PI * R) / TEETH;
  el("circle", { r: R, fill: "none", stroke: "#040403", "stroke-width": 6.4 }, svg);
  el("circle", {
    r: R, fill: "none", stroke: "#3d3935", "stroke-width": 6.4,
    "stroke-dasharray": `${pitch * 0.48} ${pitch * 0.52}`,
  }, svg);
  el("circle", {
    r: R, fill: "none", stroke: "rgba(255,255,255,.3)", "stroke-width": 6.4,
    "stroke-dasharray": `${pitch * 0.1} ${pitch * 0.9}`, "stroke-dashoffset": -pitch * 0.04,
  }, svg);
  el("circle", { r: 93.6, fill: "none", stroke: "rgba(255,255,255,.2)", "stroke-width": 0.35 }, svg);

  // everything painted on the bezel shares one engraving filter
  const painted = el("g", { filter: `url(#${buildEngraving(svg)})` }, svg);

  // scale: a tick every 0.05×, longer every 0.25×, numbers every 0.5×
  const steps = Math.round((ZOOM_MAX - ZOOM_MIN) / 0.05);
  for (let i = 0; i <= steps; i++) {
    const z = ZOOM_MIN + i * 0.05;
    const phi = -(z - ZOOM_MIN) * DEG_PER_ZOOM;
    const major = i % 5 === 0;
    const g = el("g", { transform: `rotate(${phi})` }, painted);
    el("line", {
      x1: 0, y1: -91.6, x2: 0, y2: major ? -83.4 : -87.6,
      stroke: INK, "stroke-width": major ? 1.4 : 0.85, "stroke-linecap": "butt",
    }, g);
    if (i % 10 === 0) {
      const t = el("text", {
        transform: `rotate(${phi}) translate(0,-76.6)`,
        "text-anchor": "middle", "dominant-baseline": "central",
        fill: INK, "font-size": 9.6, "font-weight": 700,
        "font-family": '"DIN Condensed","Avenir Next Condensed","Futura","Arial Narrow",sans-serif',
        "letter-spacing": 0.3,
      }, painted);
      t.textContent = label(Number(z.toFixed(2)));
    }
  }

  // maker's mark in the blank stretch of the dial, between 2.5 and 1. Each letter is set on the
  // ring's own radius and turned to point outward, so the word bends with the dial.
  const word = "LIGHTBOX";
  const markR = 80.6;                 // concentric with the ring
  const markStep = 4.35;              // degrees between letters
  const markMid = 45;                 // middle of the blank stretch
  [...word].forEach((ch, i) => {
    const phi = markMid + (i - (word.length - 1) / 2) * markStep;
    const t = el("text", {
      transform: `rotate(${phi}) translate(0,-${markR})`,
      "text-anchor": "middle", "dominant-baseline": "central",
      fill: INK, "font-size": 8.3, "font-weight": 700,
      "font-family": '"DIN Condensed","Avenir Next Condensed","Futura","Arial Narrow",sans-serif',
    }, painted);
    t.textContent = ch;
  });
  return svg;
}

/* fixed part: chrome rims and the red index arrow (spans the whole eyepiece, glass included) */
export function buildTrim() {
  const half = 100 * GLASS_RATIO;
  const svg = el("svg", { class: "lb-trim", viewBox: `${-half} ${-half} ${half * 2} ${half * 2}`, "aria-hidden": "true" });
  const defs = el("defs", {}, svg);
  const chrome = el("linearGradient", { id: "lb-chrome", x1: 0, y1: 0, x2: 1, y2: 1 }, defs);
  [[0, "#fbf8f1"], [0.3, "#8d8984"], [0.55, "#2c2a28"], [0.8, "#cdc8be"], [1, "#77736d"]].forEach(([o, c]) =>
    el("stop", { offset: o, "stop-color": c }, chrome));

  // Etched into the glass, not stuck on it: grainy frosted red, a shaded wall on the upper-left
  // (the light comes from there) and a catch-light along the lower-right edge. No drop shadow.
  const paint = el("linearGradient", { id: "lb-etch-fill", x1: 0, y1: 0, x2: 0, y2: 1 }, defs);
  [[0, "#f2392b"], [1, "#c5170d"]].forEach(([o, c]) => el("stop", { offset: o, "stop-color": c }, paint));
  const etch = el("filter", {
    id: "lb-etch", x: "-30%", y: "-30%", width: "160%", height: "160%", "color-interpolation-filters": "sRGB",
  }, defs);
  const step = (name, attrs) => el(name, attrs, etch);
  step("feTurbulence", { type: "fractalNoise", baseFrequency: 2.6, numOctaves: 1, seed: 7, result: "noise" });
  step("feColorMatrix", { in: "noise", type: "matrix", values: "0 0 0 0 1  0 0 0 0 0.9  0 0 0 0 0.86  0 0 0 1.1 -0.5", result: "grain" });
  step("feComposite", { in: "grain", in2: "SourceAlpha", operator: "in", result: "frost" });
  step("feOffset", { in: "SourceAlpha", dx: 0.5, dy: 0.65, result: "shifted" });
  step("feComposite", { in: "SourceAlpha", in2: "shifted", operator: "out", result: "wall" });
  step("feFlood", { "flood-color": "#2c0603", "flood-opacity": 0.55 });
  step("feComposite", { in2: "wall", operator: "in", result: "wallShade" });
  step("feComposite", { in: "shifted", in2: "SourceAlpha", operator: "out", result: "lip" });
  step("feFlood", { "flood-color": "#fff6e8", "flood-opacity": 0.55 });
  step("feComposite", { in2: "lip", operator: "in", result: "lipLight" });
  const merge = step("feMerge", {});
  ["SourceGraphic", "frost", "wallShade", "lipLight"].forEach((n) => el("feMergeNode", { in: n }, merge));

  el("circle", { r: 99.3, fill: "none", stroke: "url(#lb-chrome)", "stroke-width": 1.5 }, svg);
  el("circle", { r: 71.7, fill: "none", stroke: "url(#lb-chrome)", "stroke-width": 1.5 }, svg);

  // red index arrow, etched into the outer glass and pointing at the ring at 12 o'clock
  el("path", {
    d: "M 0 -104 L -5.4 -116.4 Q 0 -118.4 5.4 -116.4 Z",
    fill: "url(#lb-etch-fill)", "fill-opacity": 0.9, filter: "url(#lb-etch)",
  }, svg);
  return svg;
}
