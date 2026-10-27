/* The start-up sound: the click of a mechanical switch being thrown, like a film camera. It follows the same moments as the picture (timeline.js):
 * a few dry ratchet clicks for the weak flickers (the winder's pawl), then at the strike a hard shutter snap ("ka-clack", a bright snap and a lower
 * clack) over a low thud of the switch, then a short film-winder whirr: a small motor with a ratchet that speeds up and slows down as the light settles.
 *
 * It is built from the audio parts sounds.js owns, handed over once as `audio`:
 *   vols            the volume settings (vols.strobe is this sound's level; 0 is silent)
 *   ensure()        start the audio if it is not started yet (returns it, or null when there is no audio)
 *   ctx() noise() strobeMaster()   the audio context, the shared noise buffer and this sound's own volume node
 *   jitter, envelope, noiseBurst, tone   the small building blocks the sounds share
 *
 *   const strobe = createStrobeSound(audio);
 *   await strobe.play(scale);       // scale = run length / BASE_MS. Resolves true once it is playing, false if the browser would not start audio
 *
 * Browsers only start audio after the visitor has touched the page (a click, a tap or a key), so on a first visit with no touch yet there is no sound:
 * it is skipped rather than queued, because a late snap would sound wrong. It plays whenever the browser allows (e.g. on the replay button).
 */

import { FLICKERS, STRIKE_AT } from "./timeline.js";

export function createStrobeSound(audio) {
  const { vols, ensure, jitter, envelope, noiseBurst, tone } = audio;
  return {
    async play(scale = 1) {
      if (vols.strobe <= 0 || !ensure()) return false;
      const ctx = audio.ctx(), noise = audio.noise(), master = audio.strobeMaster();
      if (ctx.state !== "running") await Promise.race([ctx.resume().catch(() => {}), new Promise((r) => setTimeout(r, 150))]);
      if (ctx.state !== "running") return false;                       // the browser is holding audio back: stay silent
      const t0 = ctx.currentTime + 0.02;
      const at = (ms) => t0 + (ms * scale) / 1000;
      const strike = at(STRIKE_AT);

      // one dry ratchet click (a pawl dropping onto a tooth): a short bright tick over a small wooden "tock"
      const tick = (t, k) => {
        noiseBurst(t, { type: "bandpass", freq: 2700 * jitter(0.1), q: 1.4, peak: 0.5 * k, decay: 0.011, attack: 0.0005 }, master);
        tone(t, { type: "sine", from: 540 * jitter(0.05), to: 240, peak: 0.22 * k, decay: 0.022, sweep: 0.012 }, master);
      };

      // the weak flickers: single ratchet clicks, the last ones a little firmer
      for (const f of FLICKERS) tick(at(f.at), 0.5 + f.h);

      // the strike: a shutter snap, "ka" then "clack", over the heavy thud of the switch going over
      noiseBurst(strike, { type: "bandpass", freq: 3300 * jitter(0.05), q: 0.9, peak: 0.95, decay: 0.014, attack: 0.0004 }, master);
      tone(strike, { type: "triangle", from: 3500 * jitter(0.04), to: 2100, peak: 0.16, decay: 0.03, sweep: 0.02 }, master);
      const clack = strike + 0.024;
      noiseBurst(clack, { type: "bandpass", freq: 1100 * jitter(0.06), q: 0.8, peak: 0.75, decay: 0.032, attack: 0.0005 }, master);
      tone(clack, { type: "sine", from: 250 * jitter(0.04), to: 90, peak: 0.6, decay: 0.08, sweep: 0.05 }, master);
      tone(strike, { type: "sine", from: 130 * jitter(0.03), to: 48, peak: 0.65, decay: 0.17, sweep: 0.1 }, master);
      noiseBurst(strike, { type: "lowpass", freq: 420, q: 0.7, peak: 0.5, decay: 0.06, attack: 0.001 }, master);

      // the film winder: a small motor whirr (a buzzy tone that climbs and eases off) with its ratchet clicking faster, then slower
      const w0 = strike + 0.1, wLen = 0.62 * scale;
      const motor = ctx.createOscillator();
      motor.type = "sawtooth";
      motor.frequency.setValueAtTime(88, w0);
      motor.frequency.linearRampToValueAtTime(150, w0 + wLen * 0.4);
      motor.frequency.linearRampToValueAtTime(104, w0 + wLen);
      const bp = ctx.createBiquadFilter();
      bp.type = "bandpass"; bp.frequency.value = 760; bp.Q.value = 2.2;
      const mg = ctx.createGain();
      mg.gain.setValueAtTime(0.0001, w0);
      mg.gain.exponentialRampToValueAtTime(0.11, w0 + 0.03);
      mg.gain.setValueAtTime(0.11, w0 + wLen * 0.7);
      mg.gain.exponentialRampToValueAtTime(0.0001, w0 + wLen);
      motor.connect(bp).connect(mg).connect(master);
      motor.start(w0); motor.stop(w0 + wLen + 0.05);
      for (let t = 0, gap = 0.05 * scale; t < wLen - 0.02; t += gap) {      // the ratchet: quickens to the middle of the run, then slows
        const u = t / wLen;
        tick(w0 + t, 0.42 * (1 - 0.5 * u));
        gap = (0.052 - 0.026 * Math.sin(Math.PI * Math.min(1, u * 1.2))) * scale;
      }
      return true;
    },
  };
}
