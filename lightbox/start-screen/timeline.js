/* The start screen's timeline: how bright the light box is, and how much it blooms, at each moment after "go". Pure numbers, no DOM, so the picture
 * (start-screen.js) and the sound (sound.js) read the very same moments and stay in step.
 *
 * Times are in ms on a base run of BASE_MS; a run of any other length is the same shape stretched (scale = length / BASE_MS).
 *
 * The light comes on the way a tube does: a few weak flickers, then it strikes, over-shoots (brighter than normal, the glow spilling past the film)
 * and settles back to exactly the normal state.
 */

export const BASE_MS = 1600;

/* the first, weak flashes before it strikes: when each starts, how long it lasts, how bright it gets (0..1 of the normal light) */
export const FLICKERS = [
  { at: 0, dur: 70, h: 0.28 },
  { at: 150, dur: 55, h: 0.16 },
  { at: 245, dur: 95, h: 0.42 },
  { at: 400, dur: 60, h: 0.24 },
];
export const STRIKE_AT = 540;       // ms: the light strikes
const RISE = 240;                   // ms it takes to reach its peak
const PEAK = 1.5;                   // how far over normal it goes (1 = normal)
const SETTLE = 200;                 // ms: how quickly the over-brightness dies away
const FADE_OUT = 140;               // ms at the end: the last of it is eased to nothing, so it lands on the normal state without a step

const smooth = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

/* the light at `ms` into a run of BASE_MS: { light, bloom, done }
   light: 0 = off .. 1 = normal brightness. bloom: how far over normal it is, 0 when normal (it drives the glow spilling past the film). */
export function lightAt(ms) {
  let flick = 0;
  for (const f of FLICKERS) {
    if (ms >= f.at && ms <= f.at + f.dur) flick = Math.max(flick, f.h * Math.sin(Math.PI * (ms - f.at) / f.dur) ** 2);
  }
  let main = 0;
  if (ms >= STRIKE_AT) {
    const u = Math.min(1, (ms - STRIKE_AT) / RISE);
    const rise = 1 - Math.pow(1 - u, 3);                                   // fast at first, easing into the peak
    const over = (PEAK - 1) * Math.exp(-Math.max(0, ms - STRIKE_AT - RISE) / SETTLE) * (1 - smooth(BASE_MS - FADE_OUT, BASE_MS, ms));
    main = ms < STRIKE_AT + RISE ? rise * PEAK : 1 + over;
  }
  const light = Math.max(flick, main);
  const bloom = Math.max(0, light - 1) + 0.18 * flick;                     // each flicker also flashes a little
  return { light: Math.min(1, light), bloom, done: ms >= BASE_MS };
}
