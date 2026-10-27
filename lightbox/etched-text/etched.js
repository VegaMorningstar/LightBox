/* etched-text: lettering engraved into a surface, drawn as vector (SVG text), so it stays sharp at any size or zoom.
 *
 *   import { createEtchedText } from "./etched-text/etched.js";
 *
 *   const sign = createEtchedText({ text: "dude with a pentax" });
 *   await sign.ready;                                  // the font has loaded and the lettering is measured
 *   parent.append(sign.el);                            // an <svg>: size it with CSS width / height, it keeps its shape
 *   const { aspect, midY } = sign.measure();           // the box's width over height, and where the middle of the small letters sits (0..1 of the height)
 *   sign.setText("new words");                         // change the words, then measure() again
 *   sign.paint(ctx, x, y, w, h);                       // the same lettering onto a canvas, for anything that redraws the surface itself (a magnifier)
 *
 * The engraving is the same as the scale marks round the volume knob: the letters are cut in dark brown, a dark band lies along the upper-left inside
 * edge of every stroke (the cut's wall in shade) and a thin pale lip catches the light along the lower-right edge. Light is from the upper left. The
 * words are one line, always together: the whole lettering scales with the box it is given, it never wraps or breaks.
 *
 * `carve: true` cuts it into wood as a real groove: a dark floor, a wall in shade on the upper left and a clean lit wall on the lower right (deeper than the etching).
 *
 * The font is Yellowtail, a slanted brush script (Apache Licence 2.0, see LICENSE-Yellowtail.txt), subset to basic Latin. Pass `fontUrl` / `fontFamily`
 * for another. Optional `swap` takes chosen letters from another installed face.
 */

const FONT_URL = new URL("./Yellowtail-latin.woff2", import.meta.url).href;
const NS = "http://www.w3.org/2000/svg";

const INK = "rgba(54, 40, 24, 0.86)";          // the dark brown of the cut, as on the knob's scale
const LIP = "#fffdf6";                          // the catch-light on the lower-right edge
const SHADE = "#000";                           // the wall in shade
const FS = 100;                                 // the type size in the drawing's own units; everything else is relative to it
const PAD = 8;                                  // room round the ink so the engraving's shading is not clipped

/* `swap` (off by default) lets a few letters come from another installed face, per letter, in the same line: { chars: "e", fullName: ["Times New Roman Italic", "TimesNewRomanPS-ItalicMT"], style: "italic" } */
export function createEtchedText({ text: initialText = "", fontFamily = "EtchedScript", fontUrl = FONT_URL, weight = "400", swap = null, ink = INK, lip = LIP, shade = SHADE, carve = false } = {}) {
  let text = initialText;
  let ready = Promise.resolve();
  const swapFamily = `${fontFamily}-swap`;
  if (typeof FontFace !== "undefined") {
    const main = new FontFace(fontFamily, `url(${fontUrl})`, { weight });
    const loads = [main.load().then((f) => { document.fonts.add(f); }).catch(() => { /* falls back to a system script face */ })];
    if (swap) {
      // a face that covers only the swapped letters (unicode-range), taken from the machine's own fonts; if it is not there, those letters stay in the main face
      const range = [...swap.chars].map((c) => `U+${c.codePointAt(0).toString(16).toUpperCase()}`).join(",");
      const src = swap.fullName.map((n) => `local("${n}")`).join(", ");
      const alt = new FontFace(swapFamily, src, { unicodeRange: range, style: swap.style });
      loads.push(alt.load().then((f) => { document.fonts.add(f); }).catch(() => { /* not installed: ignore */ }));
    }
    ready = Promise.all(loads).then(() => {});
  }
  const stack = `"${swapFamily}", "${fontFamily}", "Snell Roundhand", "Brush Script MT", cursive`;
  const probe = document.createElement("canvas").getContext("2d");

  /* the lettering's real extents (the ink, not the advance) in the drawing's units */
  function extents() {
    probe.font = `${weight} ${FS}px ${stack}`;
    const m = probe.measureText(text), x = probe.measureText("x");
    const left = m.actualBoundingBoxLeft, right = m.actualBoundingBoxRight, up = m.actualBoundingBoxAscent, down = m.actualBoundingBoxDescent;
    return { left, up, W: left + right + 2 * PAD, H: up + down + 2 * PAD, base: PAD + up, xh: x.actualBoundingBoxAscent };
  }

  const el = document.createElementNS(NS, "svg");
  el.setAttribute("aria-hidden", "true");
  el.setAttribute("focusable", "false");
  const id = `et-${Math.random().toString(36).slice(2, 7)}`;
  const filter = carve
    // CARVED into wood: a real groove has a floor and two walls. The wall on the upper left is in shade (the light is from the upper left, so it faces away), the wall on the
    // lower right faces the light and shows the clean, warm, freshly cut wood; a faint catch-light lies on the surface just outside it. The cut is deeper than an etching,
    // so the walls are wider.
    ? `<filter id="${id}" filterUnits="userSpaceOnUse" x="-20" y="-20" width="2000" height="400" color-interpolation-filters="sRGB">` +
      `<feOffset in="SourceAlpha" dx="2.2" dy="2.7" result="s"/><feComposite in="SourceAlpha" in2="s" operator="out" result="sb"/><feGaussianBlur in="sb" stdDeviation=".8" result="ss"/>` +
      `<feFlood flood-color="#000" flood-opacity=".82"/><feComposite in2="ss" operator="in" result="shadeWall"/>` +
      `<feOffset in="SourceAlpha" dx="-3.2" dy="-3.9" result="l"/><feComposite in="SourceAlpha" in2="l" operator="out" result="lb"/><feGaussianBlur in="lb" stdDeviation=".7" result="ls"/>` +
      `<feFlood flood-color="#f2c48a" flood-opacity=".95"/><feComposite in2="ls" operator="in" result="litWall"/>` +
      `<feOffset in="SourceAlpha" dx="1.6" dy="2" result="o"/><feComposite in="o" in2="SourceAlpha" operator="out" result="ob"/><feGaussianBlur in="ob" stdDeviation=".7" result="os"/>` +
      `<feFlood flood-color="#ffd9a6" flood-opacity=".4"/><feComposite in2="os" operator="in" result="lipL"/>` +
      `<feMerge><feMergeNode in="lipL"/><feMergeNode in="SourceGraphic"/><feMergeNode in="litWall"/><feMergeNode in="shadeWall"/></feMerge></filter>`
    : `<filter id="${id}" filterUnits="userSpaceOnUse" x="-20" y="-20" width="2000" height="400" color-interpolation-filters="sRGB">` +
    // a dark band along the upper-left inside edge of each stroke: the strokes shifted down-right, taken away from the strokes
    `<feOffset in="SourceAlpha" dx="1.5" dy="1.9" result="s"/><feComposite in="SourceAlpha" in2="s" operator="out" result="band"/><feGaussianBlur in="band" stdDeviation="0.5" result="bandSoft"/>` +
    `<feFlood flood-color="${shade}" flood-opacity=".9"/><feComposite in2="bandSoft" operator="in" result="shadow"/><feComposite in="shadow" in2="SourceAlpha" operator="in" result="shadowIn"/>` +
    // a thin light lip just outside the lower-right edge: the strokes shifted down-right, minus the strokes
    `<feOffset in="SourceAlpha" dx="1.8" dy="2.3" result="s2"/><feComposite in="s2" in2="SourceAlpha" operator="out" result="lipBand"/><feGaussianBlur in="lipBand" stdDeviation="0.6" result="lipSoft"/>` +
    `<feFlood flood-color="${lip}" flood-opacity=".95"/><feComposite in2="lipSoft" operator="in" result="lip"/>` +
    `<feMerge><feMergeNode in="lip"/><feMergeNode in="SourceGraphic"/><feMergeNode in="shadowIn"/></feMerge></filter>`;
  const floor = carve ? "rgba(118, 62, 26, .55)" : ink;                      // a carved letter's floor: the dark of the cut, a little darker than the wood round it
  el.innerHTML = `<defs>${filter}</defs>` +
    `<g filter="url(#${id})"><text fill="${floor}" font-size="${FS}" font-weight="${weight}" font-family='${stack.replace(/'/g, "")}' xml:space="preserve"></text></g>`;
  const nodes = [...el.querySelectorAll("text")];
  nodes.forEach((n) => { n.textContent = text; });

  /* lay the lettering out in its own units (call after the font is ready; safe to call again) */
  function layout() {
    const k = extents();
    el.setAttribute("viewBox", `0 0 ${k.W} ${k.H}`);
    for (const n of nodes) {
      n.setAttribute("x", PAD + k.left);
      n.setAttribute("y", k.base);
    }
    return k;
  }
  layout();
  ready.then(layout);

  function measure() {
    const k = extents();
    return { aspect: k.W / k.H, midY: (k.base - k.xh / 2) / k.H };
  }

  /* the same engraving drawn onto a canvas context, into the box x, y, w, h (css px) */
  function paint(ctx, x, y, w, h) {
    const k = extents(), u = w / k.W;                                  // css px per drawing unit
    ctx.save();
    ctx.translate(x, y);
    ctx.scale(u, u);
    ctx.font = `${weight} ${FS}px ${stack}`;
    ctx.textBaseline = "alphabetic";
    const bx = PAD + k.left, by = k.base;
    if (carve) {                                                        // carved: the floor, then (below) the lit wall and the shaded wall
      ctx.fillStyle = "rgba(255,217,166,.4)"; ctx.fillText(text, bx + 1.6, by + 2);                      // a catch-light on the surface just outside the lower right
      ctx.fillStyle = floor; ctx.fillText(text, bx, by);
    } else {
      ctx.fillStyle = lip; ctx.globalAlpha = 0.85; ctx.fillText(text, bx + 1.8, by + 2.3);   // the lip, under
      ctx.globalAlpha = 1; ctx.fillStyle = ink; ctx.fillText(text, bx, by);                   // the cut
    }
    // the shaded wall: the cut's own shape with its lower-right part taken away, drawn over the cut
    ctx.save(); ctx.beginPath(); ctx.rect(0, 0, k.W, k.H); ctx.clip();
    const c = document.createElement("canvas"); c.width = Math.max(1, Math.ceil(k.W * u * 2)); c.height = Math.max(1, Math.ceil(k.H * u * 2));
    const g = c.getContext("2d"); g.scale(u * 2, u * 2); g.font = ctx.font; g.textBaseline = "alphabetic";
    const wall = (col, dx, dy, alpha) => {                              // a band along the inside of the letter: its shape with the same shape moved (dx, dy) taken away
      g.clearRect(0, 0, k.W, k.H);
      g.globalCompositeOperation = "source-over"; g.fillStyle = col; g.fillText(text, bx, by);
      g.globalCompositeOperation = "destination-out"; g.fillText(text, bx + dx, by + dy);
      g.globalCompositeOperation = "source-over";
      ctx.globalAlpha = alpha; ctx.drawImage(c, 0, 0, k.W, k.H);
    };
    if (carve) { wall("#f2c48a", -3.2, -3.9, 0.95); wall("#000", 2.2, 2.7, 0.82); }     // the lit wall on the lower right, the shaded one on the upper left
    else wall(shade, 1.5, 1.9, 0.8);
    ctx.restore();
    ctx.restore();
  }

  /* change the words (the box is re-measured; ask measure() again afterwards) */
  function setText(t) { text = String(t); nodes.forEach((n) => { n.textContent = text; }); layout(); }

  return { el, ready, measure, paint, setText, get text() { return text; } };
}
