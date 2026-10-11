/* LightBox — contact-sheet-on-a-light-box effect.
 *
 *   import { mountLightBox } from "./lightbox/lightbox.js";
 *   mountLightBox(document.querySelector("#sheet"), { photos: ["a.jpg", "b.jpg"] });
 *
 * Photos render twice: an inverted "negative" sheet, and a "positive" sheet that is only
 * visible through a soft circle of light that grows under the pointer.
 */

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

export function mountLightBox(root, { photos, radius } = {}) {
  root.classList.add("lb-root");
  const stage = document.createElement("div");
  stage.className = "lb-stage";
  root.replaceChildren(stage);

  const glow = document.createElement("div");
  glow.className = "lb-glow";

  let lastWidth = 0;
  function layout() {
    const pad = Math.max(20, Math.min(56, root.clientWidth * 0.04));
    stage.style.setProperty("--pad", `${pad}px`);
    const inner = stage.clientWidth - pad * 2;
    lastWidth = root.clientWidth;
    const cols = columnsFor(inner);
    // strip = 1.42 fw wide, gaps = 0.16 fw
    const fw = Math.min(260, inner / (cols * 1.42 + (cols - 1) * 0.16));
    stage.replaceChildren(
      glow,
      buildSheet(photos, cols, fw, "lb-neg"),
      buildSheet(photos, cols, fw, "lb-pos"),
    );
  }
  layout();

  // light follows the pointer; radius grows on enter and shrinks on leave
  const target = { x: -999, y: -999, r: 0 };
  const cur = { x: -999, y: -999, r: 0 };
  const maxR = () => radius ?? Math.max(210, Math.min(420, Math.min(innerWidth, innerHeight) * 0.38));
  let raf = 0;

  const paint = () => {
    // vars live on the stage so glow + positive sheet share them
    stage.style.setProperty("--x", `${cur.x}px`);
    stage.style.setProperty("--y", `${cur.y}px`);
    stage.style.setProperty("--r", `${cur.r}px`);
  };
  const tick = () => {
    if (cur.r < 1 && target.r === 0) { cur.x = target.x; cur.y = target.y; }
    cur.x += (target.x - cur.x) * 0.22;
    cur.y += (target.y - cur.y) * 0.22;
    cur.r += (target.r - cur.r) * 0.1;
    paint();
    const settled =
      Math.abs(target.x - cur.x) < 0.3 && Math.abs(target.y - cur.y) < 0.3 && Math.abs(target.r - cur.r) < 0.3;
    raf = settled ? 0 : requestAnimationFrame(tick);
  };
  const kick = () => { if (!raf) raf = requestAnimationFrame(tick); };

  let px = 0, py = 0;
  const move = (e) => {
    px = e.clientX; py = e.clientY;
    aim();
  };
  const aim = () => {
    const b = stage.getBoundingClientRect();
    const wasOff = target.r === 0;
    target.x = px - b.left;
    target.y = py - b.top;
    target.r = maxR();
    if (wasOff && cur.r < 1) { cur.x = target.x; cur.y = target.y; } // appear where the pointer is
    kick();
  };
  const leave = () => { target.r = 0; kick(); };
  addEventListener("scroll", () => { if (target.r > 0) aim(); }, { passive: true });

  root.addEventListener("pointermove", move);
  root.addEventListener("pointerdown", move);
  root.addEventListener("pointerleave", leave);
  root.addEventListener("pointerup", (e) => { if (e.pointerType === "touch") leave(); });
  document.addEventListener("mouseleave", leave);

  let t;
  addEventListener("resize", () => {
    clearTimeout(t);
    t = setTimeout(() => { if (root.clientWidth !== lastWidth) layout(); }, 150);
  });
}
