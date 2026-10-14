/* socket-buttons: a rotary knob set into a surface (see knob.css for the look), the sibling of the push buttons in buttons.js.
 *
 *   import { createSocketKnob, mountSocketCorner } from "./socket-buttons/...";   // mountSocketCorner is in buttons.js
 *
 *   const volume = createSocketKnob({
 *     label: "Volume", min: 0, max: 2, value: 1, home: 1,            // home: a value the knob catches on (a detent), as well as both ends
 *     onInput: (v) => setVolume(v),
 *     onTick: (n) => clickSound(n),         // n small clicks as it turns past n steps
 *     onNotch: () => notchSound(),          // it drops into a detent (home, or either end)
 *     onStop: () => thudSound(),            // it hits an end
 *   });
 *   mountSocketCorner(container, [volume.el]);
 *   volume.set(1.4);                        // move it from outside (no sounds, no onInput)
 *
 * A knob turns by dragging round its centre (like a real one), or with the arrow keys. It sweeps 270 degrees from min to max, with the
 * mark pointing straight up at the middle. Light is from the upper left, so the knurled rim turns but the sheen on the face stays put.
 */

const CSS_URL = new URL("./knob.css", import.meta.url).href;
const SWEEP = 135;            // degrees either side of straight up
const STEPS = 20;             // clicks across the whole sweep
const HOLD = 7;               // degrees of extra turn needed to break out of a detent

function ensureStyles() {
  if ([...document.styleSheets].some((s) => s.href === CSS_URL) || document.querySelector(`link[href="${CSS_URL}"]`)) return;
  const link = document.createElement("link");
  link.rel = "stylesheet";
  link.href = CSS_URL;
  document.head.append(link);
}

/* the scale round the knob: small marks every step, longer ones at the ends and the middle, drawn once as SVG */
function marks() {
  const svg = `<svg class="sb-knob-marks" viewBox="-50 -50 100 100" aria-hidden="true">` +
    Array.from({ length: STEPS + 1 }, (_, i) => {
      const a = ((-SWEEP + (2 * SWEEP * i) / STEPS) * Math.PI) / 180, major = i === 0 || i === STEPS || i === STEPS / 2;
      const r0 = 41.5, r1 = major ? 47.5 : 44.5;
      return `<line x1="${(Math.sin(a) * r0).toFixed(2)}" y1="${(-Math.cos(a) * r0).toFixed(2)}" x2="${(Math.sin(a) * r1).toFixed(2)}" y2="${(-Math.cos(a) * r1).toFixed(2)}" stroke-width="${major ? 1.5 : 1}"/>`;
    }).join("") + `<g class="sb-knob-sign"><path d="M-40 47.5h8"/><path d="M32 47.5h8M36 43.5v8"/></g></svg>`;
  return svg;
}

export function createSocketKnob({ label = "", min = 0, max = 1, value = 0.5, home = null, onInput, onTick, onNotch, onStop } = {}) {
  ensureStyles();
  const el = document.createElement("div");
  el.className = "sb-knob";
  el.tabIndex = 0;
  el.setAttribute("role", "slider");
  el.setAttribute("aria-label", label);
  el.title = label;
  el.setAttribute("aria-valuemin", String(min));
  el.setAttribute("aria-valuemax", String(max));
  el.dataset.icon = "knob";
  el.innerHTML = `${marks()}<div class="sb-knob-turn"></div><div class="sb-knob-face"></div><div class="sb-knob-turn sb-knob-mark"></div>`;
  const turning = [...el.querySelectorAll(".sb-knob-turn")];

  const toAngle = (v) => -SWEEP + ((v - min) / (max - min)) * 2 * SWEEP;
  const toValue = (a) => min + ((a + SWEEP) / (2 * SWEEP)) * (max - min);
  const homeAngle = home === null ? null : toAngle(home);
  const detents = [-SWEEP, SWEEP, ...(homeAngle === null ? [] : [homeAngle])];
  let angle = toAngle(Math.min(max, Math.max(min, value)));
  let held = null;           // the detent the knob is sitting in, until it is turned far enough to break out

  const show = () => {
    turning.forEach((t) => (t.style.transform = `rotate(${angle.toFixed(2)}deg)`));
    el.dataset.angle = angle.toFixed(2);
    el.setAttribute("aria-valuenow", toValue(angle).toFixed(2));
  };
  show();

  /* move the knob by `d` degrees as a hand would: it clicks past each step, catches in a detent, and stops at the ends */
  function turnBy(d) {
    const raw = angle + d;
    const prev = angle;
    if (held !== null) {
      if (Math.abs(raw - held) < HOLD) return;              // held in the notch
      held = null;
    }
    let next = Math.max(-SWEEP, Math.min(SWEEP, raw));
    if (next !== raw && prev !== next) onStop?.();         // hit an end
    // a detent crossed (or arrived at): drop into it
    const hit = detents.find((a) => (prev - a) * (next - a) < 0 || (Math.abs(next - a) < 1.5 && Math.abs(prev - a) >= 1.5));
    if (hit !== undefined) { next = hit; held = hit; }
    const stepDeg = (2 * SWEEP) / STEPS;
    const crossed = Math.abs(Math.floor((next + SWEEP) / stepDeg) - Math.floor((prev + SWEEP) / stepDeg));
    angle = next;
    show();
    if (hit !== undefined) onNotch?.(); else if (crossed) onTick?.(crossed);
    if (next !== prev) onInput?.(toValue(angle));
  }

  // drag round the centre
  let last = null;
  const pointerAngle = (e) => {
    const r = el.getBoundingClientRect();
    return (Math.atan2(e.clientX - (r.left + r.width / 2), -(e.clientY - (r.top + r.height / 2))) * 180) / Math.PI;
  };
  el.addEventListener("pointerdown", (e) => {
    e.preventDefault(); e.stopPropagation();
    el.setPointerCapture(e.pointerId);
    last = pointerAngle(e);
    el.classList.add("is-turning");
  });
  el.addEventListener("pointermove", (e) => {
    if (last === null) return;
    const a = pointerAngle(e);
    let d = a - last;
    if (d > 180) d -= 360; else if (d < -180) d += 360;
    last = a;
    if (d) turnBy(d);
  });
  const end = () => { last = null; el.classList.remove("is-turning"); };
  el.addEventListener("pointerup", end);
  el.addEventListener("pointercancel", end);
  el.addEventListener("lostpointercapture", end);
  el.addEventListener("keydown", (e) => {
    const k = { ArrowRight: 1, ArrowUp: 1, ArrowLeft: -1, ArrowDown: -1 }[e.key];
    if (!k) return;
    e.preventDefault();
    held = null;
    turnBy((k * 2 * SWEEP) / STEPS);
  });

  return {
    el,
    /* move it from outside: no sound, no onInput */
    set(v) { angle = toAngle(Math.min(max, Math.max(min, v))); held = null; show(); },
    get value() { return toValue(angle); },
  };
}

/* Draw a knob onto a canvas as it looks on the page, for anything that redraws the surface itself (a magnifier over it, say).
   ctx: a 2D context, one unit = one css px. x, y: its centre. size: its diameter. angle: its turn in degrees. */
export function paintSocketKnob(ctx, { x, y, size, angle = 0 }) {
  const r = size / 2;
  const disc = (cx, cy, rad, fill) => { ctx.beginPath(); ctx.arc(cx, cy, rad, 0, Math.PI * 2); ctx.fillStyle = fill; ctx.fill(); };
  ctx.save();
  ctx.translate(x, y);
  disc(1.2, 1.8, r + 2.9, "rgba(255,252,240,.85)");
  disc(-.8, -1, r + 2.9, "rgba(70,48,26,.3)");
  disc(0, 0, r + 2, "rgba(58,40,22,.5)");
  // the knurled rim: it turns
  ctx.save();
  ctx.rotate((angle * Math.PI) / 180);
  disc(0, 0, r, "#6f6757");
  ctx.strokeStyle = "rgba(30,24,16,.8)";
  ctx.lineWidth = 1.4;
  for (let i = 0; i < 48; i++) {
    const a = (i / 48) * Math.PI * 2;
    ctx.beginPath(); ctx.moveTo(Math.sin(a) * (r - 4.5), -Math.cos(a) * (r - 4.5)); ctx.lineTo(Math.sin(a) * r, -Math.cos(a) * r); ctx.stroke();
  }
  ctx.restore();
  // the brushed face: static sheen
  const face = ctx.createLinearGradient(-r * .7, -r * .7, r * .7, r * .7);
  face.addColorStop(0, "#f1e8cf"); face.addColorStop(.35, "#c3b693"); face.addColorStop(.6, "#efe6cc"); face.addColorStop(1, "#a99d80");
  disc(0, 0, r - 6, face);
  // the mark
  ctx.save();
  ctx.rotate((angle * Math.PI) / 180);
  ctx.strokeStyle = "#2a2118";
  ctx.lineWidth = 3;
  ctx.lineCap = "round";
  ctx.beginPath(); ctx.moveTo(0, -r * .28); ctx.lineTo(0, -(r - 9)); ctx.stroke();
  ctx.restore();
  ctx.restore();
}
