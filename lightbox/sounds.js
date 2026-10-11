/* Sounds, synthesised with Web Audio (no sound files).
 *
 * Detent clicks for the magnification dial, a glass-on-matte-plastic slide for dragging the
 * eyepiece across the board, and a crackle of film when it is slid fast enough to drag the film.
 *
 * A click is three layers, each a few milliseconds long: a burst of band-passed noise (the
 * "tick"), a short high ping (the pawl dropping into the notch) and a soft low thump (the
 * barrel). Pitch and level wobble a little per click so a run of them doesn't sound machine-made.
 *
 * The slide is looped noise shaped by speed: faster means louder and brighter, standing still is
 * silent. A slow random wobble on the level gives it the grainy stick-slip of glass on a matte
 * surface. The audio context is created on the first user gesture, as browsers require.
 */

export function createSounds({ clickVolume = 0.6, slideVolume = 0.5, crackleVolume = 0.5 } = {}) {
  let ctx = null;
  let master = null;      // clicks
  let slideMaster = null;
  let noise = null;
  let vol = clickVolume;
  let slideVol = slideVolume;
  let crackleVol = crackleVolume;
  let crackleMaster = null;
  let slideNodes = null;

  const jitter = (spread) => 1 + (Math.random() * 2 - 1) * spread;

  function ensure() {
    if (!ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return null;
      ctx = new AC();
      master = ctx.createGain();
      master.gain.value = vol;
      slideMaster = ctx.createGain();
      slideMaster.gain.value = slideVol;
      const limiter = ctx.createDynamicsCompressor();
      master.connect(limiter);
      slideMaster.connect(limiter);
      crackleMaster = ctx.createGain();
      crackleMaster.gain.value = crackleVol;
      crackleMaster.connect(limiter);
      limiter.connect(ctx.destination);
      noise = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);   // shared by clicks and slide
      const d = noise.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
      buildSlide();
    }
    if (ctx.state === "suspended") ctx.resume();
    return ctx;
  }

  /* always-running noise voices, silent until setSlide() opens them */
  function buildSlide() {
    const voice = () => {
      const src = ctx.createBufferSource();
      src.buffer = noise;
      src.loop = true;
      src.start(0, Math.random() * 1.5);
      return src;
    };
    // airy body of the rub
    const band = ctx.createBiquadFilter();
    band.type = "bandpass"; band.Q.value = 0.7; band.frequency.value = 800;
    const bandGain = ctx.createGain(); bandGain.gain.value = 0;
    voice().connect(band).connect(bandGain).connect(slideMaster);
    // low, soft push of glass against the surface
    const low = ctx.createBiquadFilter();
    low.type = "lowpass"; low.frequency.value = 420;
    const lowGain = ctx.createGain(); lowGain.gain.value = 0;
    voice().connect(low).connect(lowGain).connect(slideMaster);
    // stick-slip: slow random wobble of the main level
    const wobble = ctx.createBiquadFilter();
    wobble.type = "lowpass"; wobble.frequency.value = 75;
    const wobbleGain = ctx.createGain(); wobbleGain.gain.value = 0;
    voice().connect(wobble).connect(wobbleGain).connect(bandGain.gain);
    slideNodes = { band, bandGain, lowGain, wobbleGain };
  }

  function envelope(param, t, peak, attack, decay) {
    param.setValueAtTime(0.0001, t);
    param.exponentialRampToValueAtTime(peak, t + attack);
    param.exponentialRampToValueAtTime(0.0001, t + attack + decay);
  }

  function noiseBurst(t, { freq, q, peak, decay }, dest = master) {
    const src = ctx.createBufferSource();
    src.buffer = noise;
    const filter = ctx.createBiquadFilter();
    filter.type = "bandpass";
    filter.frequency.value = freq;
    filter.Q.value = q;
    const g = ctx.createGain();
    envelope(g.gain, t, peak, 0.0006, decay);
    src.connect(filter).connect(g).connect(dest);
    src.start(t, Math.random() * 0.02);
    src.stop(t + decay + 0.02);
  }

  function tone(t, { type, from, to, peak, decay, sweep }) {
    const osc = ctx.createOscillator();
    osc.type = type;
    osc.frequency.setValueAtTime(from, t);
    osc.frequency.exponentialRampToValueAtTime(to, t + sweep);
    const g = ctx.createGain();
    envelope(g.gain, t, peak, 0.0008, decay);
    osc.connect(g).connect(master);
    osc.start(t);
    osc.stop(t + decay + 0.02);
  }

  function clickAt(t, strength) {
    noiseBurst(t, { freq: 3000 * jitter(0.12), q: 0.9, peak: 0.85 * strength, decay: 0.011 });
    tone(t, { type: "triangle", from: 2300 * jitter(0.06), to: 1700, peak: 0.16 * strength, decay: 0.007, sweep: 0.006 });
    tone(t, { type: "sine", from: 230 * jitter(0.08), to: 110, peak: 0.5 * strength, decay: 0.03, sweep: 0.02 });
  }

  return {
    /* call from a user gesture so the browser lets audio start */
    unlock() { ensure(); },
    setClickVolume(v) {
      vol = v;
      if (master) master.gain.value = v;
    },
    setSlideVolume(v) {
      slideVol = v;
      if (slideMaster) slideMaster.gain.value = v;
    },
    setCrackleVolume(v) {
      crackleVol = v;
      if (crackleMaster) crackleMaster.gain.value = v;
    },
    /* Film crackle while the eyepiece is rubbing the film. `level` is 0..1 (how hard), `dtMs` the time
       since the last call. Sparse, random, sharp little ticks; now and then a short crinkle of several
       in a row, like acetate flexing. Silent at level 0. Needs the audio unlocked by an earlier press. */
    crackle(level, dtMs) {
      if (!ctx || !crackleMaster || crackleVol <= 0 || level < 0.03) return;
      const expected = (70 * Math.pow(level, 1.2) * dtMs) / 1000;
      const n = Math.floor(expected) + (Math.random() < expected % 1 ? 1 : 0);
      for (let i = 0; i < n; i++) {
        const t = ctx.currentTime + 0.002 + (Math.random() * dtMs) / 1000;
        const loud = 0.5 + 0.5 * level;
        if (Math.random() < 0.12) {                       // a crinkle
          const parts = 3 + Math.floor(Math.random() * 3);
          for (let k = 0; k < parts; k++) {
            noiseBurst(t + k * (0.004 + Math.random() * 0.005), {
              freq: 1800 + Math.random() * 1500, q: 1.2 + Math.random(),
              peak: (0.12 + Math.random() * 0.3) * loud, decay: 0.004 + Math.random() * 0.006,
            }, crackleMaster);
          }
        } else {                                          // a single tick
          const r = Math.random();
          noiseBurst(t, {
            freq: 2800 + Math.random() * 4700, q: 1.6 + Math.random() * 1.8,
            peak: (0.1 + 0.8 * r * r) * 0.6 * loud, decay: 0.002 + Math.random() * 0.005,
          }, crackleMaster);
        }
      }
    },
    /* how hard the eyepiece is rubbing the film, 0..1 (film.contact); call every frame, 0 when it isn't */
    slide(level01) {
      if (!slideNodes) return;                   // not unlocked yet
      const level = level01 > 0.02 ? Math.min(1, Math.pow(level01, 0.6)) : 0;
      const t = ctx.currentTime;
      const { band, bandGain, lowGain, wobbleGain } = slideNodes;
      bandGain.gain.setTargetAtTime(level * 0.5, t, 0.05);
      lowGain.gain.setTargetAtTime(level * 0.32, t, 0.06);
      wobbleGain.gain.setTargetAtTime(level * 1.6, t, 0.05);
      band.frequency.setTargetAtTime(650 + 2300 * Math.pow(level, 0.8), t, 0.05);
    },
    /* n detents in quick succession, e.g. when the ring is turned fast */
    click(n = 1) {
      if (vol <= 0 || !ensure()) return;
      const count = Math.min(n, 4);
      const t0 = ctx.currentTime + 0.002;
      for (let i = 0; i < count; i++) clickAt(t0 + i * 0.008, (0.8 + Math.random() * 0.3) * (i ? 0.8 : 1));
    },
    /* the ring dropping into a numbered notch: a crisp, slightly higher "tock" than the ordinary
       detents, so catching a number is felt as well as seen */
    notch() {
      if (vol <= 0 || !ensure()) return;
      const t = ctx.currentTime + 0.002;
      noiseBurst(t, { freq: 3400 * jitter(0.06), q: 1.1, peak: 1, decay: 0.012 });
      tone(t, { type: "triangle", from: 3000 * jitter(0.04), to: 2100, peak: 0.28, decay: 0.01, sweep: 0.008 });
      tone(t, { type: "sine", from: 300 * jitter(0.05), to: 130, peak: 0.7, decay: 0.045, sweep: 0.025 });
    },
    /* the ring settling into a numbered point: a firmer click than the ordinary detents */
    lock() {
      if (vol <= 0 || !ensure()) return;
      const t = ctx.currentTime + 0.002;
      clickAt(t, 1.25);
      tone(t + 0.004, { type: "sine", from: 150, to: 70, peak: 0.55, decay: 0.05, sweep: 0.04 });
    },
    /* the dull stop at either end of the dial */
    thud() {
      if (vol <= 0 || !ensure()) return;
      const t = ctx.currentTime + 0.002;
      noiseBurst(t, { freq: 700, q: 0.7, peak: 0.55, decay: 0.05 });
      tone(t, { type: "sine", from: 120, to: 55, peak: 0.9, decay: 0.09, sweep: 0.06 });
    },
  };
}
