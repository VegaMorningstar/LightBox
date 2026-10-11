/* Detent clicks for the magnification dial, synthesised with Web Audio (no sound files).
 *
 * A click is three layers, each a few milliseconds long: a burst of band-passed noise (the
 * "tick"), a short high ping (the pawl dropping into the notch) and a soft low thump (the
 * barrel). Pitch and level wobble a little per click so a run of them doesn't sound machine-made.
 * The audio context is created on the first user gesture, as browsers require.
 */

export function createClicker({ volume = 0.6 } = {}) {
  let ctx = null;
  let master = null;
  let noise = null;
  let vol = volume;

  const jitter = (spread) => 1 + (Math.random() * 2 - 1) * spread;

  function ensure() {
    if (!ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return null;
      ctx = new AC();
      master = ctx.createGain();
      master.gain.value = vol;
      const limiter = ctx.createDynamicsCompressor();
      master.connect(limiter);
      limiter.connect(ctx.destination);
      noise = ctx.createBuffer(1, Math.floor(ctx.sampleRate * 0.08), ctx.sampleRate);
      const d = noise.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    }
    if (ctx.state === "suspended") ctx.resume();
    return ctx;
  }

  function envelope(param, t, peak, attack, decay) {
    param.setValueAtTime(0.0001, t);
    param.exponentialRampToValueAtTime(peak, t + attack);
    param.exponentialRampToValueAtTime(0.0001, t + attack + decay);
  }

  function noiseBurst(t, { freq, q, peak, decay }) {
    const src = ctx.createBufferSource();
    src.buffer = noise;
    const filter = ctx.createBiquadFilter();
    filter.type = "bandpass";
    filter.frequency.value = freq;
    filter.Q.value = q;
    const g = ctx.createGain();
    envelope(g.gain, t, peak, 0.0006, decay);
    src.connect(filter).connect(g).connect(master);
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
    setVolume(v) {
      vol = v;
      if (master) master.gain.value = v;
    },
    /* n detents in quick succession, e.g. when the ring is turned fast */
    click(n = 1) {
      if (vol <= 0 || !ensure()) return;
      const count = Math.min(n, 4);
      const t0 = ctx.currentTime + 0.002;
      for (let i = 0; i < count; i++) clickAt(t0 + i * 0.008, (0.8 + Math.random() * 0.3) * (i ? 0.8 : 1));
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
