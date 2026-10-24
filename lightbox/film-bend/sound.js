/* The "womp": one soft sound for one peak of bending film. It is made from the same audio parts as the other sounds, which sounds.js owns, so those are
 * handed over once as `audio`:
 *   vols            the volume settings (vols.wave is the womp's own level; 0 is silent)
 *   ensure()        start the audio if it is not started yet (returns it, or null when there is no audio)
 *   ctx() noise() waveMaster()   the audio context, the shared noise buffer and the womp's own volume node, which exist once audio has started
 *   jitter, envelope, noiseBurst, tone   the small building blocks the sounds share
 *
 *   const womp = createWop(audio);
 *   womp.wop(k, kind);              // k 0..1 how tall the peak is (sets the loudness), kind "up" | "down"
 *
 * Who asks for it: film-bend/physics.js queues one event per peak; lightbox.js reads them each frame and calls sounds.wop().
 */

export function createWop(audio) {
  const { vols, ensure, jitter, envelope, noiseBurst, tone } = audio;
  return {
    /* One "womp" for one peak: the round, soft sound a thin sheet makes when it flexes up and is let go, held at one end. It opens like an "o" (a
       low note with the air still open), closes like an "m" (the note sinks and the sound is shut in, muffled) and ends in a soft "p" (a
       small low puff as the sheet settles). kind "up": the film rising into its peak; "down": the peak falling back (shorter, lighter).
       k: 0..1, how tall the peak is: it sets the loudness. Nothing repeats: one call, one womp. */
    wop(k = 0.7, kind = "up") {
      if (vols.wave <= 0 || !ensure()) return;
      const ctx = audio.ctx(), noise = audio.noise(), waveMaster = audio.waveMaster();      // (made when the sound is first unlocked)
      const t = ctx.currentTime + 0.002;
      const hard = Math.min(1, Math.max(0.05, k));                // as loud as the peak is tall
      const up = kind === "up";
      const dur = (up ? 0.46 : 0.3) * (0.9 + 0.2 * hard);
      const swell = dur * 0.34;                                    // the "o" opens and reaches its fullest
      const close = t + dur * 0.62;                                // the "m" shuts in
      const end = t + dur;
      // the body: a low round note that sinks as the sound closes
      const o = ctx.createOscillator();
      o.type = "triangle";
      const b0 = (up ? 138 : 158) * jitter(0.04);
      o.frequency.setValueAtTime(b0 * 0.9, t);
      o.frequency.exponentialRampToValueAtTime(b0, t + swell);
      o.frequency.exponentialRampToValueAtTime(b0 * 0.62, end);
      const mouth = ctx.createBiquadFilter();                      // the "o" to "m": the sound is open, then closes up
      mouth.type = "lowpass"; mouth.Q.value = 3.2;
      mouth.frequency.setValueAtTime(420, t);
      mouth.frequency.exponentialRampToValueAtTime(760, t + swell);
      mouth.frequency.exponentialRampToValueAtTime(150, end);
      const body = ctx.createGain();
      envelope(body.gain, t, 0.5 * hard, swell, dur - swell);
      o.connect(mouth).connect(body).connect(waveMaster);
      o.start(t); o.stop(end + 0.05);
      // a soft breath of air under it, closing with it
      const src = ctx.createBufferSource();
      src.buffer = noise;
      const air = ctx.createBiquadFilter();
      air.type = "bandpass"; air.Q.value = 1.6;
      air.frequency.setValueAtTime(190, t);
      air.frequency.exponentialRampToValueAtTime(330, t + swell);
      air.frequency.exponentialRampToValueAtTime(130, end);
      const airGain = ctx.createGain();
      envelope(airGain.gain, t, 0.22 * hard, swell, dur * 0.66 - swell);
      src.connect(air).connect(airGain).connect(waveMaster);
      src.start(t, Math.random() * 1.5); src.stop(end + 0.05);
      // the "p": a small low puff as the sheet settles
      noiseBurst(close + dur * 0.12, { type: "lowpass", freq: 260 * jitter(0.08), q: 0.7, peak: 0.34 * hard, decay: 0.07, attack: 0.004 }, waveMaster);
      tone(close + dur * 0.12, { type: "sine", from: 110 * jitter(0.05), to: 66, peak: 0.3 * hard, decay: 0.09, sweep: 0.05 }, waveMaster);
    },
  };
}
