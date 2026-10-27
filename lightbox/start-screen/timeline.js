/* The start screen's timeline: how bright the light box is, and how much it blooms, at each moment after "go" (the instant the switch is thrown).
 * Pure numbers, no DOM, so the picture (start-screen.js) and the sound (sound.js) start at the same moment and stay in step.
 *
 * Times are in ms on a base run of BASE_MS; a run of any other length is the same shape stretched (scale = length / BASE_MS).
 *
 * The switch goes over and the light flashes at once: it jumps to brighter than normal (the glow spilling past the film) and settles back to exactly
 * the normal state.
 */

export const BASE_MS = 1600;

const RISE = 90;                    // ms it takes to flash up to its peak (a flash: nearly at once)
const PEAK = 1.5;                   // how far over normal it goes (1 = normal)
const SETTLE = 260;                 // ms: how quickly the over-brightness dies away
const FADE_OUT = 160;               // ms at the end: the last of it is eased to nothing, so it lands on the normal state without a step

const smooth = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

/* the light at `ms` into a run of BASE_MS: { light, bloom, done }
   light: 0 = off .. 1 = normal brightness. bloom: how far over normal it is, 0 when normal (it drives the glow spilling past the film). */
export function lightAt(ms) {
  const u = Math.min(1, Math.max(0, ms / RISE));
  const rise = 1 - Math.pow(1 - u, 3);                                     // fast at first, easing into the peak
  const over = (PEAK - 1) * Math.exp(-Math.max(0, ms - RISE) / SETTLE) * (1 - smooth(BASE_MS - FADE_OUT, BASE_MS, ms));
  const light = ms < RISE ? rise * PEAK : 1 + over;
  return { light: Math.min(1, light), bloom: Math.max(0, light - 1), done: ms >= BASE_MS };
}
