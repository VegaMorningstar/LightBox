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

const INK = "#ece4d0";

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

  // scale: a tick every 0.05×, longer every 0.25×, numbers every 0.5×
  const steps = Math.round((ZOOM_MAX - ZOOM_MIN) / 0.05);
  for (let i = 0; i <= steps; i++) {
    const z = ZOOM_MIN + i * 0.05;
    const phi = -(z - ZOOM_MIN) * DEG_PER_ZOOM;
    const major = i % 5 === 0;
    const g = el("g", { transform: `rotate(${phi})` }, svg);
    el("line", {
      x1: 0, y1: -91.6, x2: 0, y2: major ? -83.4 : -87.6,
      stroke: INK, "stroke-width": major ? 1.15 : 0.6, "stroke-linecap": "butt",
    }, g);
    if (i % 10 === 0) {
      const t = el("text", {
        transform: `rotate(${phi}) translate(0,-76.6)`,
        "text-anchor": "middle", "dominant-baseline": "central",
        fill: INK, "font-size": 8.2, "font-weight": 600,
        "font-family": '"DIN Condensed","Avenir Next Condensed","Futura","Arial Narrow",sans-serif',
        "letter-spacing": 0.3,
      }, svg);
      t.textContent = label(Number(z.toFixed(2)));
    }
  }

  // maker's mark in the blank stretch of the dial, between 2.5 and 1
  const arcR = 81.5;
  const pt = (deg) => `${(arcR * Math.sin((deg * Math.PI) / 180)).toFixed(3)} ${(-arcR * Math.cos((deg * Math.PI) / 180)).toFixed(3)}`;
  const arcId = `lb-arc-${Math.random().toString(36).slice(2, 8)}`;
  el("path", { id: arcId, d: `M ${pt(8)} A ${arcR} ${arcR} 0 0 1 ${pt(82)}`, fill: "none" }, svg);
  const mark = el("text", {
    fill: INK, "fill-opacity": 0.85, "font-size": 5.2, "font-weight": 600, "letter-spacing": 1.6,
    "text-anchor": "middle", "dominant-baseline": "central",
    "font-family": '"DIN Condensed","Avenir Next Condensed","Futura","Arial Narrow",sans-serif',
  }, svg);
  const tp = el("textPath", { href: `#${arcId}`, startOffset: "50%" }, mark);
  tp.textContent = "LIGHTBOX";
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
