/* The physics of film bending: when it happens, how much slack is stored, how tall the arch gets, what it does to the eyepiece, and the events the
 * sound listens for. The shape itself (height, slope, draw-in at a point along the strip) lives in shape.js; drawing it in draw.js.
 *
 * Each strip carries `s.bk` (see shape.js for its fields). This file is the only writer of `s.bk`, `s.bent`, `s.drawn` and of each cell's `z`, `by`,
 * `k` and `shade` (the lifted height, draw-in, scale and darkening of one frame). Everything else only reads them.
 *
 * film.js owns the strips, the hand that holds one and the eyepiece, so it hands over what this needs once, as `host`:
 *   held()        the strip being gripped, { s, gx, gy, ... } or null
 *   topOf(s)      the strip's top centre on the sheet
 *   rotate(t,x,y) rotate a vector
 *   coverage(s, eye)  how much of the strip lies under the eyepiece (see film.js)
 * and the settings the sliders change, `cfg` (cfg.bend: arch height, cfg.bendPush: how hard slack pushes the eyepiece, cfg.edge: the rim curl).
 *
 * It gives back, per frame: update(dtMs, eye); the eyepiece push (eyePush); the "wop" events and the crunch level for the sound; whether a strip is
 * still moving (isMoving) so film.js knows when it can go idle; and holdBack, which stops a held strip pushing the eyepiece it is buckling against.
 */

import { BK, archHeight, overRim, placeBend, profile, seedBend } from "./shape.js";

const smoothstep = (a, b, x) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

export function createBendPhysics({ scene, cfg, host }) {
  // every strip starts flat, with a bend character of its own (its seed, kept for its life)
  scene.strips.forEach((s) => {
    s.bk = { d: 0, a: 0, sign: 1, hand: 0, pin: 0, L: 1, cover: 0, hp: null, can: true };
    seedBend(s.bk, (scene.strips.indexOf(s) + 1) * 0.6180339887 % 1);
  });
  let prevEye = null;
  const eyePush = { x: 0, y: 0 };   // the acceleration (px per ms squared) the film's slack is giving the eyepiece
  const bendEvents = [];            // single "wop"s waiting to be played: the film rising into an arch, or an arch falling back
  let bendCrunch = 0;               // 0..1: the film is bending or springing back, for the crunch

  /* Which strips are drawn from canvases (draw.js drawBentStrip) instead of the page's own strip: the bent ones, and, while any strip is bent, every strip that lies
     over another one. The browser draws the page's "multiply copy" of an overlapping strip wrongly (in a patch outside its clip) whenever a painted canvas sits in the same
     stack, so an overlapping strip must not rely on it: it goes through the canvas path too, where the multiply is drawn by the canvas and not by the browser. */
  function markDrawn() {
    const any = scene.strips.some((s) => s.bent);
    for (const s of scene.strips) s.drawn = !!(s.bent || (any && s.over.length > 0));
  }

  /* A strip held at one point and pushed lengthwise toward the eyepiece resting on it cannot slide (the eyepiece holds that part of
     it) so it buckles: the length it cannot use becomes slack, and the slack lifts into an arch (two arches if the free length is
     long) between the hand and the eyepiece. Film is stiff, so the arch is a smooth bow, not a wobble. As it builds it pushes the
     eyepiece; once that is enough to overcome its friction the eyepiece gives way, the slack is used up and the arch settles back
     down. The slack is how much closer the hand has come to the eyepiece than the eyepiece has moved away: arc length is kept. */
  function update(dtMs, eye) {
    const mass = eye.mass ?? 1, down = eye.down ?? 1;
    const ed = prevEye ? [eye.x - prevEye.x, eye.y - prevEye.y] : [0, 0];
    prevEye = { x: eye.x, y: eye.y };
    eyePush.x = eyePush.y = 0;
    let crunch = 0;
    const edge = scene.edge;
    for (const s of scene.strips) {
      const bk = s.bk;
      const h = host.held();
      const isHeld = h && h.s === s;
      const [tx, ty] = host.topOf(s);
      const u = [-Math.sin(s.rot), Math.cos(s.rot)];                    // along the strip, top to bottom, on the sheet
      let hp = null;
      if (isHeld) { const [hx, hy] = host.rotate(s.rot, h.gx, h.gy); hp = [tx + hx, ty + hy]; }
      let cov = null;
      if (isHeld && down > 0.3) { const c = host.coverage(s, eye); if (c.n / c.tot > 0.12) cov = c; }
      const dOld = bk.d, aOld = bk.a;
      let close = 0;
      if (cov) {
        const sp = cov.lySum / cov.n, half = (cov.lyMax - cov.lyMin) / 2;
        if (Math.abs(h.gy - sp) > half + 40 && bk.hp) {            // the hand is clear of the eyepiece, on one side of it
          const sign = h.gy < sp ? 1 : -1;
          close = sign * ((hp[0] - bk.hp[0] - ed[0]) * u[0] + (hp[1] - bk.hp[1] - ed[1]) * u[1]);
          if (bk.d <= 0.05 || sign === bk.sign) {
            bk.sign = sign; bk.hand = h.gy; bk.pin = sp - sign * half; bk.L = Math.max(1, Math.abs(bk.pin - bk.hand)); bk.cover = Math.min(1, cov.n / cov.tot / 0.3);
            // pulling away from the eyepiece never bends the film: any slack goes at once, and the film just drags the eyepiece
            bk.d = close < 0 ? Math.max(0, bk.d + close * BK.AWAY) : Math.max(0, bk.d + close);
          }
        }
      }
      bk.hp = hp;
      // A wave no longer than one picture is too short for the film to buckle into (a frame is stiff across its own length): there is no bend,
      // so nothing is stored and the film simply pushes the eyepiece as before. The bend eases in as the wave grows past one picture.
      placeBend(bk);
      const wave = (bk.t1 - bk.t0) * bk.L;
      bk.can = wave > s.fh;
      if (!bk.can) bk.d = 0;
      const grow = smoothstep(s.fh, s.fh * 1.35, wave);
      // slack that is not being pushed on slides away (slowly while held, quickly once let go)
      if (!(cov && close > 0)) bk.d *= Math.exp(-dtMs / (isHeld ? BK.HELD_RELAX : BK.RELAX));
      if (bk.d > 0 && !cov && !isHeld) bk.d = Math.max(0, bk.d + 0);   // (released: only the decay above)
      bk.d = Math.min(bk.d, BK.SLACK_MAX, BK.SLACK_SHARE * bk.L);
      if (bk.d < 0.02) bk.d = 0;
      // what the slack does to the eyepiece: it pushes it away from the hand once the push beats the eyepiece's friction
      if (bk.d > 0.05 && bk.cover > 0 && (eye.down ?? 1) > 0.3) {
        const acc = Math.max(0, (BK.K * (cfg.bendPush ?? 1) * bk.d) / mass - BK.MU * bk.cover);
        eyePush.x += bk.sign * u[0] * acc; eyePush.y += bk.sign * u[1] * acc;
        if (!isHeld) { /* the film springs back as the eyepiece gives way */ }
      }
      // the shape: one peak; its height follows the slack (arc length is kept)
      const target = bk.d > 0 ? Math.min(BK.MAX, (cfg.bend ?? 1) * archHeight(bk.d, (bk.t1 - bk.t0) * bk.L)) * grow : 0;
      bk.a += (target - bk.a) * (1 - Math.exp(-dtMs / BK.SMOOTH));
      if (bk.a < 0.05 && target === 0) bk.a = 0;
      // One wop for each peak, as loud as the peak is tall: it sounds when the arch has risen to its top (it stops rising, or begins to fall),
      // and a lighter one when it falls back down after being let go (or given way to)
      if (!bk.up && bk.a > 10) { bk.up = true; bk.sounded = false; bk.aPk = bk.a; bk.still = 0; }
      if (bk.up) {
        if (bk.a > bk.aPk + 0.3) { bk.aPk = bk.a; bk.still = 0; } else bk.still += dtMs;
        if (!bk.sounded && (bk.a < bk.aPk - 3 || bk.still > 140)) { bk.sounded = true; bendEvents.push({ kind: "up", k: Math.min(1, bk.aPk / BK.MAX) }); }
        if (bk.a < 6) {
          if (bk.sounded && !isHeld) bendEvents.push({ kind: "down", k: Math.min(1, 0.7 * bk.aPk / BK.MAX) });
          else if (!bk.sounded) bendEvents.push({ kind: "up", k: Math.min(1, bk.aPk / BK.MAX) });
          bk.up = false;
        }
      }
      crunch = Math.max(crunch, Math.min(1, (Math.abs(bk.a - aOld) + 0.6 * Math.abs(bk.d - dOld)) * 3 / Math.max(dtMs, 1) * 4));
      for (const c of s.cells) {
        const pr = profile(bk, c.top + c.h / 2);
        c.z = pr.z; c.by = pr.by; c.k = 1; c.shade = 1;
      }
      // is this strip bent, or hanging over the rim of the panel? Then the page and the glasses draw it as thin slices (raster.js)
      let rim = false;
      // TEST (commented out, not deleted): film hanging over the panel's rim no longer goes to the bent-strip drawing. Put this back to restore it.
      // if (edge && (cfg.edge ?? 1) > 0) {
      //   for (const [qx, qy] of stripQuad(s)) if (overRim(qx, qy, scene.W, scene.H, edge.m) > 0.01) { rim = true; break; }
      // }
      s.bent = bk.a > 0.8 || bk.d > 1 || rim;
    }
    scene.bendEdge = cfg.edge ?? 1;
    markDrawn();
    bendCrunch = crunch;
  }

  /* A held strip pushed lengthwise toward the eyepiece cannot push it: the film buckles instead (update() then pushes the eyepiece). Only a pull away
     from it, or sideways, passes through. Takes the velocity the strip would give the eyepiece and returns it with that push taken out. */
  function holdBack(s, wvx, wvy) {
    if (s.bk.cover > 0 && s.bk.L > 1 && s.bk.can) {
      const ux = -Math.sin(s.rot), uy = Math.cos(s.rot), vu = wvx * ux + wvy * uy;
      if (s.bk.sign * vu > 0) { wvx -= vu * ux; wvy -= vu * uy; }
    }
    return [wvx, wvy];
  }

  return {
    update,
    markDrawn,
    holdBack,
    /* is this strip still bent, or holding slack (so the film is not at rest yet) */
    isMoving: (s) => s.bk.d > 0 || s.bk.a > 0,
    /* the push (px per ms squared) the film's slack gives the eyepiece: read it each frame and add it to the eyepiece's velocity */
    get eyePush() { return eyePush; },
    /* the wops waiting to be played ({kind: "up" | "down", k}); reading them empties the list */
    takeEvents() { return bendEvents.splice(0); },
    /* the film is bending or springing back (0..1), for the crunch */
    get crunch() { return bendCrunch; },
  };
}
