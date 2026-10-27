/* start-screen: the page opens on the light box with its light OFF, waits until everything on it is fully drawn, then the switch goes over and the light
 * flashes at once, over-brightens (the light spills past the film) and settles to the normal state. A sound plays with it. The over-bright light passes
 * only through what is see-through (the board, the pictures); the opaque parts stay dark. It takes about 1.6 s, and then the page is exactly as it
 * always was: the layers are removed. The same light can be turned off and on again at will (turnOff, turnOn: the brass switch next to the volume knob).
 *
 *   import { createStartScreen } from "./start-screen/start-screen.js";
 *
 *   const start = createStartScreen({
 *     host: stage,                    // the element it covers (it must be positioned); the two layers are start.els
 *     ready: promise,                 // settles when everything under it is drawn (it is not waited for longer than MAX_WAIT)
 *     play: (kind) => promise,        // optional: start the sound, kind "on" (flash) or "off" (a single click); resolves true once it is playing (see sound.js)
 *     length: 1600,                   // ms, the whole light-up (1000..3000 is about right)
 *     enabled: true,                  // false: never darkens
 *   });
 *   host.append(...start.els);        // (and keep them in the host if it is ever rebuilt)
 *   start.onState = (on) => ...;      // called when the light goes on (true) or off (false): move a switch to match
 *   start.run();                      // wait for ready, then light up (call once)
 *   start.replay();                   // dark again, then light up after a moment (no waiting for ready)
 *   start.turnOff(); start.turnOn();  // the light off at once (it dies away in about a fifth of a second) / on at once, with the flash
 *   start.on; start.length = 2000; start.enabled = false;
 *
 * Under "reduce motion" there is no flash and no sound: the light just fades up over about half a second.
 * The shape of the light-up is in timeline.js; the sound's in sound.js; the rules are in PHYSICS.md.
 */

import { BASE_MS, lightAt } from "./timeline.js";

const DARK = 0.9;           // how much of the light is gone while it is off (so a tenth of it still shows: the room is not pitch black)
const DWELL = 600;          // ms the unlit screen is held after everything is ready, so it is seen
const MAX_WAIT = 6000;      // ms: never keep the page dark longer than this, whatever is still loading
const OFF_MS = 220;         // ms the light takes to die away when it is switched off

const delay = (ms) => new Promise((r) => setTimeout(r, ms));
const frames = (n) => new Promise((r) => { const f = () => (--n <= 0 ? r() : requestAnimationFrame(f)); requestAnimationFrame(f); });
const smooth = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

export function createStartScreen({ host, ready = Promise.resolve(), play = null, length = BASE_MS, enabled = true } = {}) {
  const dark = document.createElement("div"); dark.className = "ss-dark";
  const bloom = document.createElement("div"); bloom.className = "ss-bloom"; bloom.style.display = "none";
  const reduced = typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
  const made = performance.now();
  let token = 0;
  let level = 0;            // how bright the light is right now (0..1), so switching off starts from where it is
  const api = {
    els: [dark, bloom], phase: "off", length, enabled, on: false, onState: null,
    replay: () => run(false, performance.now()),
    run: () => run(true, made),
    turnOn, turnOff,
  };

  function setOn(v) { if (api.on !== v) { api.on = v; api.onState?.(v); } }

  function apply(light, over) {
    level = light;
    dark.style.opacity = String(DARK * (1 - light));
    // Over-bright light is a GAIN on what is lit, not light added on top: it multiplies what lies under it, so the bare board and the pictures (which let light
    // through) get much brighter while the opaque parts (the film's borders, the eyepiece's black ring, the buttons) stay as dark as they were. A trace of
    // blur lets the glow just soften past the film's edge.
    const on = over > 0.004;
    bloom.style.display = on ? "" : "none";
    bloom.style.backdropFilter = bloom.style.webkitBackdropFilter = on ? `blur(${(over * 3).toFixed(1)}px) brightness(${(1 + over * 2).toFixed(3)})` : "none";
  }
  function show(on) { dark.style.display = on ? "" : "none"; if (!on) bloom.style.display = "none"; }

  /* the switch goes over: the sound, the flash, and the settle to normal. `mine` is the run's token: a newer run (or a switch-off) cancels this one */
  async function lightUp(mine) {
    const scale = api.length / BASE_MS;
    if (!reduced && play) { try { await play("on"); } catch { /* no sound: carry on */ } }
    if (mine !== token) return;
    api.phase = "lighting";
    setOn(true);
    const t0 = performance.now();
    const tick = (now) => {
      if (mine !== token) return;
      const ms = (now - t0) / scale;
      const s = reduced ? { light: smooth(0, 600, now - t0), bloom: 0, done: now - t0 >= 600 } : lightAt(ms);
      if (s.done) { show(false); apply(1, 0); api.phase = "done"; return; }
      apply(s.light, s.bloom);
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }

  async function run(wait, since) {
    const mine = ++token;
    api.phase = "off";
    setOn(false);
    if (!api.enabled) { show(false); api.phase = "done"; setOn(true); return; }
    show(true); apply(0, 0);
    if (wait) await Promise.race([ready, delay(MAX_WAIT)]);
    if (mine !== token) return;
    await frames(2);                                                    // let the unlit screen be painted
    const hold = DWELL - (performance.now() - since);
    if (hold > 0) await delay(hold);
    if (mine !== token) return;
    await lightUp(mine);
  }

  function turnOn() {
    if (!api.enabled || api.on) return;
    const mine = ++token;
    show(true); apply(0, 0);
    lightUp(mine);
  }

  function turnOff() {
    if (!api.enabled || (!api.on && api.phase === "off")) return;
    const mine = ++token;
    const from = level;
    api.phase = "off";
    setOn(false);
    show(true); apply(from, 0);
    if (!reduced && play) Promise.resolve(play("off")).catch(() => {});
    const t0 = performance.now();
    const tick = (now) => {
      if (mine !== token) return;
      const k = 1 - smooth(0, OFF_MS, now - t0);
      apply(from * k * k, 0);                                           // it dies away quickly at first, then lingers a moment, as a lamp does
      if (now - t0 < OFF_MS) requestAnimationFrame(tick); else apply(0, 0);
    };
    requestAnimationFrame(tick);
  }

  if (api.enabled) { show(true); apply(0, 0); } else show(false);        // dark from the very first frame the host is on screen
  return api;
}
