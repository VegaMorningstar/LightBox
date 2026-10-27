/* socket-buttons: round push buttons set into a surface (see buttons.css for the look).
 *
 *   import { createSocketButton, mountSocketCorner, setCovered, setPressed, paintSocketButton, ICONS } from "./socket-buttons/buttons.js";
 *
 *   const reset = createSocketButton({
 *     icon: ICONS.reset, label: "Reset",
 *     onClick: () => doReset(),
 *     onPress: (phase) => playClick(phase),      // "down" as it goes in, "up" as it comes back (also for the keyboard)
 *   });
 *   mountSocketCorner(containerElement, [other, reset]);     // left to right, in the container's top right corner
 *
 * If something can lie over the buttons (a sheet that slides, say), call setCovered(button, true) while it does: the button
 * then ignores presses, and they reach what is on top. Put the row in the container *under* that thing (container.prepend(row)).
 *
 * The container must be positioned (position: relative/absolute). Where the corner sits is set with --sb-top / --sb-right.
 * Importing this file loads buttons.css next to it (unless a stylesheet with that address is already on the page).
 */

const CSS_URL = new URL("./buttons.css", import.meta.url).href;

function ensureStyles() {
  if ([...document.styleSheets].some((s) => s.href === CSS_URL) || document.querySelector(`link[href="${CSS_URL}"]`)) return;
  const link = document.createElement("link");
  link.rel = "stylesheet";
  link.href = CSS_URL;
  document.head.append(link);
}

/* The etching: the icon is cut into the ivory. A dark band on the upper-left inside edge, and a light lip on the lower-right.
   One shared filter, defined once on the page, used by every icon. */
const ETCH = `<svg width="0" height="0" style="position:absolute" aria-hidden="true"><defs><filter id="sb-etch" filterUnits="userSpaceOnUse" x="-2" y="-2" width="28" height="28" color-interpolation-filters="sRGB"><feOffset in="SourceAlpha" dx=".55" dy=".7" result="s"/><feComposite in="SourceAlpha" in2="s" operator="out" result="band"/><feGaussianBlur in="band" stdDeviation=".22" result="bandSoft"/><feFlood flood-color="#000" flood-opacity=".9"/><feComposite in2="bandSoft" operator="in" result="shadow"/><feComposite in="shadow" in2="SourceAlpha" operator="in" result="shadowIn"/><feOffset in="SourceAlpha" dx=".6" dy=".85" result="s2"/><feComposite in="s2" in2="SourceAlpha" operator="out" result="lipBand"/><feGaussianBlur in="lipBand" stdDeviation=".18" result="lipSoft"/><feFlood flood-color="#fffdf6" flood-opacity=".95"/><feComposite in2="lipSoft" operator="in" result="lip"/><feMerge><feMergeNode in="lip"/><feMergeNode in="SourceGraphic"/><feMergeNode in="shadowIn"/></feMerge></filter></defs></svg>`;
function ensureDefs() {
  if (document.getElementById("sb-etch")) return;
  const holder = document.createElement("div");
  holder.innerHTML = ETCH;
  document.body.append(holder.firstElementChild);
}

/* The artwork as data, so it can be drawn as markup (buttons) or straight onto a canvas (paintSocketButton). */
const ICON_DATA = {
  // two arrows chasing each other round (reset / shuffle)
  reset: {
    strokes: ["M5.47 8.96A7.2 7.2 0 0 1 17.09 6.91", "M18.53 15.04A7.2 7.2 0 0 1 6.91 17.09"],
    fills: ["M19.64 9.45L19.28 4.72L14.90 9.10Z", "M4.36 14.55L4.72 19.28L9.10 14.90Z"],
    circles: [], width: 2.5,
  },
  // three sliders
  sliders: { strokes: ["M4 7h16M4 12h16M4 17h16"], fills: [], circles: [[9, 7, 2.4], [15.5, 12, 2.4], [8, 17, 2.4]], width: 2 },
};
const toMarkup = (d) =>
  d.strokes.map((p) => `<path class="arc" stroke-width="${d.width}" d="${p}"/>`).join("") +
  d.fills.map((p) => `<path class="hd" d="${p}"/>`).join("") +
  d.circles.map(([x, y, r]) => `<circle class="hd" cx="${x}" cy="${y}" r="${r}"/>`).join("");
export const ICONS = Object.fromEntries(Object.entries(ICON_DATA).map(([k, d]) => [k, toMarkup(d)]));

/* Draw a button onto a canvas, as it looks on the page, for anything that redraws the surface itself (a magnifier over it, say).
   ctx: a 2D context, already transformed so one unit is one css px. x, y: the button's centre. size: its diameter.
   icon: a name from ICONS. surface: "wood" for a button set in dark wood (a nav bar). Pressed state is not drawn. */
export function paintSocketButton(ctx, { x, y, size, icon, surface }) {
  const r = size / 2;
  const disc = (cx, cy, rad, fill) => { ctx.beginPath(); ctx.arc(cx, cy, rad, 0, Math.PI * 2); ctx.fillStyle = fill; ctx.fill(); };
  ctx.save();
  ctx.translate(x, y);
  // the socket: a lit lip on the lower right, a shaded one on the upper left, and the dark gap
  const wood = surface === "wood";                                  // on dark wood the lip is faint and warm, the gap dark
  disc(1.2, 1.8, r + 2.9, wood ? "rgba(255,214,160,.22)" : "rgba(255,252,240,.85)");
  disc(-.8, -1, r + 2.9, wood ? "rgba(0,0,0,.35)" : "rgba(70,48,26,.3)");
  disc(0, 0, r + 2, wood ? "rgba(6,2,0,.7)" : "rgba(58,40,22,.5)");
  // the rim
  const rim = ctx.createLinearGradient(-r, -r, r, r);
  rim.addColorStop(0, "#5a4636"); rim.addColorStop(.45, "#33271c"); rim.addColorStop(1, "#17110b");
  disc(0, 0, r, rim);
  disc(.9, 1.1, r - 1, "rgba(10,6,2,.35)");
  // the frosted ivory top
  const top = ctx.createLinearGradient(-r * .7, -r * .7, r * .7, r * .7);
  top.addColorStop(0, "#e9e2d2"); top.addColorStop(.6, "#d9d0bc"); top.addColorStop(1, "#c8bda6");
  disc(0, 0, r - 3, top);
  const glow = ctx.createRadialGradient(-r * .25, -r * .3, 0, -r * .25, -r * .3, r * .75);
  glow.addColorStop(0, "rgba(255,255,255,.35)"); glow.addColorStop(1, "rgba(255,255,255,0)");
  disc(0, 0, r - 3, glow);
  // the etched icon: a light lip on the lower right, then the dark icon
  const d = ICON_DATA[icon];
  if (d) {
    const k = (size * 0.47) / 24;
    const draw = (dx, dy, colour) => {
      ctx.save();
      ctx.translate(-12 * k + dx, -12 * k + dy);
      ctx.scale(k, k);
      ctx.strokeStyle = colour; ctx.fillStyle = colour; ctx.lineWidth = d.width;
      for (const p of d.strokes) ctx.stroke(new Path2D(p));
      for (const p of d.fills) ctx.fill(new Path2D(p));
      for (const [cx, cy, rad] of d.circles) { ctx.beginPath(); ctx.arc(cx, cy, rad, 0, Math.PI * 2); ctx.fill(); }
      ctx.restore();
    };
    draw(.6, .8, "rgba(255,253,246,.9)");
    draw(0, 0, "#1e1916");
  }
  ctx.restore();
}

/* One button. icon: markup from ICONS (or your own). label: its accessible name and tooltip. onClick: what it does.
   onPress(phase): "down" / "up", for a click sound. Returns the <button>. */
export function createSocketButton({ icon, label = "", onClick, onPress } = {}) {
  ensureStyles();
  ensureDefs();
  const b = document.createElement("button");
  b.type = "button";
  b.className = "sb-button";
  b.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true"><g filter="url(#sb-etch)">${icon ?? ""}</g></svg>`;
  b.dataset.icon = Object.keys(ICONS).find((k) => ICONS[k] === icon) ?? "";
  b.setAttribute("aria-label", label);
  b.title = label;
  // a real push button: it clicks as it goes down, and again (more lightly) as it comes back up
  b.addEventListener("pointerdown", () => { onPress?.("down"); b.dataset.sounded = "1"; });
  b.addEventListener("pointerup", () => onPress?.("up"));
  b.addEventListener("click", (e) => {
    if (e.detail === 0 && !b.dataset.sounded) { onPress?.("down"); setTimeout(() => onPress?.("up"), 70); }   // from the keyboard
    delete b.dataset.sounded;
    onClick?.(e);
  });
  return b;
}

/* Put buttons in a row in the container's top right corner (side: "left" for the top left one). Returns the row element. */
export function mountSocketCorner(container, buttons, { side = "right" } = {}) {
  ensureStyles();
  const row = document.createElement("div");
  row.className = side === "left" ? "sb-corner sb-corner-left" : "sb-corner";
  row.append(...buttons);
  container.append(row);
  return row;
}

/* Mark a button as covered (something lies on top of it): it stops taking presses, so they fall through to whatever is on top. */
export function setCovered(button, covered) {
  if (covered) button.setAttribute("data-covered", ""); else button.removeAttribute("data-covered");
}

/* A button that stays pressed in (a toggle's "on" state). */
export function setPressed(button, on) {
  button.setAttribute("aria-pressed", String(on));
}
