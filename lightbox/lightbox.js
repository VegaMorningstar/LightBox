/* LightBox — contact-sheet-on-a-light-box effect.
 *
 *   import { mountLightBox } from "./lightbox/lightbox.js";
 *   mountLightBox(document.querySelector("#sheet"), { photos: ["a.jpg", "b.jpg"], zoom: 1.2, shadow: 1.8, shadowFade: 0.85, clickVolume: 0.6, slideVolume: 0.03, crackleVolume: 1, filmDrag: 1, filmFlutter: 1, stacking: 1, panelFalloff: 1, panelGlow: 1, panelGrain: 1, lightBleed: 1 });
 *
 * The sheet shows inverted "negatives". A draggable eyepiece sits on top of it: liquid glass
 * around a black bezel (turn it to zoom), and a clear inner lens that shows the area underneath
 * magnified, and as a positive.
 */

import { createSounds } from "./sounds.js";
import { buildDial, buildTrim, setDialLight, DEG_PER_ZOOM, DETENTS, GLASS_RATIO, ZOOM_MAX, ZOOM_MIN } from "./dial.js";
import { createGlass, createLens } from "./glass.js";
import { createSpecks } from "./dust.js";
import { createFilm } from "./film.js";
import { buildFilmFilter, createLensView, createNegView, GRAIN_TILE, grainCanvas, panelBackground, panelGlowBackground, parseColor, readScene, warmNegatives } from "./raster.js";

const STRIP_DY = [0, 0.34, 0.12, 0.5, 0.05, 0.27];   // per-strip stagger, in frame widths
const STRIP_ROT = [-0.3, 0.25, -0.15, 0.35, -0.25, 0.15]; // per-strip tilt, degrees

const columnsFor = (w) => (w >= 1100 ? 6 : w >= 800 ? 4 : w >= 520 ? 3 : 2);

/* How many photos each strip gets. Strips are different lengths, like real rolls cut apart, but always the same
   split for a given photo count, so every copy of the sheet (page, ghost, multiply) agrees. */
const STRIP_WEIGHT = [1, 0.62, 0.86, 0.5, 1.12, 0.74];
function stripSizes(total, cols) {
  const w = Array.from({ length: cols }, (_, i) => STRIP_WEIGHT[i % STRIP_WEIGHT.length]);
  const sum = w.reduce((a, b) => a + b, 0);
  const min = total >= cols * 2 ? 2 : total >= cols ? 1 : 0;
  const sizes = w.map((x) => Math.max(min, Math.floor((x / sum) * total)));
  let left = total - sizes.reduce((a, b) => a + b, 0);
  // hand out what is left (or take back any excess), largest remainder first
  const order = w.map((x, i) => [(x / sum) * total - Math.floor((x / sum) * total), i]).sort((a, b) => b[0] - a[0]).map((e) => e[1]);
  for (let k = 0; left > 0; k++, left--) sizes[order[k % cols]]++;
  for (let k = 0; left < 0; k++) { const i = order[order.length - 1 - (k % cols)]; if (sizes[i] > min) { sizes[i]--; left++; } }
  return sizes;
}

function buildSheet(photos, cols, fw, className) {
  const sheet = document.createElement("div");
  sheet.className = `lb-sheet ${className}`;
  sheet.style.setProperty("--fw", `${fw}px`);
  sheet.setAttribute("aria-hidden", className === "lb-neg" ? "false" : "true");

  const sizes = stripSizes(photos.length, cols);
  let first = 0;
  for (let s = 0; s < cols; s++) {
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
      img.src = src;
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

/* A slim "Sliders" nav bar along the top; the sliders drop down from it, closed by default. */
function buildControls(rows, { onOrganize, sliders = true } = {}) {
  const nav = document.createElement("nav");
  nav.className = "lb-nav";
  nav.setAttribute("aria-label", "Sliders");

  const toggle = document.createElement("button");
  toggle.type = "button";
  toggle.className = "lb-nav-toggle";
  toggle.setAttribute("aria-expanded", "false");
  toggle.innerHTML = '<span>Sliders</span><svg viewBox="0 0 10 6" aria-hidden="true"><path d="M1 1l4 4 4-4"/></svg>';

  const bar = div("lb-nav-bar");
  const organize = document.createElement("button");
  organize.type = "button";
  organize.className = "lb-nav-organize";
  organize.textContent = "Organize";
  organize.title = "Put the film back where it started";
  organize.addEventListener("click", () => onOrganize?.());
  bar.append(...(sliders ? [toggle] : []), organize);
  if (!sliders) nav.classList.add("lb-nav-min");     // just the Organize button, on the right

  const panel = div("lb-nav-panel");
  panel.id = `lb-sliders-${Math.random().toString(36).slice(2, 7)}`;
  panel.hidden = true;
  toggle.setAttribute("aria-controls", panel.id);
  toggle.addEventListener("click", () => {
    const open = panel.hidden;
    panel.hidden = !open;
    toggle.setAttribute("aria-expanded", String(open));
    nav.classList.toggle("is-open", open);
  });

  const setters = {};
  for (const { key, name, min, max, step, value, onInput } of rows) {
    const label = document.createElement("label");
    const text = document.createElement("span");
    text.textContent = name;
    const input = document.createElement("input");
    Object.assign(input, { type: "range", min, max, step, value });
    const out = document.createElement("output");
    const show = (v) => { out.textContent = Number(v).toFixed(2); };
    show(value);
    input.addEventListener("input", () => { show(input.value); onInput(Number(input.value)); });
    setters[key] = (v) => { input.value = v; show(v); };
    label.append(text, input, out);
    if (sliders) panel.append(label);
  }
  nav.append(bar, ...(sliders ? [panel] : []));
  return { wrap: nav, setters };
}

export function mountLightBox(root, { photos, zoom = 1.2, shadow = 1.8, shadowFade = 0.85, clickVolume = 0.6, slideVolume = 0.03, crackleVolume = 1, filmDrag = 1, filmFlutter = 1, stacking = 1, panelFalloff = 1, panelGlow = 1, panelGrain = 1, lightBleed = 1, size, controls = true, sliders = true } = {}) {
  root.classList.add("lb-root");
  const stage = div("lb-stage");
  root.replaceChildren(stage);
  root.append(buildFilmFilter("lb-film-alpha", parseColor(getComputedStyle(root).getPropertyValue("--lb-bg").trim() || "#ddd0b6")));

  const loupe = buildEyepiece();
  const panel = div("lb-panel");        // the light box's own unevenness, over the board and the film
  const glowEl = div("lb-glow");          // brighter patches and colour drift, blended into the light
  const specksEl = document.createElement("canvas");
  specksEl.className = "lb-specks";        // dust on the panel
  let specks = null;
  const grainEl = div("lb-grain");        // the panel's matte surface
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
  let glassTap = null, glassPress = null;   // taps on the glass, to tell a double press from a single one
  const LIFT_AREA = 0.4;               // extra area the lens takes in at full lift
  const LIFT_SCALE = 0.045;            // and how much closer (bigger) the eyepiece looks
  const smooth = (x) => x * x * (3 - 2 * x);
  let raf = 0;
  let layoutId = 0;
  let view = null;     // magnified window onto the lit sheet, drawn for the lens
  let negView = null;  // window onto the negative sheet, drawn for the outer glass
  let negSide = 0;
  let film = null;     // friction between eyepiece, film and board
  let gripping = false;                // a film strip is being held
  let sceneRef = null;                 // the scene the glasses draw, so sliders can update it
  const filmCfg = { push: filmDrag, flutter: filmFlutter };
  const eyeV = { x: 0, y: 0 };         // eyepiece velocity in px per ms, smoothed
  let fade = shadowFade;
  let lensPad = 0;

  const clamp = () => {
    goal.x = Math.max(0, Math.min(stage.clientWidth, goal.x));
    goal.y = Math.max(0, Math.min(stage.offsetHeight, goal.y));
  };

  const render = () => {
    const L = smooth(lift);
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
      glass.draw(negView.canvas, negSide, D / 2, L);
    }
  };

  // Sliding on a board: remember how fast the eyepiece was moving when let go, then glide and
  // slow down with friction. Position eases toward `goal`, and coasting just keeps moving `goal`.
  const vel = { x: 0, y: 0 };          // px per ms
  const FRICTION_MS = 330;             // time constant of the slide: bigger = glides further
  const BOUNCE = 0.3;                  // share of speed kept when hitting an edge
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
    const f = Math.exp(-dt / FRICTION_MS);
    vel.x *= f; vel.y *= f;
    if (Math.hypot(vel.x, vel.y) < 0.02) coasting = false;
  };

  const tick = (t) => {
    const dt = Math.min(34, lastT ? t - lastT : 16);
    lastT = t;
    if (coasting) coast(dt);
    // up fast and easing out, down a touch quicker; the sound of it touching down plays as it lands
    const wasUp = lift > 0;
    if (lift < liftGoal) lift = Math.min(liftGoal, lift + (1 - lift) * (1 - Math.exp(-dt / 55)) + dt / 900);
    else if (lift > liftGoal) lift = Math.max(liftGoal, lift - dt / 170);
    if (wasUp && lift === 0) sounds.place();
    const px = cur.x, py = cur.y;
    cur.x += (goal.x - cur.x) * 0.35;
    cur.y += (goal.y - cur.y) * 0.35;
    eyeV.x += ((cur.x - px) / dt - eyeV.x) * 0.5;
    eyeV.y += ((cur.y - py) / dt - eyeV.y) * 0.5;
    // fast slides drag the film a little; slow movement leaves it alone
    // A lifted eyepiece is off the film: it cannot push or bend it, and it makes no sliding or crackling. All of
    // that fades back in as it touches down, so a throw that lands still rubs the film as it glides.
    const touch = 1 - smooth(lift);
    const filmMoving = film ? film.step(dt, { x: cur.x, y: cur.y, vx: eyeV.x * touch, vy: eyeV.y * touch, radius: Do / 2 }) : false;
    // The slide sounds whenever the eyepiece is dragged or glides across the matte board, film under it or not,
    // and it is silent while the eyepiece is lifted or standing still. It is louder the faster it moves. A film
    // strip sliding on the board slides too. The crackle is separate: it sounds only where the eyepiece rubs the
    // film, or a moving strip rides over another one.
    const eyeSlide = Math.min(1, Math.hypot(eyeV.x, eyeV.y) * touch / 1.4);
    sounds.slide(Math.max(eyeSlide, film ? film.moveSlide : 0));
    sounds.crackle(film ? Math.max(film.contact, film.moveRub) : 0, dt);
    const done = !coasting && !filmMoving && lift === liftGoal && Math.abs(goal.x - cur.x) < 0.2 && Math.abs(goal.y - cur.y) < 0.2;
    if (done) { cur.x = goal.x; cur.y = goal.y; eyeV.x = eyeV.y = 0; sounds.slide(0); }
    render();
    if (done) { raf = 0; lastT = 0; } else raf = requestAnimationFrame(tick);
  };
  const kick = () => { if (!raf) raf = requestAnimationFrame(tick); };

  function drawSpecksDom() {
    if (!specks) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const W = stage.clientWidth, H = stage.offsetHeight;
    if (specksEl.width !== Math.round(W * dpr) || specksEl.height !== Math.round(H * dpr)) {
      specksEl.width = Math.round(W * dpr); specksEl.height = Math.round(H * dpr);
    }
    const c = specksEl.getContext("2d");
    c.setTransform(1, 0, 0, 1, 0, 0);
    c.clearRect(0, 0, specksEl.width, specksEl.height);
    c.setTransform(dpr, 0, 0, dpr, 0, 0);
    specks.draw(c);
  }

  let lastWidth = 0;
  function layout() {
    const pad = Math.max(20, Math.min(56, root.clientWidth * 0.04));
    stage.style.setProperty("--pad", `${pad}px`);
    const inner = stage.clientWidth - pad * 2;
    lastWidth = root.clientWidth;
    const cols = columnsFor(inner);
    // strip = 1.42 fw wide, gaps = 0.16 fw
    const fw = Math.min(260, inner / (cols * 1.42 + (cols - 1) * 0.16));

    D = size ?? Math.round(Math.max(230, Math.min(330, Math.min(innerWidth, innerHeight) * 0.38)));
    Do = Math.round(D * GLASS_RATIO);               // glass sits concentrically around the ring
    const w = D * 0.15;                             // bezel width
    G = D - w * 2;
    loupe.el.style.setProperty("--Do", `${Do}px`);
    loupe.el.style.setProperty("--D", `${D}px`);
    loupe.el.style.setProperty("--w", `${w}px`);
    glass?.resize(Do);
    lens?.resize(G);
    lensPad = Math.round(G * 0.2);
    view = null;

    if (!lens) {
      loupe.mag.replaceChildren(buildSheet(photos, cols, fw, "lb-pos"));
      loupe.mag.style.width = `${stage.clientWidth}px`;
    }
    // the film layer: the sheet, plus twins of each strip for where film lies over film (one blends by
    // transparency, one multiplies). They are kept in their own isolated group so the eyepiece stays on top.
    const filmLayer = div("lb-film");
    filmLayer.append(
      buildSheet(photos, cols, fw, "lb-neg"),
      ...(glass && lens ? [buildSheet(photos, cols, fw, "lb-ghost"), buildSheet(photos, cols, fw, "lb-mult")] : []),
    );
    stage.replaceChildren(filmLayer, specksEl, panel, glowEl, grainEl, loupe.el);
    specks = createSpecks(stage.clientWidth, stage.offsetHeight);
    drawSpecksDom();
    grainEl.style.backgroundImage = `url(${grainCanvas().toDataURL()})`;
    grainEl.style.backgroundSize = `${GRAIN_TILE}px ${GRAIN_TILE}px`;
    grainEl.style.opacity = String(Math.min(1, grain / 2));
    panel.style.background = panelBackground(falloff);
    glowEl.style.background = panelGlowBackground(glow);

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
          scene.specks = specks;
          scene.stack = stacking_; scene.fall = falloff; scene.glow = glow; scene.grain = grain;
          film = createFilm(scene, filmCfg);
          sceneRef = scene;
          loupe.el.classList.add("has-gl");
          render();
        })
        .catch((err) => console.warn("LightBox glass source failed:", err));
    }
  }
  layout();

  // the shadow the black ring casts onto the glass: how dark it is, and how far it fades inward
  const setShadow = (v) => loupe.el.style.setProperty("--rs", v);
  const setFade = (v) => { fade = v; loupe.el.style.setProperty("--rf", v); render(); };
  setShadow(shadow);
  setFade(shadowFade);

  let setters = {};
  // detent clicks: one per 0.05x tick the dial passes, a thud at each end stop
  const sounds = createSounds({ clickVolume, slideVolume, crackleVolume });
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
    const c = buildControls([
      { key: "zoom", name: "Magnification", min: ZOOM_MIN, max: ZOOM_MAX, step: 0.05, value: zoom, onInput: setZoom },
      { key: "shadow", name: "Shadow strength", min: 0, max: 6, step: 0.05, value: shadow, onInput: setShadow },
      { key: "fade", name: "Shadow fade", min: 0.1, max: 3, step: 0.05, value: shadowFade, onInput: setFade },
      { key: "stacking", name: "Film stacking", min: 0, max: 1, step: 0.05, value: stacking, onInput: (v) => { stacking_ = v; if (sceneRef) sceneRef.stack = v; film?.setStack(v); render(); } },
      { key: "falloff", name: "Panel falloff", min: 0, max: 2, step: 0.05, value: panelFalloff, onInput: (v) => { falloff = v; panel.style.background = panelBackground(v); if (sceneRef) sceneRef.fall = v; render(); } },
      { key: "glow", name: "Panel glow", min: 0, max: 2, step: 0.05, value: panelGlow, onInput: (v) => { glow = v; glowEl.style.background = panelGlowBackground(v); if (sceneRef) sceneRef.glow = v; render(); } },
      { key: "grain", name: "Panel grain", min: 0, max: 2, step: 0.05, value: panelGrain, onInput: (v) => { grain = v; grainEl.style.opacity = String(Math.min(1, v / 2)); if (sceneRef) sceneRef.grain = v; render(); } },
      { key: "bleed", name: "Light bleed", min: 0, max: 2, step: 0.05, value: lightBleed, onInput: (v) => { bleed = v; render(); } },
      { key: "filmDrag", name: "Film drag", min: 0, max: 2, step: 0.05, value: filmDrag, onInput: (v) => { filmCfg.push = v; } },
      { key: "filmFlutter", name: "Film flutter", min: 0, max: 2, step: 0.05, value: filmFlutter, onInput: (v) => { filmCfg.flutter = v; } },
      { key: "volume", name: "Click volume", min: 0, max: 1, step: 0.05, value: clickVolume, onInput: (v) => sounds.setClickVolume(v) },
      { key: "crackle", name: "Film crackle volume", min: 0, max: 1, step: 0.05, value: crackleVolume, onInput: (v) => sounds.setCrackleVolume(v) },
      { key: "slide", name: "Slide volume", min: 0, max: 1, step: 0.05, value: slideVolume, onInput: (v) => sounds.setSlideVolume(v) },
    ], { onOrganize: () => { film?.reset(); kick(); }, sliders });
    setters = c.setters;
    root.classList.add("lb-has-nav");
    root.append(c.wrap);
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
    if (!last || now - last.t > 60 || samples.length < 2) return { x: 0, y: 0 };
    const first = samples[0];
    const dt = Math.max(1, last.t - first.t);
    const vx = (last.x - first.x) / dt, vy = (last.y - first.y) / dt;
    const k = Math.min(1, MAX_SPEED / Math.hypot(vx, vy) || 1);
    return { x: vx * k, y: vy * k };
  };
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
  const onBoard = (e) => !e.target.closest(".lb-loupe, .lb-nav");
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
