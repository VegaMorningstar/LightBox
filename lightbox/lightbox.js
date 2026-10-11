/* LightBox — contact-sheet-on-a-light-box effect.
 *
 *   import { mountLightBox } from "./lightbox/lightbox.js";
 *   mountLightBox(document.querySelector("#sheet"), { photos: ["a.jpg", "b.jpg"], zoom: 1.2, shadow: 1.8, shadowFade: 0.85, clickVolume: 0.6 });
 *
 * The sheet shows inverted "negatives". A draggable eyepiece sits on top of it: liquid glass
 * around a black bezel (turn it to zoom), and a clear inner lens that shows the area underneath
 * magnified, and as a positive.
 */

import { createClicker } from "./clicks.js";
import { buildDial, buildTrim, DEG_PER_ZOOM, GLASS_RATIO, ZOOM_MAX, ZOOM_MIN } from "./dial.js";
import { createGlass, createLens } from "./glass.js";
import { createLensView, rasterizeNegative, readScene } from "./raster.js";

const STRIP_DY = [0, 0.34, 0.12, 0.5, 0.05, 0.27];   // per-strip stagger, in frame widths
const STRIP_ROT = [-0.3, 0.25, -0.15, 0.35, -0.25, 0.15]; // per-strip tilt, degrees

const columnsFor = (w) => (w >= 1100 ? 6 : w >= 800 ? 4 : w >= 520 ? 3 : 2);

function buildSheet(photos, cols, fw, className) {
  const sheet = document.createElement("div");
  sheet.className = `lb-sheet ${className}`;
  sheet.style.setProperty("--fw", `${fw}px`);
  sheet.setAttribute("aria-hidden", className === "lb-pos" ? "true" : "false");

  const perStrip = Math.ceil(photos.length / cols);
  for (let s = 0; s < cols; s++) {
    const slice = photos.slice(s * perStrip, (s + 1) * perStrip);
    if (!slice.length) break;

    const strip = document.createElement("div");
    strip.className = "lb-strip";
    strip.style.setProperty("--dy", STRIP_DY[s % STRIP_DY.length]);
    strip.style.setProperty("--rot", `${STRIP_ROT[s % STRIP_ROT.length]}deg`);

    slice.forEach((src, i) => {
      const n = s * perStrip + i + 1;
      const frame = document.createElement("div");
      frame.className = "lb-frame";

      const box = document.createElement("div");
      box.className = "lb-img";
      const img = new Image();
      img.alt = className === "lb-pos" ? "" : `Photo ${n}`;
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
      strip.append(frame);
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
  el.setAttribute("aria-label", "Eyepiece. Drag the glass to move it, turn the black ring or press plus and minus to change magnification, use the arrow keys to move.");
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
function buildControls(rows) {
  const nav = document.createElement("nav");
  nav.className = "lb-nav";
  nav.setAttribute("aria-label", "Sliders");

  const toggle = document.createElement("button");
  toggle.type = "button";
  toggle.className = "lb-nav-toggle";
  toggle.setAttribute("aria-expanded", "false");
  toggle.innerHTML = '<span>Sliders</span><svg viewBox="0 0 10 6" aria-hidden="true"><path d="M1 1l4 4 4-4"/></svg>';

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
    panel.append(label);
  }
  nav.append(toggle, panel);
  return { wrap: nav, setters };
}

export function mountLightBox(root, { photos, zoom = 1.2, shadow = 1.8, shadowFade = 0.85, clickVolume = 0.6, size, controls = true } = {}) {
  root.classList.add("lb-root");
  const stage = div("lb-stage");
  root.replaceChildren(stage);

  const loupe = buildEyepiece();
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
  let raf = 0;
  let layoutId = 0;
  let view = null;     // magnified window onto the lit sheet, drawn for the lens
  let fade = shadowFade;
  let lensPad = 0;

  const clamp = () => {
    goal.x = Math.max(0, Math.min(stage.clientWidth, goal.x));
    goal.y = Math.max(0, Math.min(stage.offsetHeight, goal.y));
  };

  const render = () => {
    loupe.el.style.transform = `translate(${cur.x - Do / 2}px, ${cur.y - Do / 2}px)`;
    if (lens && view) {
      view.render(cur.x, cur.y, zoom);
      // the aberration zone is the strip the ring's shadow covers, so it follows the Fade slider
      const edge = Math.max(6, Math.min(G * 0.45, D * 0.082 * fade));
      lens.draw(view.canvas, lensPad, edge);
    } else if (!lens) {
      // keep the point under the eyepiece centred in the glass, scaled up
      loupe.mag.style.transform = `translate(${G / 2 - zoom * cur.x}px, ${G / 2 - zoom * cur.y}px) scale(${zoom})`;
    }
    glass?.draw(cur.x, cur.y, D / 2);
  };

  const tick = () => {
    cur.x += (goal.x - cur.x) * 0.35;
    cur.y += (goal.y - cur.y) * 0.35;
    const done = Math.abs(goal.x - cur.x) < 0.2 && Math.abs(goal.y - cur.y) < 0.2;
    if (done) { cur.x = goal.x; cur.y = goal.y; }
    render();
    raf = done ? 0 : requestAnimationFrame(tick);
  };
  const kick = () => { if (!raf) raf = requestAnimationFrame(tick); };

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
    stage.replaceChildren(buildSheet(photos, cols, fw, "lb-neg"), loupe.el);

    if (!placed) {   // rest on the sheet, inside the first screenful
      goal.x = stage.clientWidth * 0.42;
      goal.y = Math.min(stage.offsetHeight * 0.5, innerHeight * 0.48);
      placed = true;
    }
    clamp();
    cur.x = goal.x; cur.y = goal.y;
    render();

    // read the laid-out sheet once; both glasses draw from it
    if (glass && lens) {
      const id = ++layoutId;
      readScene(stage, root)
        .then((scene) => {
          if (id !== layoutId) return;
          const neg = rasterizeNegative(scene);
          glass.setSource(neg.canvas, neg.width, neg.height);
          view = createLensView(scene, lens.dpr);
          view.resize(G + lensPad * 2);
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
  const clicker = createClicker({ volume: clickVolume });
  const detentOf = (z) => Math.floor((z - ZOOM_MIN) / 0.05 + 1e-6);
  let atStop = false;

  /* magnification drives the bezel angle, the lens and the slider together */
  function setZoom(z, { silent = false } = {}) {
    const prev = zoom;
    zoom = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, z));
    loupe.dial.style.transform = `rotate(${(zoom - ZOOM_MIN) * DEG_PER_ZOOM}deg)`;
    setters.zoom?.(zoom);
    render();
    if (silent) return;
    const crossed = Math.abs(detentOf(zoom) - detentOf(prev));
    if (crossed) clicker.click(crossed);
    const hitStop = zoom !== z;
    if (hitStop && !atStop) clicker.thud();
    atStop = hitStop;
  }
  setZoom(zoom, { silent: true });

  if (controls) {
    const c = buildControls([
      { key: "zoom", name: "Magnification", min: ZOOM_MIN, max: ZOOM_MAX, step: 0.05, value: zoom, onInput: setZoom },
      { key: "shadow", name: "Shadow strength", min: 0, max: 6, step: 0.05, value: shadow, onInput: setShadow },
      { key: "fade", name: "Shadow fade", min: 0.1, max: 3, step: 0.05, value: shadowFade, onInput: setFade },
      { key: "volume", name: "Click volume", min: 0, max: 1, step: 0.05, value: clickVolume, onInput: (v) => clicker.setVolume(v) },
    ]);
    setters = c.setters;
    root.classList.add("lb-has-nav");
    root.append(c.wrap);
  }

  // drag
  const grab = { x: 0, y: 0 };
  const pointerInStage = (e) => {
    const b = stage.getBoundingClientRect();
    return { x: e.clientX - b.left, y: e.clientY - b.top };
  };
  loupe.el.addEventListener("pointerdown", (e) => {
    e.preventDefault();
    loupe.el.setPointerCapture(e.pointerId);
    const p = pointerInStage(e);
    grab.x = p.x - goal.x; grab.y = p.y - goal.y;
    dragging = true;
    loupe.el.classList.add("is-drag");
  });
  loupe.el.addEventListener("pointermove", (e) => {
    if (!dragging) return;
    const p = pointerInStage(e);
    goal.x = p.x - grab.x; goal.y = p.y - grab.y;
    clamp(); kick();
  });
  const drop = () => { dragging = false; loupe.el.classList.remove("is-drag"); };
  loupe.el.addEventListener("pointerup", drop);
  loupe.el.addEventListener("pointercancel", drop);

  // turn the bezel: clockwise raises magnification, anticlockwise lowers it
  let turning = false;
  let lastAngle = 0;
  const angleOf = (e) => {
    const b = loupe.el.getBoundingClientRect();
    return Math.atan2(e.clientY - (b.top + b.height / 2), e.clientX - (b.left + b.width / 2));
  };
  loupe.ring.addEventListener("pointerdown", (e) => {
    e.preventDefault();
    e.stopPropagation();                     // the ring turns; it doesn't move the eyepiece
    loupe.ring.setPointerCapture(e.pointerId);
    clicker.unlock();                        // browsers only start audio from a gesture
    turning = true;
    lastAngle = angleOf(e);
    loupe.el.classList.add("is-turn");
  });
  loupe.ring.addEventListener("pointermove", (e) => {
    if (!turning) return;
    const a = angleOf(e);
    let d = a - lastAngle;
    if (d > Math.PI) d -= 2 * Math.PI;
    if (d < -Math.PI) d += 2 * Math.PI;
    lastAngle = a;
    setZoom(zoom + ((d * 180) / Math.PI) / DEG_PER_ZOOM);
  });
  const stopTurn = () => { turning = false; loupe.el.classList.remove("is-turn"); };
  loupe.ring.addEventListener("pointerup", stopTurn);
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
