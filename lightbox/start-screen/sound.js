/* The start-up sound: ONE mechanical switch-on, like a film camera's shutter snap: a bright "ka" and a lower "clack" over the thud of the switch going over.
 * It sounds at the moment the switch is thrown, the same instant the light flashes (the start of the timeline, timeline.js), with a very soft, brief
 * crackle of electronics as the light flashes.
 *
 * It is built from the audio parts sounds.js owns, handed over once as `audio`:
 *   vols            the volume settings (vols.strobe is this sound's level; 0 is silent)
 *   ensure()        start the audio if it is not started yet (returns it, or null when there is no audio)
 *   ctx() strobeMaster()   the audio context and this sound's own volume node
 *   jitter, noiseBurst, tone   the small building blocks the sounds share
 *
 *   const strobe = createStrobeSound(audio);
 *   await strobe.play("on");       // the flash. play("off") is a single, softer click for switching off. Resolves true once it is playing, false if the browser would not start audio
 *
 * Browsers only start audio after the visitor has touched the page (a click, a tap or a key), so on a first visit with no touch yet there is no sound:
 * it is skipped rather than queued, because a late snap would sound wrong. It plays whenever the browser allows (e.g. on the replay button).
 */

export function createStrobeSound(audio) {
  const { vols, ensure, jitter, noiseBurst, tone } = audio;
  return {
    async play(kind = "on") {
      if (vols.strobe <= 0 || !ensure()) return false;
      const ctx = audio.ctx(), master = audio.strobeMaster();
      if (ctx.state !== "running") await Promise.race([ctx.resume().catch(() => {}), new Promise((r) => setTimeout(r, 150))]);
      if (ctx.state !== "running") return false;                       // the browser is holding audio back: stay silent
      const t = ctx.currentTime + 0.02;
      if (kind === "off") {                                            // switching off: one softer click, no flash and no crackle
        noiseBurst(t, { type: "bandpass", freq: 1500 * jitter(0.05), q: 0.8, peak: 0.6, decay: 0.022, attack: 0.0005 }, master);
        tone(t, { type: "sine", from: 230 * jitter(0.04), to: 90, peak: 0.42, decay: 0.07, sweep: 0.045 }, master);
        tone(t, { type: "sine", from: 120 * jitter(0.03), to: 50, peak: 0.35, decay: 0.1, sweep: 0.07 }, master);
        return true;
      }

      // "ka": the bright snap of the shutter opening
      noiseBurst(t, { type: "bandpass", freq: 3300 * jitter(0.05), q: 0.9, peak: 0.95, decay: 0.014, attack: 0.0004 }, master);
      tone(t, { type: "triangle", from: 3500 * jitter(0.04), to: 2100, peak: 0.16, decay: 0.03, sweep: 0.02 }, master);
      // "clack": the lower knock of it closing
      const clack = t + 0.024;
      noiseBurst(clack, { type: "bandpass", freq: 1100 * jitter(0.06), q: 0.8, peak: 0.75, decay: 0.032, attack: 0.0005 }, master);
      tone(clack, { type: "sine", from: 250 * jitter(0.04), to: 90, peak: 0.6, decay: 0.08, sweep: 0.05 }, master);
      // under both, the heavy thud of the switch going over
      tone(t, { type: "sine", from: 130 * jitter(0.03), to: 48, peak: 0.65, decay: 0.17, sweep: 0.1 }, master);
      noiseBurst(t, { type: "lowpass", freq: 420, q: 0.7, peak: 0.5, decay: 0.06, attack: 0.001 }, master);
      // a small electronic crackle as the light flashes: a few tiny, bright, uneven pops, very soft and over in about a quarter of a second, thinning out
      for (let i = 0; i < 9; i++) {
        const at = t + 0.012 + i * 0.026 + Math.random() * 0.018, fade = 1 - i / 11;
        noiseBurst(at, { type: "bandpass", freq: 4200 + Math.random() * 3200, q: 1.2, peak: (0.045 + 0.06 * Math.random()) * fade, decay: 0.004 + Math.random() * 0.007, attack: 0.0004 }, master);
        if (i % 2 === 0) tone(at, { type: "sine", from: 6200 + Math.random() * 1500, to: 3400, peak: 0.012 * fade, decay: 0.012, sweep: 0.008 }, master);
      }
      return true;
    },
  };
}
