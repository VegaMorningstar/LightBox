/* LightBox — contact-sheet-on-a-light-box effect.
 *
 *   import { mountLightBox } from "./lightbox/lightbox.js";
 *   mountLightBox(document.querySelector("#sheet"), { photos: ["a.jpg", "b.jpg"], zoom: 1.2, shadow: 1.8, shadowFade: 0.85, volumes: { place: 0.3, drag: 0.3 }, filmDrag: 1, filmFlutter: 1, stacking: 1, panelFalloff: 1, panelGlow: 1, panelGrain: 1, lightBleed: 1 });
 *
 * The sheet shows inverted "negatives". A draggable eyepiece sits on top of it: liquid glass
 * around a black bezel (turn it to zoom), and a clear inner lens that shows the area underneath
 * magnified, and as a positive.
 */

import { createSounds, DEFAULT_VOLUMES, GLASS_DRAG_ENABLED } from "./sounds.js";
import { buildDial, buildTrim, setDialLight, DEG_PER_ZOOM, DETENTS, GLASS_RATIO, ZOOM_MAX, ZOOM_MIN } from "./dial.js";
import { createGlass, createLens } from "./glass.js";
import { createBleed, paintHoles } from "./bleed.js";
import { createSocketButton, mountSocketCorner, setCovered, setPressed, ICONS } from "./socket-buttons/buttons.js";
import { createSocketKnob } from "./socket-buttons/knob.js";
import { createEtchedText } from "./etched-text/etched.js";
import { createStartScreen } from "./start-screen/start-screen.js";
import { createSpecks } from "./dust.js";
import { createFilm } from "./film.js";
import { bakeEdge, buildFilmFilter, createLensView, createNegView, paintGlowLayer, clipOutButtons, frameQuads, holeSpots, paintOverlay, parseColor, readScene, stripQuad, warmNegatives } from "./raster.js";

const STRIP_DY = [0, 0.34, 0.12, 0.5, 0.05, 0.27];   // per-strip stagger, in frame widths
const STRIP_ROT = [-0.3, 0.25, -0.15, 0.35, -0.25, 0.15]; // per-strip tilt, degrees

const columnsFor = (w) => (w >= 1100 ? 6 : w >= 800 ? 4 : w >= 520 ? 3 : 2);

/* How many photos each strip gets. Real film comes in strips of five or six frames, cut from a roll, and the
 * tail of a roll is whatever is left over. So strips are cut at five or six frames, in a fixed uneven mix. What
 * remains at the end is its own, shorter strip if it is three frames or more. A remainder of one or two would
 * look like a random scrap, so those frames are added to other strips instead, one each, starting with the
 * shortest. The split depends only on the photo count, so every copy of the sheet (page, ghost, multiply)
 * agrees. */
const CUTS = [6, 5, 6, 5, 5, 6, 6, 5];
function stripSizes(total) {
  const sizes = [];
  let left = total, i = 0;
  while (left >= 3) {
    const cut = CUTS[i++ % CUTS.length];
    const take = left <= 6 ? left : cut;           // a last strip of up to six takes everything that is left
    sizes.push(take);
    left -= take;
  }
  if (left > 0) {                                  // one or two stray frames
    if (sizes.length >= 2) {
      const order = sizes.map((n, k) => [n, k]).sort((a, b) => a[0] - b[0] || a[1] - b[1]);
      for (let k = 0; k < left; k++) sizes[order[k][1]]++;
    } else if (sizes.length === 1) {
      const all = sizes[0] + left;                 // only one strip so far: a little longer, or two even halves if too long
      if (all > 7) { sizes[0] = Math.ceil(all / 2); sizes.push(Math.floor(all / 2)); } else sizes[0] = all;
    } else {
      sizes.push(left);
    }
  }
  return sizes;
}

function buildSheet(photos, fw, className) {
  const sheet = document.createElement("div");
  sheet.className = `lb-sheet ${className}`;
  sheet.style.setProperty("--fw", `${fw}px`);
  sheet.setAttribute("aria-hidden", className === "lb-neg" ? "false" : "true");

  const sizes = stripSizes(photos.length);
  let first = 0;
  for (let s = 0; s < sizes.length; s++) {
    const slice = photos.slice(first, first + sizes[s]);
    const start = first;
    first += sizes[s];
    if (!slice.length) continue;

    const strip = document.createElement("div");
    strip.className = "lb-strip";
    strip.style.setProperty("--dy", STRIP_DY[s % STRIP_DY.length]);
    strip.style.setProperty("--rot", `${STRIP_ROT[s % STRIP_ROT.length]}deg`);

    slice.forEach((src, i) => {
      const n = start + i + 1;
      const frame = document.createElement("div");
      frame.className = "lb-frame";

      const box = document.createElement("div");
      box.className = "lb-img";
      const img = new Image();
      img.alt = className === "lb-neg" ? `Photo ${n}` : "";
      img.decoding = "async";
      img.onload = () => img.classList.add("is-loaded");
      img.dataset.full = src;                       // the original; the film itself only needs the small version
      img.onerror = () => { if (img.src !== new URL(src, location.href).href) img.src = src; };   // no thumbnail: use the original
      img.src = thumbOf(src);
      box.append(img);

      const l = document.createElement("span");
      l.className = "lb-tag l";
      l.textContent = "LIGHTBOX 400";
      const r = document.createElement("span");
      r.className = "lb-tag r";
      r.textContent = `▸${String(n).padStart(2, "0")}A`;

      frame.append(box, l, r);
      const cell = document.createElement("div");
      cell.className = "lb-cell";
      cell.append(frame);
      strip.append(cell);
    });
    sheet.append(strip);
  }
  return sheet;
}

/* the small version of a photo: sample-photos/01.jpg -> sample-photos/thumb/01.jpg (see tools/make-images.sh) */
const thumbOf = (src) => src.replace(/([^/]+)$/, "thumb/$1");

const div = (cls) => Object.assign(document.createElement("div"), { className: cls });

function buildEyepiece() {
  const el = div("lb-loupe");
  el.tabIndex = 0;
  el.setAttribute("role", "img");
  el.setAttribute("aria-label", "Eyepiece. Drag it to move it. Double-press and hold the black ring, then turn, or press plus and minus, to change magnification. Arrow keys also move it.");
  const skirt = div("lb-skirt");            // shadow + fallback look for the glass
  const refract = document.createElement("canvas");
  refract.className = "lb-refract";         // liquid-glass ring, drawn by glass.js
  const ring = div("lb-ring");             // the black bezel: turn it to change magnification
  const dial = buildDial();
  ring.append(dial);
  const glass = div("lb-glass");
  const lens = document.createElement("canvas");
  lens.className = "lb-lens";               // liquid-glass lens, drawn by glass.js
  const mag = div("lb-mag");                // plain-DOM fallback when WebGL2 is missing
  mag.setAttribute("aria-hidden", "true");
  glass.append(lens, mag);
  el.append(skirt, refract, ring, glass, buildTrim());
  return { el, refract, ring, dial, glass, lens, mag };
}

/* is a point inside a convex four-corner outline? */
function insideQuad(q, x, y) {
  for (let i = 0; i < 4; i++) {
    const [ax, ay] = q[i], [bx, by] = q[(i + 1) % 4];
    if ((bx - ax) * (y - ay) - (by - ay) * (x - ax) < 0) return false;
  }
  return true;
}

/* Two push buttons (socket-buttons/) in the panel's top right corner: reset, and (when `sliders` is on) the sliders, whose
   panel drops down at the top left, closed by default. There is no bar. */
function buildControls(rows, { onOrganize, onButton, sliders = true, volume = null } = {}) {
  const nav = document.createElement("nav");
  nav.className = "lb-nav";
  nav.setAttribute("aria-label", "Sliders");

  const toggle = createSocketButton({ icon: ICONS.sliders, label: "Sliders", onPress: onButton });
  toggle.setAttribute("aria-expanded", "false");
  const organize = createSocketButton({
    icon: ICONS.reset,
    label: "Organize: put the film back where it started",
    onPress: onButton,
    onClick: () => onOrganize?.(),
  });

  const panel = div("lb-nav-panel");
  panel.id = `lb-sliders-${Math.random().toString(36).slice(2, 7)}`;
  panel.hidden = true;
  toggle.setAttribute("aria-controls", panel.id);
  const setOpen = (open) => {
    panel.hidden = !open;
    toggle.setAttribute("aria-expanded", String(open));
    setPressed(toggle, open);
  };
  toggle.addEventListener("click", () => setOpen(panel.hidden));
  // a press anywhere else closes it, so it never has to be put away by hand
  document.addEventListener("pointerdown", (e) => {
    if (!panel.hidden && !e.target.closest(".lb-nav-panel") && !toggle.contains(e.target)) setOpen(false);
  }, true);
  document.addEventListener("keydown", (e) => { if (e.key === "Escape" && !panel.hidden) setOpen(false); });

  const setters = {};
  let lastGroup = null;
  for (const { group, key, name, min, max, step, value, onInput, type = "range" } of rows) {
    if (sliders && group && group !== lastGroup) {
      const h = document.createElement("div");
      h.className = "lb-nav-group";
      h.textContent = group;
      panel.append(h);
      lastGroup = group;
    }
    const label = document.createElement("label");
    const text = document.createElement("span");
    text.textContent = name;
    const input = document.createElement("input");
    if (type === "check") {                                    // an on / off switch (the sign's "Show text")
      Object.assign(input, { type: "checkbox", checked: !!value });
      input.addEventListener("change", () => onInput(input.checked));
      setters[key] = (v) => { input.checked = !!v; };
      label.append(text, input);
      if (sliders) panel.append(label);
      continue;
    }
    if (type === "button") {                                   // a push button in the list (e.g. "show the start screen again")
      const b = document.createElement("button");
      b.type = "button"; b.textContent = "Play";
      b.addEventListener("click", () => onInput());
      label.append(text, b);
      if (sliders) panel.append(label);
      continue;
    }
    if (type === "text") {                                     // a line of words (the sign's text)
      Object.assign(input, { type: "text", value, maxLength: 60, spellcheck: false, autocomplete: "off" });
      input.addEventListener("input", () => onInput(input.value));
      setters[key] = (v) => { input.value = v; };
      label.append(text, input);
      if (sliders) panel.append(label);
      continue;
    }
    Object.assign(input, { type: "range", min, max, step, value });
    const out = document.createElement("output");
    const show = (v) => { out.textContent = Number(v).toFixed(2); };
    show(value);
    input.addEventListener("input", () => { show(input.value); onInput(Number(input.value)); });
    setters[key] = (v) => { input.value = v; show(v); };
    label.append(text, input, out);
    if (sliders) panel.append(label);
  }
  nav.append(...(sliders ? [panel] : []));
  // the volume knob: it sits in the top left corner of the panel and sets the page's overall volume (it clicks as it turns, as the eyepiece ring does)
  const knob = volume ? createSocketKnob({ label: "Volume", min: 0, max: 2, value: volume.value, ...volume.sounds, onInput: (v) => { volume.onInput(v); setters.vol_master?.(v); } }) : null;
  if (knob) setters.vol_master_knob = (v) => knob.set(v);
  return { wrap: nav, corner: [...(sliders ? [toggle] : []), organize], left: knob ? [knob.el] : [], setters };
}

export function mountLightBox(root, { photos, zoom = 1.2, shadow = 1.8, shadowFade = 0.85, volumes = {}, outerGlass = {}, filmDrag = 1, filmFlutter = 1, stacking = 1, panelFalloff = 1.25, panelGlow = 1, panelGrain = 1, lightBleed = 1, lightSeep = 1.6, seepSpread = 10, signText = "dude with a pentax", showSign = false, startScreen = true, startLength = 1600, size, controls = true, sliders = true } = {}) {
  root.classList.add("lb-root");
  const stage = div("lb-stage");
  root.replaceChildren(stage);
  // The start screen (start-screen/): the page opens with the light off, and the light comes on once everything is drawn (`sceneReady`).
  let markSceneReady = () => {};
  const sceneReady = new Promise((resolve) => { markSceneReady = resolve; });
  const start = startScreen ? createStartScreen({ host: stage, ready: Promise.all([sceneReady, document.fonts?.ready]), play: () => sounds.strobe(), length: startLength }) : null;
  if (start) stage.append(...start.els);
  root.append(buildFilmFilter("lb-film-alpha", parseColor(getComputedStyle(root).getPropertyValue("--lb-bg").trim() || "#eadec6")));

  // the outer glass (PA): 0 = a dome, 1 = a frustum widest at its base (see glass.js)
  const pa = { shape: 1, slope: 60, wall: 1, index: 1.49, dispersion: 0, reflect: 0.5, lip: 6, lipK: 1, cast: 1, ringShade: 0.6, ringShadeOff: 1, squig: 0.8, ...outerGlass };
  const loupe = buildEyepiece();
  // The light box's own unevenness lies over the board and the film. Falloff, grain and dust all darken the light, so
  // they share one canvas; the glow, which brightens it, is another.
  const overlayEl = document.createElement("canvas");
  overlayEl.className = "lb-overlay";
  const glowEl = document.createElement("canvas");
  glowEl.className = "lb-glow";
  const seepFx = createBleed();             // light from open board spilling onto the edges of the film (see bleed.js)
  const seepEl = seepFx.canvas;
  seepEl.className = "lb-seep";
  let edgeEl = document.createElement("canvas");         // the dark room around the lit panel, the fall of its light and the rim's highlight (bakeEdge)
  edgeEl.className = "lb-edge";
  const dustEl = document.createElement("canvas");    // dust on the board and film borders (kept off the photographs)
  dustEl.className = "lb-dust";
  let dustKey = "";
  const holesEl = document.createElement("canvas");   // the lit sprocket holes, drawn sharp at the screen's own pixel density
  holesEl.className = "lb-seep";
  let holesKey = "";
  let seep = lightSeep, spread = seepSpread;
  let specks = null;
  let edgeSize = { m: 14, f: 40 };          // the dark margin and the light's falloff inside the panel's rim (see the stylesheet)
  // The sign: lettering etched into the panel between the volume knob and the buttons (etched-text/). It lies on the surface, under the film,
  // and the glasses draw it too (see updateCovered, which hands them its box).
  const SIGN_WORDS = "dude with a pentax";
  let signOn = showSign && signText !== "";                           // "Show text" in the sliders menu; it starts hidden unless `showSign` is set
  const sign = createEtchedText({ text: signText || SIGN_WORDS });
  const signEl = sign?.el ?? document.createElement("div");          // an SVG: vector, so it stays sharp at any zoom
  signEl.setAttribute("class", "lb-sign");
  let signBox = null;                         // {x, y, w, h}: its centre and size, in stage (sheet) px; null when there is no room for it
  let cornerEls = [], cornerButtons = [];   // the push buttons, which lie on the panel under the film
  let grain = panelGrain;
  let falloff = panelFalloff;
  let glow = panelGlow;
  let stacking_ = stacking;
  let bleed = lightBleed;
  const glass = createGlass(loupe.refract);
  const lens = createLens(loupe.lens);
  if (!glass || !lens) loupe.el.classList.add("lb-nogl");

  const goal = { x: 0, y: 0 };
  const cur = { x: 0, y: 0 };
  let D = 240;     // black ring diameter
  let Do = 336;    // outer glass diameter
  let G = 180;     // inner glass diameter
  let placed = false;
  let dragging = false;
  // Double-pressing the glass and holding lifts the eyepiece off the film and the board; letting go sets it back down. `lift` eases
  // between 0 (resting) and 1 (held up) and drives how much the glass sees and its shadow. While it is up it has no
  // effect on the film and makes no sliding or crackling sounds.
  let lift = 0, liftGoal = 0;
  let liftHeight = 1.25;               // how high it is lifted (a multiple of the old lift), for everything that depends on height
  let eyeMass = 1;                     // how heavy the eyepiece is: it resists being carried by film, and makes a strip under it harder to drag
  let carriedAt = -1e9;                // when film last carried the eyepiece
  let filmDragsEye = 1;                // how much film moved under the eyepiece drags the eyepiece with it
  const LOUPE_DRAG = 0.004;            // per ms, where the film grips it fully
  let dropCarry = 1.3;                 // how much of its speed a lifted eyepiece keeps when let go (it carries on along the way it was moving)
  let landShake = 1;                   // how hard the surface and the film shiver when the eyepiece is set down
  let shakeY = 0, shakeX = 0, shakeVY = 0, shakeVX = 0;   // the board's own shiver (a few tenths of a pixel)
  let liftTime = 200;                  // ms to reach the top; setting it down takes about half that
  let glassTap = null, glassPress = null;   // taps on the glass, to tell a double press from a single one
  const LIFT_AREA = 0.4;               // extra area the lens takes in at full lift
  const LIFT_SCALE = 0.045;            // and how much closer (bigger) the eyepiece looks
  const smooth = (x) => x * x * (3 - 2 * x);
  let raf = 0;
  let layoutId = 0;
  // Quality control. The two glass passes are the costly part of a frame, and how many pixels they shade is what a
  // slow device cannot afford. While the eyepiece is moving, the frame time is watched: if it stays too slow, the
  // glass passes are drawn with fewer pixels (the outer glass first, since it is a frosted, bent view anyway, and
  // the lens only a little); if it stays comfortably fast, they step back up. A fast device never leaves level 0.
  // Add ?fixedquality to the address to switch this off.
  const Q_LEVELS = [1, 0.8, 0.65, 0.5, 0.4];
  // ?fixedquality stays at full quality; ?quality=N (0 = full ... 4 = lowest) stays at that level, to preview the look
  const qParams = new URLSearchParams(location.search);
  const qForced = qParams.has("quality") ? Math.max(0, Math.min(Q_LEVELS.length - 1, parseInt(qParams.get("quality"), 10) || 0)) : null;
  let qLevel = qForced ?? 0;
  const adaptive = qForced === null && !qParams.has("fixedquality");
  const gov = { frames: [], good: 0, patience: 5, lastUp: -1e9 };
  document.addEventListener("visibilitychange", () => { gov.frames.length = 0; });
  const qOuter = () => Q_LEVELS[qLevel];
  const qLens = () => 0.5 + 0.5 * Q_LEVELS[qLevel];
  let view = null;     // magnified window onto the lit sheet, drawn for the lens
  let negView = null;  // window onto the negative sheet, drawn for the outer glass
  let negSide = 0;
  let film = null;     // friction between eyepiece, film and board
  let gripping = false;                // a film strip is being held
  let sceneRef = null;                 // the scene the glasses draw, so sliders can update it
  const filmCfg = { push: filmDrag, flutter: filmFlutter, rub: 0.5, eyeLoad: 0.4, carry: 0.6, slap: 0.35 };   // rub: how much a strip moved over another drags the one beneath
  const eyeV = { x: 0, y: 0 };         // eyepiece velocity in px per ms, smoothed
  let fade = shadowFade;
  let lensPad = 0;

  const clamp = () => {
    goal.x = Math.max(0, Math.min(stage.clientWidth, goal.x));
    goal.y = Math.max(0, Math.min(stage.offsetHeight, goal.y));
  };

  // light seeping onto the film: the soft spill from the open board, and the lit sprocket holes
  function paintSeep() {
    const sc = sceneRef;
    const quads = sc.strips.map(stripQuad);
    seepFx.update(sc.W, sc.H, quads, spread, seep);
    const holes = holeSpots(sc.strips);
    sc.holeExclude = sc.strips.flatMap((s) => s.over);       // where film lies over film, no light comes up through a hole
    sc.holes = holes; sc.holeQuads = quads; sc.seepSpread = spread; sc.seepStrength = seep;
    const key = [sc.W, sc.H, spread, seep, ...holes.map((h) => `${Math.round(h.x)},${Math.round(h.y)},${h.k}`), "ov", ...sc.holeExclude.flat(2).map((v) => Math.round(v))].join("|");
    if (key === holesKey) return;
    holesKey = key;
    const dpr = overlayDpr();
    if (holesEl.width !== Math.round(sc.W * dpr) || holesEl.height !== Math.round(sc.H * dpr)) {
      holesEl.width = Math.round(sc.W * dpr); holesEl.height = Math.round(sc.H * dpr);
    }
    const c = holesEl.getContext("2d");
    c.setTransform(1, 0, 0, 1, 0, 0);
    c.clearRect(0, 0, holesEl.width, holesEl.height);
    c.setTransform(dpr, 0, 0, dpr, 0, 0);
    paintHoles(c, holes, quads, spread, seep, null, sc.holeExclude);
  }

  // The buttons lie on the panel, so film can slide over them; a button with film over any part of it cannot be pressed (a
  // press there takes hold of the film instead).
  /* set the sign between the knob and the nearest button, centred on the knob's height; hide it when the gap is too narrow for it */
  function placeSign() {
    signBox = null;
    signEl.style.display = "none";
    if (!signOn || !sign.text.trim() || !cornerButtons.length) return;
    const origin = stage.getBoundingClientRect();
    const knob = cornerButtons.find((b) => b.dataset.icon === "knob");
    const rights = cornerButtons.filter((b) => b.dataset.icon !== "knob");
    if (!knob || !rights.length) return;
    const k = knob.getBoundingClientRect();
    // between the knob's scale (which reaches about 14 px past the knob) and the nearest button's socket, with a little air on each side
    const left = k.right - origin.left + 28, right = Math.min(...rights.map((b) => b.getBoundingClientRect().left)) - origin.left - 20;
    const { aspect, midY } = sign.measure();                               // the lettering's box, width over height, and where the middle of its small letters is
    // centred on the screen (the panel's middle), not on the gap, so the room it has is twice the smaller distance from the middle to the knob's side or the buttons' side
    const cx = origin.width / 2, room = 2 * Math.min(cx - left, right - cx);
    if (room < 60) return;
    // the four words stay together on one line: the whole lettering gets smaller to fit, it never wraps
    const h = Math.min(52, 0.8 * room / aspect), w = h * aspect;
    // the middle of the small letters level with the middle of the knob, so it reads as one line with it
    const kc = k.top - origin.top + k.height / 2;
    const top = kc - midY * h;
    Object.assign(signEl.style, { display: "block", left: `${cx - w / 2}px`, top: `${top}px`, width: `${w}px`, height: `${h}px` });
    signBox = { x: cx, y: top + h / 2, w, h };
  }
  /* put the sign where it belongs after it was switched on or off or its words changed, and redraw what shows it (the glass views) */
  function refreshSign() { placeSign(); if (sceneRef) { render(); kick?.(); } }
  sign.ready.then(() => { if (cornerButtons.length) { placeSign(); if (sceneRef) render(); } });

  function updateCovered() {
    if (!cornerButtons.length) return;
    const origin = stage.getBoundingClientRect();
    const quads = sceneRef.strips.map(stripQuad);
    const shown = [];
    for (const b of cornerButtons) {
      const r = b.getBoundingClientRect();
      const cx = r.left - origin.left + r.width / 2, cy = r.top - origin.top + r.height / 2, rad = r.width / 2;
      let covered = false;
      for (let k = 0; k < 9 && !covered; k++) {                 // the centre and eight points round its edge
        const a = (k - 1) * (Math.PI / 4), px = k ? cx + Math.cos(a) * rad : cx, py = k ? cy + Math.sin(a) * rad : cy;
        covered = quads.some((q) => insideQuad(q, px, py));
      }
      setCovered(b, covered);
      shown.push({ x: cx, y: cy, size: r.width, icon: b.dataset.icon, angle: +(b.dataset.angle ?? 0) });
    }
    if (signBox) shown.push({ x: signBox.x, y: signBox.y, size: signBox.h, icon: "sign", w: signBox.w, h: signBox.h, paint: (ctx, x, y, w, h) => sign.paint(ctx, x, y, w, h) });
    sceneRef.buttons = shown;       // the glasses draw them too, under the film
  }

  // The dust lies on the panel, so it stays put while the film slides over it; it is drawn again whenever a photograph
  // moves, leaving each photograph clean.
  function paintDust() {
    const sc = sceneRef;
    if (!specks || !sc) return;
    const frames = sc.strips.flatMap(frameQuads);
    sc.frames = frames;
    const key = sc.W + "|" + sc.H + "|" + (sc.buttons ?? []).map((b) => `${Math.round(b.x)},${Math.round(b.y)}`).join(";") + "|" + frames.map((q) => `${Math.round(q[0][0])},${Math.round(q[0][1])},${Math.round(q[2][0])},${Math.round(q[2][1])}`).join("|");
    if (key === dustKey) return;
    dustKey = key;
    const dpr = overlayDpr();
    if (dustEl.width !== Math.round(sc.W * dpr) || dustEl.height !== Math.round(sc.H * dpr)) {
      dustEl.width = Math.round(sc.W * dpr); dustEl.height = Math.round(sc.H * dpr);
    }
    const c = dustEl.getContext("2d");
    c.setTransform(1, 0, 0, 1, 0, 0);
    c.clearRect(0, 0, dustEl.width, dustEl.height);
    c.setTransform(dpr, 0, 0, dpr, 0, 0);
    const clipped = clipOutButtons(c, sc.buttons);          // no dust on the buttons, the knob or its markings
    specks.draw(c, null, frames);
    if (clipped) c.restore();
  }

  const render = () => {
    if (sceneRef) { paintSeep(); updateCovered(); paintDust(); }
    const L = smooth(lift) * liftHeight;
    loupe.el.style.transform = `translate(${cur.x - Do / 2}px, ${cur.y - Do / 2}px) scale(${(1 + LIFT_SCALE * L).toFixed(4)})`;
    loupe.el.style.setProperty("--lift", L.toFixed(3));
    if (lens && view) {
      view.render(cur.x, cur.y, zoom / (1 + LIFT_AREA * L));     // lifted, the lens shows more of the sheet
      // the aberration zone is the strip the ring's shadow covers, so it follows the Fade slider
      const edge = Math.max(6, Math.min(G * 0.45, D * 0.082 * fade));
      lens.draw(view.canvas, lensPad, edge, bleed);
    } else if (!lens) {
      // keep the point under the eyepiece centred in the glass, scaled up
      loupe.mag.style.transform = `translate(${G / 2 - zoom * cur.x}px, ${G / 2 - zoom * cur.y}px) scale(${zoom})`;
    }
    if (glass && negView) {
      negView.render(cur.x, cur.y, 1);
      glass.draw(negView.canvas, negSide, D / 2, L, pa);
    }
  };

  function setQuality(level) {
    qLevel = Math.max(0, Math.min(Q_LEVELS.length - 1, level));
    glass?.resize(Do, qOuter());
    lens?.resize(G, qLens());
    negView?.setDpr(glass.dpr);
    view?.setDpr(lens.dpr);
    root.dataset.quality = String(Q_LEVELS[qLevel]);
    render();
  }

  function govern(raw) {
    if (raw > 1500) { gov.frames.length = 0; return; }       // a long pause (a tab switch, say), not a measure of the drawing
    gov.frames.push(raw);
    if (gov.frames.length < 12) return;
    const sorted = gov.frames.slice().sort((a, b) => a - b);
    const median = sorted[sorted.length >> 1];
    gov.frames.length = 0;
    const now = performance.now();
    if (median > 30 && qLevel < Q_LEVELS.length - 1) {          // slower than about 33 fps: draw the glass with fewer pixels
      if (now - gov.lastUp < 4000) gov.patience = Math.min(40, gov.patience * 2);   // it was fine one step down: wait longer next time
      gov.good = 0;
      setQuality(qLevel + 1);
    } else if (median < 20 && qLevel > 0) {                    // comfortably fast: try a step back up, after a while of it
      if (++gov.good >= gov.patience) { gov.good = 0; gov.lastUp = now; setQuality(qLevel - 1); }
    } else {
      gov.good = 0;
    }
  }

  // Sliding on a board: remember how fast the eyepiece was moving when let go, then glide and
  // slow down with friction. Position eases toward `goal`, and coasting just keeps moving `goal`.
  const vel = { x: 0, y: 0 };          // px per ms
  const FRICTION_MS = 330;             // time constant of the slide: bigger = glides further
  const BOUNCE = 0.3;                  // share of speed kept when hitting an edge
  const AIR_MS = 1400;                 // time constant while the eyepiece is still in the air: almost no friction, so it keeps its line
  const MAX_SPEED = 3;                 // px per ms
  const reduceMotion = matchMedia("(prefers-reduced-motion: reduce)");
  let coasting = false;
  let lastT = 0;

  const coast = (dt) => {
    const nx = goal.x + vel.x * dt, ny = goal.y + vel.y * dt;
    goal.x = nx; goal.y = ny;
    clamp();
    if (goal.x !== nx) vel.x *= -BOUNCE;
    if (goal.y !== ny) vel.y *= -BOUNCE;
    // In the air (still coming down from a lift) there is almost nothing to slow it; once it touches the board, friction takes over
    const f = Math.exp(-dt / (lift > 0.02 ? AIR_MS : FRICTION_MS));
    vel.x *= f; vel.y *= f;
    if (Math.hypot(vel.x, vel.y) < 0.02) coasting = false;
  };

  // Set down on the board, the eyepiece gives it a jolt: the film right under it gives, and the board's surface (its grain and
  // dust) gives a little, once, and eases back.
  function landed() {
    if (landShake <= 0) return;
    const k = landShake * Math.min(1.4, 0.55 + 0.35 * liftHeight);      // dropped from higher, it lands harder
    film?.thump({ x: cur.x, y: cur.y, radius: Do / 2 }, k);
    film?.slap({ x: cur.x, y: cur.y, vx: coasting ? vel.x : eyeV.x, vy: coasting ? vel.y : eyeV.y, radius: Do / 2 }, k);   // it lands moving: it drags the film along
    shakeVY += 0.05 * k; shakeVX += 0.008 * k;
  }
  function stepShake(dt) {
    if (!shakeX && !shakeY && !shakeVX && !shakeVY) return false;
    const w = 0.02, z = 1;                          // critically damped: one give and a return, no ringing
    for (let rest = dt; rest > 0; rest -= 4) {
      const h = Math.min(4, rest);
      shakeVY += (-w * w * shakeY - 2 * z * w * shakeVY) * h;
      shakeVX += (-w * w * shakeX - 2 * z * w * shakeVX) * h;
      shakeY += shakeVY * h; shakeX += shakeVX * h;
    }
    if (Math.abs(shakeX) < 0.01 && Math.abs(shakeY) < 0.01 && Math.abs(shakeVX) < 0.0002 && Math.abs(shakeVY) < 0.0002) shakeX = shakeY = shakeVX = shakeVY = 0;
    const tr = shakeX || shakeY ? `translate(${shakeX.toFixed(2)}px, ${shakeY.toFixed(2)}px)` : "";
    overlayEl.style.transform = tr;
    dustEl.style.transform = tr;
    return true;
  }

  const tick = (t) => {
    const raw = lastT ? t - lastT : 0;
    const dt = Math.min(34, lastT ? raw : 16);
    lastT = t;
    if (adaptive && raw) govern(raw);
    if (coasting) coast(dt);
    // up steadily (the page eases it in and out), down about twice as fast; the sound of it touching down plays as it lands
    const wasUp = lift > 0;
    if (lift < liftGoal) lift = Math.min(liftGoal, lift + dt / liftTime);
    else if (lift > liftGoal) lift = Math.max(liftGoal, lift - dt / Math.max(170, liftTime * 0.45));
    if (wasUp && lift === 0) { sounds.place(Math.min(1.4, 0.55 + 0.35 * liftHeight)); landed(); }
    // Film that is being moved under the eyepiece (held, or gliding after a throw) drags it along, by friction: along the way the film
    // moves at the patch under it. Not while the eyepiece is lifted, and not while you hold it (your hand wins).
    if (film && !dragging && lift < 0.5 && filmDragsEye > 0) {
      const d = film.dragOnEye({ x: cur.x, y: cur.y, radius: Do / 2 });
      if (d.f > 0.01) {
        const k = Math.min(1, (LOUPE_DRAG * filmDragsEye * d.f * Math.max(0, 1 - smooth(lift) * 2) * dt) / eyeMass);
        carriedAt = performance.now();
        vel.x += (d.x - vel.x) * k; vel.y += (d.y - vel.y) * k;
        coasting = true;
      }
    }
    const px = cur.x, py = cur.y;
    cur.x += (goal.x - cur.x) * 0.35;
    cur.y += (goal.y - cur.y) * 0.35;
    eyeV.x += ((cur.x - px) / dt - eyeV.x) * 0.5;
    eyeV.y += ((cur.y - py) / dt - eyeV.y) * 0.5;
    // fast slides drag the film a little; slow movement leaves it alone
    // A lifted eyepiece is off the film: it cannot push or bend it, and it makes no sliding or crackling. All of
    // that fades back in as it touches down, so a throw that lands still rubs the film as it glides.
    const touch = 1 - smooth(lift);
    const filmMoving = film ? film.step(dt, { x: cur.x, y: cur.y, vx: eyeV.x * touch, vy: eyeV.y * touch, radius: Do / 2, carried: performance.now() - carriedAt < 500, down: touch, mass: eyeMass }) : false;
    // The slide sounds whenever the eyepiece is dragged or glides across the matte board, film under it or not,
    // and it is silent while the eyepiece is lifted or standing still. It is louder the faster it moves. A film
    // strip sliding on the board slides too. The crackle is separate: it sounds only where the eyepiece rubs the
    // film, or a moving strip rides over another one.
    // (film carrying the eyepiece moves it slowly, so it takes much less speed to be heard)
    const eyeSlide = Math.min(1, Math.hypot(eyeV.x, eyeV.y) * touch / (performance.now() - carriedAt < 500 ? 0.3 : 1.4));
    sounds.slide(Math.max(eyeSlide, film ? film.moveSlide : 0));
    sounds.crackle(film ? Math.max(film.contact, film.moveRub) : 0, dt);
    // The glass edge dragging across the board: only while the eyepiece is down on the surface and moving.
    sounds.glassDrag(Math.hypot(eyeV.x, eyeV.y) * touch / 1.6);
    const shaking = stepShake(dt);
    const done = !coasting && !filmMoving && !shaking && lift === liftGoal && Math.abs(goal.x - cur.x) < 0.2 && Math.abs(goal.y - cur.y) < 0.2;
    if (done) { cur.x = goal.x; cur.y = goal.y; eyeV.x = eyeV.y = 0; sounds.slide(0); }
    render();
    if (done) { raf = 0; lastT = 0; gov.frames.length = 0; } else raf = requestAnimationFrame(tick);
  };
  const kick = () => { if (!raf) raf = requestAnimationFrame(tick); };

  // Memory-poor devices get the overlay at a lower pixel density: it is grain and dust, so it stays convincing.
  const overlayDpr = () => Math.min(window.devicePixelRatio || 1, (navigator.deviceMemory ?? 8) <= 4 ? 1.5 : 2);
  function drawOverlay() {
    if (!specks) return;
    const dpr = overlayDpr();
    const W = stage.clientWidth, H = stage.offsetHeight;
    if (overlayEl.width !== Math.round(W * dpr) || overlayEl.height !== Math.round(H * dpr)) {
      overlayEl.width = Math.round(W * dpr); overlayEl.height = Math.round(H * dpr);
    }
    const c = overlayEl.getContext("2d");
    c.setTransform(dpr, 0, 0, dpr, 0, 0);
    paintOverlay(c, W, H, { fall: falloff, grain });
  }
  const drawGlow = () => paintGlowLayer(glowEl, stage.clientWidth, stage.offsetHeight, glow);
  // sliders can fire many times a frame; repaint the overlay at most once per frame
  let overlayQueued = false;
  const queueOverlay = () => { if (!overlayQueued) { overlayQueued = true; requestAnimationFrame(() => { overlayQueued = false; drawOverlay(); }); } };

  let lastWidth = 0;
  function layout() {
    // The film starts only where the light panel is at full brightness: past the dark margin and the soft falloff of its rim
    // (the sizes below match --edge-m and --edge-f in the stylesheet).
    const edgeM = Math.max(8, Math.min(20, root.clientWidth * 0.014)), edgeF = Math.max(26, Math.min(58, root.clientWidth * 0.04));
    edgeSize = { m: edgeM, f: edgeF, blur: Math.max(5, Math.min(11, innerWidth * 0.009)) };
    const pad = Math.round(edgeM + edgeF + 8);
    stage.style.setProperty("--pad", `${pad}px`);
    stage.style.setProperty("--pad-top", `${pad + 80}px`);       // room above the film for the buttons, in the lit part of the panel
    const inner = stage.clientWidth - pad * 2;
    lastWidth = root.clientWidth;
    const cols = columnsFor(inner);
    // strip = 1.42 fw wide, gaps = 0.16 fw
    const fw = Math.min(260, (inner * 0.995) / (cols * 1.42 + (cols - 1) * 0.16));      // strips per row; more strips wrap onto further rows

    D = size ?? Math.round(Math.max(230, Math.min(330, Math.min(innerWidth, innerHeight) * 0.38)));
    Do = Math.round(D * GLASS_RATIO);               // glass sits concentrically around the ring
    const w = D * 0.15;                             // bezel width
    G = D - w * 2;
    loupe.el.style.setProperty("--Do", `${Do}px`);
    loupe.el.style.setProperty("--D", `${D}px`);
    loupe.el.style.setProperty("--w", `${w}px`);
    glass?.resize(Do, qOuter());
    loupe.el.style.setProperty("--gp", `${glass ? glass.pad : 0}px`);
    lens?.resize(G, qLens());
    lensPad = Math.round(G * 0.2);
    view = null;

    if (!lens) {
      loupe.mag.replaceChildren(buildSheet(photos, fw, "lb-pos"));
      loupe.mag.style.width = `${stage.clientWidth}px`;
    }
    // the film layer: the sheet, plus twins of each strip for where film lies over film (one blends by
    // transparency, one multiplies). They are kept in their own isolated group so the eyepiece stays on top.
    const filmLayer = div("lb-film");
    filmLayer.append(
      buildSheet(photos, fw, "lb-neg"),
      ...(glass && lens ? [buildSheet(photos, fw, "lb-ghost"), buildSheet(photos, fw, "lb-mult")] : []),
    );
    stage.replaceChildren(...cornerEls, edgeEl, signEl, filmLayer, seepEl, holesEl, overlayEl, dustEl, glowEl, loupe.el, ...(start?.els ?? []));
    holesKey = "";
    dustKey = "";
    placeSign();
    {   // the rim is baked at the sheet's real size, which is known now the film is in
      const baked = bakeEdge(stage.clientWidth, stage.offsetHeight, edgeSize.m, edgeSize.f, edgeSize.blur);
      baked.className = "lb-edge";
      edgeEl.replaceWith(baked);
      edgeEl = baked;
    }
    specks = createSpecks(stage.clientWidth, stage.offsetHeight);
    drawOverlay();
    drawGlow();

    if (!placed) {   // rest on the sheet, inside the first screenful
      goal.x = stage.clientWidth * 0.42;
      goal.y = Math.min(stage.offsetHeight * 0.5, innerHeight * 0.48);
      placed = true;
    }
    clamp();
    cur.x = goal.x; cur.y = goal.y;
    render();

    // read the laid-out sheet once; the film physics and both glasses all draw from it
    view = null; negView = null; film = null;
    gripping = false; root.classList.remove("is-gripping", "lb-over-film");
    if (glass && lens) {
      const id = ++layoutId;
      readScene(stage, root)
        .then((scene) => {
          if (id !== layoutId) return;
          warmNegatives(scene, Math.min(2, window.devicePixelRatio || 1));
          negSide = Math.round(Do * 1.5);               // room for the rim to bend outward, even when the eyepiece is lifted
          negView = createNegView(scene, glass.dpr);
          negView.resize(negSide);
          view = createLensView(scene, lens.dpr);
          view.resize(G + lensPad * 2);
          root.dataset.quality = String(Q_LEVELS[qLevel]);
          scene.hiLoaded = () => { render(); };         // a sharper picture arrived: redraw the lens
          scene.specks = specks;
          scene.seepCanvas = seepEl;
          scene.edgeCanvas = edgeEl;
          scene.edge = edgeSize;
          scene.stack = stacking_; scene.fall = falloff; scene.glow = glow; scene.grain = grain;
          film = createFilm(scene, filmCfg);
          sceneRef = scene;
          loupe.el.classList.add("has-gl");
          render();
          markSceneReady();                             // everything is drawn: the start screen may light up
        })
        .catch((err) => { console.warn("LightBox glass source failed:", err); markSceneReady(); });
    } else markSceneReady();                            // no glass to wait for
  }
  layout();
  start?.run();                                         // the page is dark now; light it once everything is ready

  // the shadow the black ring casts onto the glass: how dark it is, and how far it fades inward
  const setShadow = (v) => loupe.el.style.setProperty("--rs", v);
  const setFade = (v) => { fade = v; loupe.el.style.setProperty("--rf", v); render(); };
  setShadow(shadow);
  setFade(shadowFade);

  let setters = {};
  // detent clicks: one per 0.05x tick the dial passes, a thud at each end stop
  const sounds = createSounds({ volumes });
  const detentOf = (z) => Math.floor((z - ZOOM_MIN) / 0.05 + 1e-6);
  let atStop = false;

  /* magnification drives the bezel angle, the lens and the slider together */
  function setZoom(z, { silent = false } = {}) {
    const prev = zoom;
    zoom = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, z));
    const dialDeg = (zoom - ZOOM_MIN) * DEG_PER_ZOOM;
    loupe.dial.style.transform = `rotate(${dialDeg}deg)`;
    setDialLight(loupe.dial, dialDeg);          // the light stays put while the scale turns
    setters.zoom?.(zoom);
    render();
    if (silent) return;
    const crossed = Math.abs(detentOf(zoom) - detentOf(prev));
    if (crossed) sounds.click(crossed);
    const hitStop = zoom !== z;
    if (hitStop && !atStop) sounds.thud();
    atStop = hitStop;
  }
  setZoom(zoom, { silent: true });

  if (controls) {
    const vols = { ...DEFAULT_VOLUMES, ...volumes };
    // the volume you left it at, on this device
    const saveVolume = (v) => { try { localStorage.setItem("lightbox-volume", String(v)); } catch { /* private window: it just starts at the default */ } };
    try { const saved = parseFloat(localStorage.getItem("lightbox-volume")); if (saved >= 0 && saved <= 2) { vols.master = saved; sounds.setVolume("master", saved); } } catch { /* no storage */ }
    const c = buildControls([
      { group: "Eyepiece", key: "zoom", name: "Magnification", min: ZOOM_MIN, max: ZOOM_MAX, step: 0.05, value: zoom, onInput: setZoom },
      { group: "Rim shadow", key: "shadow", name: "Shadow strength", min: 0, max: 6, step: 0.05, value: shadow, onInput: setShadow },
      { group: "Rim shadow", key: "fade", name: "Shadow fade", min: 0.1, max: 3, step: 0.05, value: shadowFade, onInput: setFade },
      { group: "Outer glass (PA)", key: "paShape", name: "Shape: dome to frustum", min: 0, max: 1, step: 0.05, value: pa.shape, onInput: (v) => { pa.shape = v; render(); } },
      { group: "Outer glass (PA)", key: "paSlope", name: "Wall slope (degrees)", min: 15, max: 85, step: 1, value: pa.slope, onInput: (v) => { pa.slope = v; render(); } },
      { group: "Outer glass (PA)", key: "paWall", name: "Wall width", min: 0.2, max: 1, step: 0.05, value: pa.wall, onInput: (v) => { pa.wall = v; render(); } },
      { group: "Outer glass (PA)", key: "paLip", name: "Edge thickness (px)", min: 0, max: 28, step: 1, value: pa.lip, onInput: (v) => { pa.lip = v; render(); } },
      { group: "Outer glass (PA)", key: "paLipK", name: "Edge highlights and shade", min: 0, max: 2, step: 0.05, value: pa.lipK, onInput: (v) => { pa.lipK = v; render(); } },
      { group: "Outer glass (PA)", key: "paSquig", name: "Window highlights", min: 0, max: 1.5, step: 0.05, value: pa.squig, onInput: (v) => { pa.squig = v; render(); } },
      { group: "Outer glass (PA)", key: "paRingShade", name: "Inner shadow of the loupe", min: 0, max: 1, step: 0.05, value: pa.ringShade, onInput: (v) => { pa.ringShade = v; render(); } },
      { group: "Outer glass (PA)", key: "paRingShadeOff", name: "Inner shadow: how far it falls", min: 0, max: 2, step: 0.05, value: pa.ringShadeOff, onInput: (v) => { pa.ringShadeOff = v; render(); } },
      { group: "Outer glass (PA)", key: "paCast", name: "Light and shadow on the board", min: 0, max: 2, step: 0.05, value: pa.cast, onInput: (v) => { pa.cast = v; render(); } },
      { group: "Lifting", key: "liftHeight", name: "Lift height", min: 0.5, max: 3, step: 0.05, value: liftHeight, onInput: (v) => { liftHeight = v; render(); } },
      { group: "Lifting", key: "liftTime", name: "Lift time (ms)", min: 150, max: 2500, step: 50, value: liftTime, onInput: (v) => { liftTime = v; } },
      { group: "Lifting", key: "dropCarry", name: "Drop carry (speed kept)", min: 0, max: 3, step: 0.05, value: dropCarry, onInput: (v) => { dropCarry = v; } },
      { group: "Lifting", key: "landShake", name: "Landing shake", min: 0, max: 2, step: 0.05, value: landShake, onInput: (v) => { landShake = v; } },
      { group: "Outer glass (PA)", key: "paReflect", name: "Wall reflections", min: 0, max: 1, step: 0.05, value: pa.reflect, onInput: (v) => { pa.reflect = v; render(); } },
      { group: "Outer glass (PA)", key: "paIndex", name: "Glass index", min: 1.2, max: 2, step: 0.01, value: pa.index, onInput: (v) => { pa.index = v; render(); } },
      { group: "Outer glass (PA)", key: "paDisp", name: "Extra colour spread", min: 0, max: 0.2, step: 0.005, value: pa.dispersion, onInput: (v) => { pa.dispersion = v; render(); } },
      { group: "Light box", key: "falloff", name: "Panel falloff", min: 0, max: 2, step: 0.05, value: panelFalloff, onInput: (v) => { falloff = v; queueOverlay(); if (sceneRef) sceneRef.fall = v; render(); } },
      { group: "Light box", key: "glow", name: "Panel glow", min: 0, max: 2, step: 0.05, value: panelGlow, onInput: (v) => { glow = v; drawGlow(); if (sceneRef) sceneRef.glow = v; render(); } },
      { group: "Light box", key: "grain", name: "Panel grain", min: 0, max: 2, step: 0.05, value: panelGrain, onInput: (v) => { grain = v; queueOverlay(); if (sceneRef) sceneRef.grain = v; render(); } },
      { group: "Light box", key: "bleed", name: "Light bleed", min: 0, max: 2, step: 0.05, value: lightBleed, onInput: (v) => { bleed = v; render(); } },
      { group: "Light box", key: "seep", name: "Light seeping onto film", min: 0, max: 2, step: 0.05, value: lightSeep, onInput: (v) => { seep = v; render(); } },
      { group: "Light box", key: "seepSpread", name: "Seep distance (px)", min: 8, max: 120, step: 1, value: seepSpread, onInput: (v) => { spread = v; render(); } },
      { group: "Film", key: "stacking", name: "Film stacking", min: 0, max: 1, step: 0.05, value: stacking, onInput: (v) => { stacking_ = v; if (sceneRef) sceneRef.stack = v; film?.setStack(v); render(); } },
      { group: "Film", key: "filmDrag", name: "Film drag", min: 0, max: 2, step: 0.05, value: filmDrag, onInput: (v) => { filmCfg.push = v; } },
      { group: "Film", key: "eyeLoad", name: "Strip heavier under eyepiece", min: 0, max: 2, step: 0.05, value: filmCfg.eyeLoad, onInput: (v) => { filmCfg.eyeLoad = v; } },
      { group: "Film", key: "carry", name: "Carried eyepiece rubs strips", min: 0, max: 1.5, step: 0.05, value: filmCfg.carry, onInput: (v) => { filmCfg.carry = v; } },
      { group: "Film", key: "slap", name: "Landing drags film", min: 0, max: 1.5, step: 0.05, value: filmCfg.slap, onInput: (v) => { filmCfg.slap = v; } },
      { group: "Film", key: "eyeMass", name: "Eyepiece weight", min: 0.2, max: 4, step: 0.05, value: eyeMass, onInput: (v) => { eyeMass = v; } },
      { group: "Film", key: "filmDragsEye", name: "Film drags eyepiece", min: 0, max: 3, step: 0.05, value: filmDragsEye, onInput: (v) => { filmDragsEye = v; } },
      { group: "Film", key: "stripRub", name: "Strip-on-strip drag", min: 0, max: 3, step: 0.05, value: filmCfg.rub, onInput: (v) => { filmCfg.rub = v; } },
      { group: "Film", key: "filmFlutter", name: "Film flutter", min: 0, max: 2, step: 0.05, value: filmFlutter, onInput: (v) => { filmCfg.flutter = v; } },
      { group: "Sound · master", key: "vol_master", name: "Master volume", min: 0, max: 2, step: 0.05, value: vols.master, onInput: (v) => { sounds.setVolume("master", v); setters.vol_master_knob?.(v); saveVolume(v); } },
      { group: "Sound · dial", key: "vol_tick", name: "Dial ticks", min: 0, max: 1, step: 0.05, value: vols.tick, onInput: (v) => sounds.setVolume("tick", v) },
      { group: "Sound · dial", key: "vol_notch", name: "Notch & end stops", min: 0, max: 1, step: 0.05, value: vols.notch, onInput: (v) => sounds.setVolume("notch", v) },
      { group: "Sound · lifting", key: "vol_lift", name: "Lift", min: 0, max: 1, step: 0.05, value: vols.lift, onInput: (v) => sounds.setVolume("lift", v) },
      { group: "Sound · lifting", key: "vol_thump", name: "Surface thump", min: 0, max: 1, step: 0.05, value: vols.thump, onInput: (v) => sounds.setVolume("thump", v) },
      { group: "Sound · lifting", key: "vol_place", name: "Set-down", min: 0, max: 1, step: 0.05, value: vols.place, onInput: (v) => sounds.setVolume("place", v) },
      ...(GLASS_DRAG_ENABLED ? [{ group: "Sound · sliding", key: "vol_drag", name: "Glass drag", min: 0, max: 1, step: 0.05, value: vols.drag, onInput: (v) => sounds.setVolume("drag", v) }] : []),
      { group: "Sound · sliding", key: "vol_slide", name: "Eyepiece slide", min: 0, max: 1, step: 0.01, value: vols.slide, onInput: (v) => sounds.setVolume("slide", v) },
      { group: "Sound · sliding", key: "vol_crackle", name: "Film crackle", min: 0, max: 1, step: 0.05, value: vols.crackle, onInput: (v) => sounds.setVolume("crackle", v) },
      { group: "Sound · interface", key: "vol_button", name: "Button click", min: 0, max: 1, step: 0.05, value: vols.button, onInput: (v) => sounds.setVolume("button", v) },
      // the start screen (start-screen/): how long the light takes to come on, how loud the strobe is, and a button to see it again
      { group: "Start screen", key: "start_length", name: "Light-up length (s)", min: 0.8, max: 3, step: 0.1, value: startLength / 1000, onInput: (v) => { if (start) start.length = v * 1000; } },
      { group: "Start screen", key: "vol_strobe", name: "Start-up sound", min: 0, max: 1, step: 0.05, value: vols.strobe, onInput: (v) => sounds.setVolume("strobe", v) },
      { group: "Start screen", key: "start_replay", type: "button", name: "Replay start screen", onInput: () => { sounds.unlock(); start?.replay(); } },
      // the sign on the panel: switch it off, or change its words (an empty line hides it too)
      { group: "Sign", key: "sign_on", type: "check", name: "Show text", value: signOn, onInput: (v) => { signOn = v; refreshSign(); } },
      { group: "Sign", key: "sign_text", type: "text", name: "Words", value: sign.text, onInput: (v) => { sign.setText(v); refreshSign(); } },
    ], {
      onOrganize: () => { film?.reset(); kick(); },
      onButton: (phase) => { sounds.unlock(); sounds.button(phase); },
      sliders,
      volume: {
        value: vols.master,
        onInput: (v) => { sounds.setVolume("master", v); saveVolume(v); },
        // the same clicks as the eyepiece ring: light ticks as it turns, a notch as it drops into its resting place, a thud at the ends
        sounds: { onTick: (n) => { sounds.unlock(); sounds.click(n); }, onNotch: () => { sounds.unlock(); sounds.notch(); }, onStop: () => { sounds.unlock(); sounds.thud(); } },
      },
    });
    setters = c.setters;
    root.append(c.wrap);
    cornerEls = [mountSocketCorner(stage, c.corner), ...(c.left.length ? [mountSocketCorner(stage, c.left, { side: "left" })] : [])];
    stage.prepend(...cornerEls);         // the buttons lie on the panel, under the film
    cornerButtons = [...c.corner, ...c.left];
    placeSign();
  }

  // drag
  const grab = { x: 0, y: 0 };
  const lastPointer = { x: 0, y: 0 };
  const pointerInStage = (x, y) => {
    const b = stage.getBoundingClientRect();
    return { x: x - b.left, y: y - b.top };
  };
  const samples = [];                  // recent eyepiece positions, to measure the throw
  const follow = () => {
    const p = pointerInStage(lastPointer.x, lastPointer.y);
    goal.x = p.x - grab.x; goal.y = p.y - grab.y;
    clamp(); kick();
    const now = performance.now();
    samples.push({ t: now, x: goal.x, y: goal.y });
    while (samples.length > 1 && now - samples[0].t > 100) samples.shift();
  };
  /* speed over the last ~100 ms; zero if the pointer had already stopped before release */
  const throwVelocity = () => {
    const now = performance.now();
    const last = samples[samples.length - 1];
    if (!last || now - last.t > (lift > 0.02 ? 110 : 60) || samples.length < 2) return { x: 0, y: 0 };
    const first = samples[0];
    const dt = Math.max(1, last.t - first.t);
    const vx = (last.x - first.x) / dt, vy = (last.y - first.y) / dt;
    const k = Math.min(1, MAX_SPEED / Math.hypot(vx, vy) || 1);
    return { x: vx * k, y: vy * k };
  };
  /* Scrolling by pushing against the edge of the window. While the eyepiece is being dragged, once its black ring (PB)
     touches the top or bottom of the visible area (the top of the page), the page scrolls that
     way, faster the further the eyepiece is pushed past the edge. The eyepiece stays under the pointer, so the film
     slides past it. It stops at the ends of the page, and only a drag does it: a resting eyepiece never scrolls. */
  const EDGE_MIN = 2, EDGE_MAX = 16;          // px per frame at 60 fps: about 120 up to 960 px a second
  let edgeRaf = 0, edgeLast = 0, edgeCarry = 0;
  const edgeRamp = (into) => EDGE_MIN + (EDGE_MAX - EDGE_MIN) * Math.min(1, into / (D * 0.75));
  function edgeScroll(t) {
    if (!dragging) { edgeRaf = 0; edgeCarry = 0; return; }
    const dt = Math.min(50, edgeLast ? t - edgeLast : 16.7);
    edgeLast = t;
    const R = D / 2;
    const topEdge = 0;
    const y = goal.y + stage.getBoundingClientRect().top;                 // where the eyepiece is headed, in the window
    const intoTop = topEdge - (y - R);                                    // > 0 once the ring reaches the top edge
    const intoBottom = y + R - innerHeight;                               // > 0 once it reaches the bottom edge
    const maxY = document.documentElement.scrollHeight - innerHeight;
    let v = 0;
    if (intoTop > 0 && scrollY > 0) v = -edgeRamp(intoTop);
    else if (intoBottom > 0 && scrollY < maxY - 1) v = edgeRamp(intoBottom);
    if (v) {
      const want = (v * dt) / 16.7 + edgeCarry;                          // (browsers scroll in whole pixels)
      const whole = Math.trunc(want);
      edgeCarry = want - whole;
      if (whole) window.scrollBy(0, whole);                              // the scroll listener moves the eyepiece with it
    } else {
      edgeCarry = 0;
    }
    edgeRaf = requestAnimationFrame(edgeScroll);
  }

  /* A release that happens outside the window (or over the browser UI) can go unreported, which
     would leave the eyepiece "held" and following the pointer. So a drag also ends when we see a
     move with no button down, when capture is lost, or when the window loses focus. */
  const buttonUp = (e) => e.pointerType !== "touch" && e.buttons === 0;

  loupe.el.addEventListener("pointerdown", (e) => {
    e.preventDefault();
    loupe.el.setPointerCapture(e.pointerId);
    lastPointer.x = e.clientX; lastPointer.y = e.clientY;
    sounds.unlock();                           // browsers only start audio from a gesture
    coasting = false; vel.x = vel.y = 0;       // grabbing it stops a slide
    goal.x = cur.x; goal.y = cur.y;            // hold it where it visibly is, not where it was heading
    const p = pointerInStage(e.clientX, e.clientY);
    grab.x = p.x - goal.x; grab.y = p.y - goal.y;
    samples.length = 0;
    dragging = true;
    loupe.el.classList.add("is-drag");
    if (!edgeRaf) { edgeLast = 0; edgeRaf = requestAnimationFrame(edgeScroll); }     // watch for the ring touching an edge
    // A single press and hold just moves the eyepiece along the board. A quick tap followed straight away by a
    // second press and hold on the glass (PA or PC) picks it up off the board; the bezel (PB) keeps its own
    // meaning: a single press moves, a double press turns it.
    const now = performance.now();
    const onBezel = !!e.target.closest(".lb-ring");
    const isDouble = !onBezel && glassTap && now - glassTap.t < 350 && Math.hypot(e.clientX - glassTap.x, e.clientY - glassTap.y) < 28;
    glassPress = onBezel ? null : { t: now, x: e.clientX, y: e.clientY };
    if (isDouble) { glassTap = null; glassPress = null; liftGoal = 1; sounds.lift(); }   // pick it up
    kick();
  });
  loupe.el.addEventListener("pointermove", (e) => {
    if (!dragging) return;
    if (buttonUp(e)) { drop(); return; }
    lastPointer.x = e.clientX; lastPointer.y = e.clientY;
    follow();
  });
  function drop(release = false) {
    if (!dragging) return;
    dragging = false;
    loupe.el.classList.remove("is-drag");
    liftGoal = 0;                              // set it back down
    kick();
    if (release === true && !reduceMotion.matches) {   // let go while moving: keep sliding
      const v = throwVelocity();
      if (lift > 0.02) { v.x *= dropCarry; v.y *= dropCarry; }          // let go while held up: it carries on along its line as it comes down
      const top = Math.hypot(v.x, v.y);
      if (top > MAX_SPEED) { v.x *= MAX_SPEED / top; v.y *= MAX_SPEED / top; }
      if (Math.hypot(v.x, v.y) > 0.05) { vel.x = v.x; vel.y = v.y; coasting = true; kick(); }
    }
  }
  loupe.el.addEventListener("pointerup", (e) => {
    const now = performance.now();
    if (glassPress && now - glassPress.t < 260 && Math.hypot(e.clientX - glassPress.x, e.clientY - glassPress.y) < 8) {
      glassTap = { t: now, x: e.clientX, y: e.clientY };       // a tap: the first half of a double press
    }
    glassPress = null;
    drop(true);
  });
  loupe.el.addEventListener("pointercancel", drop);
  loupe.el.addEventListener("lostpointercapture", () => { drop(); stopTurn(); });
  // scrolling while holding keeps the eyepiece under the pointer
  addEventListener("scroll", () => { if (dragging) follow(); }, { passive: true });
  addEventListener("blur", () => { drop(); stopTurn(); });
  document.addEventListener("visibilitychange", () => { if (document.hidden) { drop(); stopTurn(); } });

  /* The numbered points on the scale are real detents. The ring catches on a number and holds there
     while your hand keeps turning; after BREAK of extra travel it clicks free and moves again.
     `ringTarget` is where the hand says the ring is; the ring itself (`zoom`) follows it, except
     while it is held in a notch. After breaking free it catches up to the hand, so it never ends
     up lagging behind. */
  const BREAK = 0.06;       // extra turn (in zoom units, about 11 degrees) needed to break out of a notch
  const CAPTURE = 0.012;    // how close to a number the ring has to get to drop into its notch
  const SNAP_W = 0.03;
  const nearest = (z) => DETENTS.reduce((a, b) => (Math.abs(b - z) < Math.abs(a - z) ? b : a));
  let ringTarget = zoom;
  let lockedAt = null;      // the number the ring is currently held on, if any
  let atEnd = false;
  let followRaf = 0;
  let snapRaf = 0;

  function catchUp() {       // ease the ring toward the hand, unless it is held
    cancelAnimationFrame(followRaf);
    const step = () => {
      if (lockedAt !== null) return;
      const gap = ringTarget - zoom;
      if (Math.abs(gap) < 0.0008) { setZoom(ringTarget); return; }
      setZoom(zoom + gap * 0.4);
      followRaf = requestAnimationFrame(step);
    };
    followRaf = requestAnimationFrame(step);
  }

  function turnBy(dz) {
    const prev = ringTarget;
    const raw = prev + dz;
    const next = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, raw));
    if (next !== raw) { if (!atEnd) sounds.thud(); atEnd = true; } else atEnd = false;   // end stops
    ringTarget = next;

    if (lockedAt !== null) {
      if (Math.abs(next - lockedAt) < BREAK) return;          // held in the notch
      lockedAt = null;                                         // pushed through: click, then move again
      sounds.lock();
      catchUp();
      return;
    }
    // did the hand cross a number, or arrive right at one?
    const hit = DETENTS.find((d) => (prev - d) * (next - d) < 0 || (Math.abs(next - d) < CAPTURE && Math.abs(prev - d) >= CAPTURE));
    if (hit !== undefined) {
      if (Math.abs(next - hit) >= BREAK) { sounds.lock(); catchUp(); return; }   // flicked straight through
      lockedAt = hit;
      cancelAnimationFrame(followRaf);
      setZoom(hit, { silent: true });                          // drops into the notch...
      sounds.notch();                                          // ...with its own click
      return;
    }
    catchUp();
  }
  function snapToDetent() {
    const d = nearest(zoom);
    const off = Math.abs(zoom - d);
    if (off < 0.0005 || off > SNAP_W) return;
    const from = zoom, t0 = performance.now(), dur = 130;
    cancelAnimationFrame(snapRaf);
    const step = (now) => {
      const k = Math.min(1, (now - t0) / dur);
      setZoom(from + (d - from) * (1 - Math.pow(1 - k, 3)), { silent: true });
      if (k < 1) snapRaf = requestAnimationFrame(step);
      else sounds.lock();
    };
    snapRaf = requestAnimationFrame(step);
  }

  // Grab a film strip: press it anywhere and it follows the pointer like a strip lying on the board.
  // Hold the top and the top swings while the bottom barely moves; the middle slides the whole strip.
  const stagePoint = (e) => {
    const b = stage.getBoundingClientRect();
    return { x: e.clientX - b.left, y: e.clientY - b.top };
  };
  const onBoard = (e) => !e.target.closest(".lb-loupe, .lb-nav, .sb-button");
  function letGo() {
    if (!gripping) return;
    gripping = false;
    root.classList.remove("is-gripping");
    film?.release();
    kick();
  }
  root.addEventListener("pointerdown", (e) => {
    if (!film || e.button !== 0 || !onBoard(e)) return;
    const p = stagePoint(e);
    const hit = film.hit(p.x, p.y);
    if (!hit) return;
    e.preventDefault();
    root.setPointerCapture(e.pointerId);
    sounds.unlock();                                     // browsers only start audio from a gesture
    film.grab(hit);
    gripping = true;
    root.classList.add("is-gripping");
    kick();
  });
  root.addEventListener("pointermove", (e) => {
    if (gripping) {
      if (buttonUp(e)) { letGo(); return; }              // the release was lost outside the window
      film.dragTo(stagePoint(e));
      kick();
      return;
    }
    if (film && onBoard(e)) {
      const p = stagePoint(e);
      root.classList.toggle("lb-over-film", !!film.hit(p.x, p.y));
    }
  });
  root.addEventListener("pointerleave", () => root.classList.remove("lb-over-film"));
  root.addEventListener("pointerup", letGo);
  root.addEventListener("pointercancel", letGo);
  root.addEventListener("lostpointercapture", letGo);
  addEventListener("blur", letGo);

  // turn the bezel: clockwise raises magnification, anticlockwise lowers it
  let turning = false;
  let lastAngle = 0;
  const angleOf = (e) => {
    const b = loupe.el.getBoundingClientRect();
    return Math.atan2(e.clientY - (b.top + b.height / 2), e.clientX - (b.left + b.width / 2));
  };
  /* A single press on the ring just holds and moves the eyepiece, like pressing anywhere on it.
     A quick tap followed straight away by a second press-and-hold turns the ring. */
  const DOUBLE_MS = 350;
  let press = null;       // the current press on the ring, to tell a tap from a drag
  let lastTap = null;     // when and where the last tap on the ring was released
  loupe.ring.addEventListener("pointerdown", (e) => {
    const now = performance.now();
    const isDouble = lastTap && now - lastTap.t < DOUBLE_MS && Math.hypot(e.clientX - lastTap.x, e.clientY - lastTap.y) < 28;
    press = { t: now, x: e.clientX, y: e.clientY };
    if (!isDouble) return;                   // bubbles up: the eyepiece is picked up and moved
    lastTap = null; press = null;
    cancelAnimationFrame(snapRaf);
    e.preventDefault();
    e.stopPropagation();                     // the ring turns; it doesn't move the eyepiece
    loupe.ring.setPointerCapture(e.pointerId);
    sounds.unlock();
    turning = true;
    ringTarget = zoom; atEnd = false;
    lockedAt = Math.abs(zoom - nearest(zoom)) < 0.0005 ? nearest(zoom) : null;
    lastAngle = angleOf(e);
    loupe.el.classList.add("is-turn");
  });
  loupe.el.addEventListener("pointerup", (e) => {
    const now = performance.now();
    if (press && now - press.t < 260 && Math.hypot(e.clientX - press.x, e.clientY - press.y) < 8) {
      lastTap = { t: now, x: e.clientX, y: e.clientY };
    }
    press = null;
  });
  loupe.ring.addEventListener("pointermove", (e) => {
    if (!turning) return;
    if (buttonUp(e)) { stopTurn(); return; }
    const a = angleOf(e);
    let d = a - lastAngle;
    if (d > Math.PI) d -= 2 * Math.PI;
    if (d < -Math.PI) d += 2 * Math.PI;
    lastAngle = a;
    turnBy(((d * 180) / Math.PI) / DEG_PER_ZOOM);
  });
  function stopTurn() { turning = false; loupe.el.classList.remove("is-turn"); }
  loupe.ring.addEventListener("pointerup", () => {
    const was = turning;
    stopTurn();
    if (!was) return;
    cancelAnimationFrame(followRaf);
    if (lockedAt === null) { setZoom(ringTarget, { silent: true }); snapToDetent(); }
    lockedAt = null;
  });
  loupe.ring.addEventListener("pointercancel", stopTurn);

  loupe.el.addEventListener("keydown", (e) => {
    if (e.key === "+" || e.key === "=") { e.preventDefault(); setZoom(zoom + 0.05); return; }
    if (e.key === "-" || e.key === "_") { e.preventDefault(); setZoom(zoom - 0.05); return; }
    const step = e.shiftKey ? 80 : 24;
    const d = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }[e.key];
    if (!d) return;
    e.preventDefault();
    goal.x += d[0]; goal.y += d[1];
    clamp(); kick();
  });

  let t;
  addEventListener("resize", () => {
    clearTimeout(t);
    t = setTimeout(() => { if (root.clientWidth !== lastWidth) layout(); }, 150);
  });
}
