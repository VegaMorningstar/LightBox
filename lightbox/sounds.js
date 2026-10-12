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

/* how loud the ordinary dial ticks are, against the notch and lock sounds (1 = as loud as the notch's click) */
const SUBCLICK = 0.34;

/* The glass drag sound (the edge of the glass being dragged across the board) is saved but switched off for now.
   Set this to true to bring it back: it needs the clip in local-audio/ and plays on localhost only. */
export const GLASS_DRAG_ENABLED = false;

/* the shape of each grain of the glass drag: a smooth bell from silence up and back down to silence */
const grainWindow = Float32Array.from({ length: 48 }, (_, i) => 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / 47) );

/* The level of every sound, 0 to 1 (the page has a slider for each). A sound's own level sits under the master. */
export const DEFAULT_VOLUMES = { master: 1, tick: 0.6, notch: 0.6, lift: 0.6, place: 0.3, drag: 0.3, slide: 0.03, crackle: 1 };

export function createSounds({ volumes = {} } = {}) {
  const vols = { ...DEFAULT_VOLUMES, ...volumes };
  let ctx = null;
  let out = null;          // master volume
  const bus = {};          // one gain per sound: tick, notch, lift, place
  let slideMaster = null;
  let noise = null;
  let crackleMaster = null;
  let dragBus = null;      // speed-following level of the glass drag
  let dragMaster = null;   // its volume setting
  let dragNext = 0;        // when the next copy of the drag clip should start
  let slideNodes = null;

  // Recordings of real glass, for the lift and the set-down (audio/). They are fetched when the sound is first unlocked;
  // until they arrive, or if one is missing, the synthesised version plays instead. On localhost you can also audition
  // other clips cut from a longer recording (local-audio/audition.html): a clip picked there is used in preference.
  const LOCAL = ["localhost", "127.0.0.1", "[::1]", ""].includes(location.hostname);
  const clips = { lift: null, place: null, drag: null };
  let clipsRequested = false;
  const PUBLISHED = { lift: "../audio/glass-lift.wav", place: "../audio/glass-place.wav" };
  const explicitPick = (key) => { try { return localStorage.getItem(key); } catch { return null; } };
  async function fetchClip(path) {
    try {
      const res = await fetch(new URL(path, import.meta.url));
      return res.ok ? await ctx.decodeAudioData(await res.arrayBuffer()) : null;
    } catch { return null; }
  }
  async function loadClips() {
    if (clipsRequested) return;
    clipsRequested = true;
    for (const [name, key] of [["lift", "lb-clip-lift"], ["place", "lb-clip-place"]]) {
      const picked = LOCAL ? explicitPick(key) : null;
      clips[name] = (picked && await fetchClip(`../local-audio/clips/${picked}.wav`)) || await fetchClip(PUBLISHED[name]);
    }
    if (GLASS_DRAG_ENABLED && LOCAL) clips.drag = await fetchClip(`../local-audio/clips/${explicitPick("lb-clip-drag") || "e02b"}.wav`);   // local only
  }
  function playClip(buf, dest, gain = 0.9) {
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.playbackRate.value = 1 + (Math.random() * 2 - 1) * 0.03;      // a hair of variation so repeats are not identical
    const g = ctx.createGain();
    g.gain.value = gain;
    src.connect(g).connect(dest);
    src.start();
  }

  const jitter = (spread) => 1 + (Math.random() * 2 - 1) * spread;

  function ensure() {
    if (!ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return null;
      ctx = new AC();
      const limiter = ctx.createDynamicsCompressor();
      out = ctx.createGain();
      out.gain.value = vols.master;
      limiter.connect(out);
      out.connect(ctx.destination);
      for (const k of ["tick", "notch", "lift", "place"]) { bus[k] = ctx.createGain(); bus[k].gain.value = vols[k]; bus[k].connect(limiter); }
      slideMaster = ctx.createGain();
      slideMaster.gain.value = vols.slide;
      slideMaster.connect(limiter);
      crackleMaster = ctx.createGain();
      crackleMaster.gain.value = vols.crackle;
      crackleMaster.connect(limiter);
      dragMaster = ctx.createGain();
      dragMaster.gain.value = vols.drag;
      dragMaster.connect(limiter);
      dragBus = ctx.createGain();
      dragBus.gain.value = 0;
      dragBus.connect(dragMaster);
      noise = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);   // shared by clicks and slide
      const d = noise.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
      buildSlide();
      loadClips();
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

  /* a gentle low-pass so the touch sounds never get bright or harsh; the lift and the set-down each have one */
  const softs = {};
  function softBus(kind) {
    if (!softs[kind]) {
      const f = ctx.createBiquadFilter();
      f.type = "lowpass";
      f.frequency.value = 4200;
      f.Q.value = 0.4;
      f.connect(bus[kind]);
      softs[kind] = f;
    }
    return softs[kind];
  }

  function envelope(param, t, peak, attack, decay) {
    param.setValueAtTime(0.0001, t);
    param.exponentialRampToValueAtTime(peak, t + attack);
    param.exponentialRampToValueAtTime(0.0001, t + attack + decay);
  }

  function noiseBurst(t, { freq, q, peak, decay, type = "bandpass", attack = 0.0006 }, dest) {
    const src = ctx.createBufferSource();
    src.buffer = noise;
    const filter = ctx.createBiquadFilter();
    filter.type = type;
    filter.frequency.value = freq;
    filter.Q.value = q;
    const g = ctx.createGain();
    envelope(g.gain, t, peak, attack, decay);
    src.connect(filter).connect(g).connect(dest);
    src.start(t, Math.random() * 0.02);
    src.stop(t + decay + 0.02);
  }

  function tone(t, { type, from, to, peak, decay, sweep }, dest) {
    const osc = ctx.createOscillator();
    osc.type = type;
    osc.frequency.setValueAtTime(from, t);
    osc.frequency.exponentialRampToValueAtTime(to, t + sweep);
    const g = ctx.createGain();
    envelope(g.gain, t, peak, 0.0008, decay);
    osc.connect(g).connect(dest);
    osc.start(t);
    osc.stop(t + decay + 0.02);
  }

  function clickAt(t, strength, dest) {
    noiseBurst(t, { freq: 3000 * jitter(0.12), q: 0.9, peak: 0.85 * strength, decay: 0.011 }, dest);
    tone(t, { type: "triangle", from: 2300 * jitter(0.06), to: 1700, peak: 0.16 * strength, decay: 0.007, sweep: 0.006 }, dest);
    tone(t, { type: "sine", from: 230 * jitter(0.08), to: 110, peak: 0.5 * strength, decay: 0.03, sweep: 0.02 }, dest);
  }

  return {
    /* call from a user gesture so the browser lets audio start */
    unlock() { ensure(); },
    /* change one sound's level (or the master) while it is playing */
    setVolume(name, v) {
      vols[name] = v;
      const node = name === "master" ? out : name === "slide" ? slideMaster : name === "crackle" ? crackleMaster : name === "drag" ? dragMaster : bus[name];
      if (node) node.gain.value = v;
    },
    /* The glass edge being dragged across the board (from your recording, so only where the clip is loaded). `level`
       is 0..1, how fast the eyepiece is being dragged; call it every frame, with 0 when it is lifted or still.
       The recording is only a fraction of a second long, and repeating it end to end made a steady beat that sounded
       almost musical. So it is played granularly instead: a stream of tiny overlapping grains (60 to 120 ms), each
       taken from a random place in the recording at a slightly different pitch, at irregular intervals. The result is
       one continuous scrape that never repeats on a beat. Speed sets the loudness, the pitch and how dense it is. */
    glassDrag(level) {
      if (!GLASS_DRAG_ENABLED || !ctx || !clips.drag || !dragBus || vols.drag <= 0) return;
      const t = ctx.currentTime;
      const on = level > 0.04;
      dragBus.gain.setTargetAtTime(on ? 0.35 + 0.65 * Math.min(1, level) : 0, t, on ? 0.05 : 0.06);
      if (!on) return;
      const buf = clips.drag;
      const lvl = Math.min(1, level);
      if (dragNext < t) dragNext = t + 0.005;             // (re)start: nothing is playing
      while (dragNext < t + 0.22) {                       // keep grains scheduled ahead of time, so a slow frame cannot leave a gap
        const dur = 0.06 + Math.random() * 0.06;          // length of this grain, in seconds of the recording
        const rate = (0.9 + 0.2 * lvl) * (0.9 + Math.random() * 0.2);
        const span = dur * rate;                          // how much of the recording it covers
        const room = Math.max(0, buf.duration - span - 0.02);
        const src = ctx.createBufferSource();
        src.buffer = buf;
        src.playbackRate.value = rate;
        const g = ctx.createGain();
        g.gain.setValueCurveAtTime(grainWindow, dragNext, dur);       // a smooth bell, so grains blend with no clicks
        src.connect(g).connect(dragBus);
        src.start(dragNext, 0.01 + Math.random() * room, span);
        dragNext += dur * (0.34 + Math.random() * 0.32) * (1.1 - 0.35 * lvl);   // irregular spacing: about two or three grains overlap
      }
    },
    /* Film crackle while the eyepiece is rubbing the film. `level` is 0..1 (how hard), `dtMs` the time
       since the last call. Sparse, random, sharp little ticks; now and then a short crinkle of several
       in a row, like acetate flexing. Silent at level 0. Needs the audio unlocked by an earlier press. */
    crackle(level, dtMs) {
      if (!ctx || !crackleMaster || vols.crackle <= 0 || level < 0.03) return;
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
      if (vols.tick <= 0 || !ensure()) return;
      const count = Math.min(n, 4);
      const t0 = ctx.currentTime + 0.002;
      // the ordinary ticks are kept light, so the notch at a numbered point clearly stands out from them
      for (let i = 0; i < count; i++) clickAt(t0 + i * 0.008, SUBCLICK * (0.8 + Math.random() * 0.3) * (i ? 0.8 : 1), bus.tick);
    },
    /* the ring dropping into a numbered notch: a crisp, slightly higher "tock" than the ordinary
       detents, so catching a number is felt as well as seen */
    notch() {
      if (vols.notch <= 0 || !ensure()) return;
      const t = ctx.currentTime + 0.002;
      noiseBurst(t, { freq: 3400 * jitter(0.06), q: 1.1, peak: 1.25, decay: 0.014 }, bus.notch);
      tone(t, { type: "triangle", from: 3000 * jitter(0.04), to: 2100, peak: 0.34, decay: 0.012, sweep: 0.008 }, bus.notch);
      tone(t, { type: "sine", from: 300 * jitter(0.05), to: 130, peak: 0.9, decay: 0.05, sweep: 0.025 }, bus.notch);
    },
    /* the ring settling into a numbered point: a firmer click than the ordinary detents */
    lock() {
      if (vols.notch <= 0 || !ensure()) return;
      const t = ctx.currentTime + 0.002;
      clickAt(t, 1.25, bus.notch);
      tone(t + 0.004, { type: "sine", from: 150, to: 70, peak: 0.55, decay: 0.05, sweep: 0.04 }, bus.notch);
    },
    /* The glass being pulled up off the matte board: a very quiet, soft unsticking. A faint low "tk" as the
       contact lets go, then a gentle rub of air and surface that fades away. Nothing pitched and nothing bright. */
    lift() {
      if (vols.lift <= 0 || !ensure()) return;
      if (clips.lift) { playClip(clips.lift, bus.lift); return; }
      const t = ctx.currentTime + 0.002;
      const soft = softBus("lift");
      noiseBurst(t, { type: "lowpass", freq: 900 * jitter(0.08), q: 0.5, peak: 0.16, decay: 0.014, attack: 0.002 }, soft);
      const src = ctx.createBufferSource();
      src.buffer = noise;
      const f = ctx.createBiquadFilter();
      f.type = "bandpass"; f.Q.value = 0.6;
      f.frequency.setValueAtTime(520, t);
      f.frequency.exponentialRampToValueAtTime(1500, t + 0.12);
      const g = ctx.createGain();
      envelope(g.gain, t + 0.006, 0.11, 0.045, 0.1);
      src.connect(f).connect(g).connect(soft);
      src.start(t, Math.random() * 0.5);
      src.stop(t + 0.19);
    },
    /* The glass coming to rest on the board: a dull, damped touch, not a ring. A short soft thump, a brush of
       the matte surface, and only the faintest glassy colour, which dies almost at once; then a smaller second
       touch as it settles. */
    place() {
      if (vols.place <= 0 || !ensure()) return;
      if (clips.place) { playClip(clips.place, bus.place); return; }
      const t = ctx.currentTime + 0.002;
      const soft = softBus("place");
      const touch = (at, k) => {
        noiseBurst(at, { type: "lowpass", freq: 1500 * jitter(0.08), q: 0.6, peak: 0.34 * k, decay: 0.03, attack: 0.001 }, soft);   // the thump
        noiseBurst(at, { freq: 1100 * jitter(0.1), q: 0.55, peak: 0.12 * k, decay: 0.055 }, soft);                                  // the matte brush
        for (const [hz, amp, dec] of [[1180, 0.07, 0.026], [2260, 0.035, 0.016], [3540, 0.014, 0.01]]) {                           // faint glass body
          const o = ctx.createOscillator();
          o.type = "sine";
          o.frequency.value = hz * jitter(0.03);
          const g = ctx.createGain();
          envelope(g.gain, at, amp * k, 0.0008, dec);
          o.connect(g).connect(soft);
          o.start(at); o.stop(at + dec + 0.02);
        }
      };
      touch(t, 1);
      touch(t + 0.058, 0.3);
    },
    /* the dull stop at either end of the dial */
    thud() {
      if (vols.notch <= 0 || !ensure()) return;
      const t = ctx.currentTime + 0.002;
      noiseBurst(t, { freq: 700, q: 0.7, peak: 0.55, decay: 0.05 }, bus.notch);
      tone(t, { type: "sine", from: 120, to: 55, peak: 0.9, decay: 0.09, sweep: 0.06 }, bus.notch);
    },
  };
}
