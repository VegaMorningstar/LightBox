/* The film on the board.
 *
 * Two ways it moves:
 *
 * 1. The eyepiece rubs it. Friction between the eyepiece and the film, and between the film and the
 *    board. Only a fast slide matters: below V0 the eyepiece glides over the film without touching it;
 *    the pull fades in up to V1. A strip under the eyepiece is dragged a little along with it, then
 *    stops again (board friction), and each frame-sized piece of it leans a hair against its
 *    neighbours, bending the strip into a soft S-curve that eases in and settles without wobbling.
 *
 * 2. You grab a strip. Each strip is a rigid body lying on the board with friction. Pull it at one
 *    point and the sideways pull is shared between sliding the whole strip and turning it, depending
 *    on how far the grab is from the strip's middle. Hold the top and the top swings across while the
 *    bottom barely moves; hold the bottom and it is the other way round; hold the middle and the whole
 *    strip slides. Let go and it glides a moment, then stops.
 *
 * Strips you have not touched never slide over each other (a sprocket hole would show the
 * neighbour's dark film instead of the lit board). Once you grab a strip it is yours to place
 * anywhere, over or under its neighbours, until you organize the film again.
 *
 * It only edits numbers on the scene (see raster.js) and the matching DOM transforms, so the page
 * and both glasses draw the same film.
 */

import { stripQuad } from "./raster.js";

const V0 = 0.8;               // eyepiece speed (px per ms) where the film starts to be dragged
const V1 = 1.9;               // ...and where it is dragged fully
const PUSH = 0.0012;          // how strongly the eyepiece pulls a strip, per ms
const BOARD = 0.012;          // board friction on a sliding strip, per ms
const MAX_X = 0.14;           // furthest the eyepiece nudges a strip sideways, in frame widths
const MAX_Y = 0.22;           // ...and along its length

const WN = (2 * Math.PI * 4) / 1000;   // stiffness of the bend, in rad per ms
const ZETA = 0.75;                     // heavily damped: it eases back without overshooting or ringing
const COUPLE = 0.5 * WN * WN;          // how much neighbouring pieces pull on each other
const BEND = 0.03 * WN * WN;           // sideways drag -> tilt
const FLICKER = 0.0004 * WN * WN;      // a trace of friction stick-slip -> tilt (kept tiny: jitter looks fake)
const MAX_ANG = 0.016;                 // about 0.9 degrees; keeps neighbouring pieces overlapping

const STEP = 8;                        // ms per physics step
const KEEP_APART = 2;                  // px of clear board always left between neighbouring strips

// grabbing a strip
const SPIN = 2.2;             // how stubbornly a strip resists turning; higher keeps the far end stiller
const MAX_TURN = 0.5;         // furthest a strip can be turned from its starting angle, in radians (~29 degrees)
const GLIDE_MS = 140;         // how quickly a released strip slows to a stop
const TIDY_MS = 120;          // organize: how quickly the film eases back to its starting layout

const smoothstep = (a, b, x) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

const rotate = (t, x, y) => [x * Math.cos(t) - y * Math.sin(t), x * Math.sin(t) + y * Math.cos(t)];

export function createFilm(scene, cfg = { push: 1, flutter: 1 }) {
  let clock = 0;
  let wasActive = false;
  let contact = 0;      // 0..1: how hard the eyepiece is rubbing the film right now
  let contactNow = 0;
  let held = null;      // the strip being gripped: { s, gx, gy, t, v }
  let tidying = false;
  let moveSlide = 0;    // 0..1: a strip is sliding on the board (held, or gliding after a throw)
  let moveRub = 0;      // 0..1: a moving strip is also riding over another strip
  let zTop = 0;         // the strip last picked up sits on top
  scene.strips.forEach((s) => { s.rot0 = s.rot; s.ax = 0; s.ay = 0; s.cvx = s.cvy = s.cw = 0; s.manual = false; s.z = 0; });

  // ---------- geometry ----------

  /* where a strip's top centre is, and where its centre of mass is */
  const topOf = (s) => [s.left + s.w / 2 + s.ox, s.top + s.oy];
  const centreOf = (s) => {
    const [tx, ty] = topOf(s);
    const [dx, dy] = rotate(s.rot, 0, s.h / 2);
    return [tx + dx, ty + dy];
  };
  const reach = (s) => s.cells.reduce((m, c) => Math.max(m, Math.abs(c.x)), 0);   // how far bending swings it sideways

  /* world x of a strip's left (-1) or right (+1) edge at world height Y, or null if the strip isn't there */
  function edgeAt(s, side, Y) {
    const [tx, ty] = topOf(s);
    const u = side * (s.w / 2);
    const v = (Y - ty - u * Math.sin(s.rot)) / Math.cos(s.rot);
    if (v < 0 || v > s.h) return null;
    return tx + u * Math.cos(s.rot) - v * Math.sin(s.rot);
  }

  /* narrowest clear gap between a's right edge and b's left edge */
  function gapBetween(a, b) {
    const y0 = Math.min(a.top + a.oy, b.top + b.oy);
    const y1 = Math.max(a.top + a.oy + a.h, b.top + b.oy + b.h);
    let min = Infinity;
    for (let k = 0; k <= 28; k++) {
      const Y = y0 + ((y1 - y0) * k) / 28;
      const xa = edgeAt(a, 1, Y), xb = edgeAt(b, -1, Y);
      if (xa !== null && xb !== null) min = Math.min(min, xb - xa);
    }
    return min;
  }

  const spare = (i) => gapBetween(scene.strips[i], scene.strips[i + 1]) - reach(scene.strips[i]) - reach(scene.strips[i + 1]);

  /* Neighbours keep apart unless one of them has been placed by hand. */
  const mustStayApart = (i) => !scene.strips[i].manual && !scene.strips[i + 1].manual;

  /* is this strip somewhere allowed: on the board, and (if untouched) clear of its neighbours? */
  function allowed(s) {
    const i = scene.strips.indexOf(s);
    const [cx, cy] = centreOf(s);
    if (cx < 0 || cx > scene.W || cy < 0 || cy > scene.H) return false;
    if (i > 0 && mustStayApart(i - 1) && spare(i - 1) < KEEP_APART) return false;
    if (i < scene.strips.length - 1 && mustStayApart(i) && spare(i) < KEEP_APART) return false;
    return true;
  }

  /* how much of a strip is lying on top of or under another strip, 0..1 */
  function overlapOf(m) {
    let inside = 0, total = 0;
    for (const lx of [-m.w / 3, 0, m.w / 3]) {
      for (let k = 0; k < 9; k++) {
        const ly = (m.h * (k + 0.5)) / 9;
        const [tx, ty] = topOf(m);
        const [dx, dy] = rotate(m.rot, lx, ly);
        const px = tx + dx, py = ty + dy;
        total++;
        for (const t of scene.strips) {
          if (t === m) continue;
          const [ux, uy] = topOf(t);
          const [qx, qy] = rotate(-t.rot, px - ux, py - uy);
          if (Math.abs(qx) <= t.w / 2 && qy >= 0 && qy <= t.h) { inside++; break; }
        }
      }
    }
    return inside / total;
  }

  /* put a strip's centre at (cx, cy) and its angle at `rot`; refuse (and leave it as it was) if not allowed */
  function place(s, cx, cy, rot) {
    const old = [s.ox, s.oy, s.rot];
    const dx = Math.sin(rot) * s.h / 2, dy = Math.cos(rot) * s.h / 2;
    s.rot = rot;
    s.ox = cx + dx - (s.left + s.w / 2);
    s.oy = cy - dy - s.top;
    if (allowed(s)) { s.ax = s.ox; s.ay = s.oy; return true; }
    [s.ox, s.oy, s.rot] = old;
    return false;
  }

  // ---------- where strips overlap ----------

  /* Sutherland-Hodgman: the part of convex polygon `subject` inside convex polygon `clip` (both clockwise on screen) */
  function clipPolygon(subject, clip) {
    let out = subject;
    for (let i = 0; i < clip.length && out.length; i++) {
      const [ax, ay] = clip[i], [bx, by] = clip[(i + 1) % clip.length];
      const inside = ([x, y]) => (bx - ax) * (y - ay) - (by - ay) * (x - ax) >= 0;
      const cross = ([x1, y1], [x2, y2]) => {
        const d1 = (bx - ax) * (y1 - ay) - (by - ay) * (x1 - ax);
        const d2 = (bx - ax) * (y2 - ay) - (by - ay) * (x2 - ax);
        const t = d1 / (d1 - d2);
        return [x1 + (x2 - x1) * t, y1 + (y2 - y1) * t];
      };
      const input = out;
      out = [];
      input.forEach((cur, k) => {
        const prev = input[(k + input.length - 1) % input.length];
        if (inside(cur)) { if (!inside(prev)) out.push(cross(prev, cur)); out.push(cur); }
        else if (inside(prev)) out.push(cross(prev, cur));
      });
    }
    return out;
  }
  const area = (p) => Math.abs(p.reduce((a, [x, y], i) => { const [x2, y2] = p[(i + 1) % p.length]; return a + x * y2 - x2 * y; }, 0)) / 2;

  /* For every pair of strips, the shared region. The upper strip is drawn see-through there (s.over), by how
     much light registered at each pixel; the lower strip shows through. */
  function findOverlaps() {
    const order = scene.strips.map((s, i) => [s, i]).sort((a, b) => (a[0].z - b[0].z) || (a[1] - b[1])).map((e) => e[0]);
    const quads = new Map(order.map((s) => [s, stripQuad(s)]));
    for (const s of order) { s.over = []; s.under = []; }
    for (let hi = 1; hi < order.length; hi++) {
      for (let lo = 0; lo < hi; lo++) {
        const poly = clipPolygon(quads.get(order[lo]), quads.get(order[hi]));
        if (poly.length >= 3 && area(poly) > 4) { order[hi].over.push(poly); order[lo].under.push(poly); }
      }
    }
  }

  /* shrink a convex polygon by d px on every side */
  function inset(poly, d) {
    let out = poly;
    for (let i = 0; i < poly.length && out.length; i++) {
      const [ax, ay] = poly[i], [bx, by] = poly[(i + 1) % poly.length];
      const len = Math.hypot(bx - ax, by - ay) || 1;
      const nx = -(by - ay) / len, ny = (bx - ax) / len;          // normal pointing inward for a clockwise polygon on screen
      const px = ax + nx * d, py = ay + ny * d;                    // a point on the shifted edge
      const side = ([x, y]) => (bx - ax) * (y - py) - (by - ay) * (x - px);
      const input = out;
      out = [];
      input.forEach((cur, k) => {
        const prev = input[(k + input.length - 1) % input.length];
        const sc = side(cur), sp = side(prev);
        if (sc >= 0) { if (sp < 0) out.push([prev[0] + (cur[0] - prev[0]) * (sp / (sp - sc)), prev[1] + (cur[1] - prev[1]) * (sp / (sp - sc))]); out.push(cur); }
        else if (sp >= 0) out.push([prev[0] + (cur[0] - prev[0]) * (sp / (sp - sc)), prev[1] + (cur[1] - prev[1]) * (sp / (sp - sc))]);
      });
    }
    return out;
  }

  /* a sheet point in a strip's own box coordinates (origin at the box's top-left corner) */
  function toBox(s, [x, y]) {
    const [tx, ty] = topOf(s);
    const [lx, ly] = rotate(-s.rot, x - tx, y - ty);
    return [lx + s.w / 2, ly];
  }

  // ---------- applying to the page ----------

  function applyDom() {
    for (const s of scene.strips) {
      const t = `translate(${s.ox.toFixed(2)}px, ${s.oy.toFixed(2)}px) rotate(${s.rot.toFixed(5)}rad)`;
      s.el.style.transform = t;
      if (s.gel) s.gel.style.transform = t;
      if (s.mel) s.mel.style.transform = t;
      for (const c of s.cells) {
        const ct = `translate(${c.x.toFixed(2)}px, ${c.dy.toFixed(2)}px) rotate(${c.ang.toFixed(5)}rad)`;
        c.el.style.transform = ct;
        if (c.gel) c.gel.style.transform = ct;
        if (c.mel) c.mel.style.transform = ct;
      }
      // Where this strip lies over another, it is split in two: the strip itself is cut away there, and its
      // twin (the ghost) fills just that region through a filter that makes each pixel as transparent as its
      // negative is clear. Elsewhere the strip is whole and opaque.
      const box = (pts) => 'M' + pts.map((p) => toBox(s, p).map((v) => v.toFixed(1)).join(' ')).join(' L') + ' Z';
      if (s.over.length) {
        const m = 80;                                  // generous margin: bent pieces reach a little past the box
        // the opaque part reaches 1px into the overlap, so the two parts always meet with no hairline between them
        const cut = s.over.map((poly) => inset(poly, 1)).filter((poly) => poly.length >= 3);
        s.el.style.clipPath = `path(evenodd, 'M ${-m} ${-m} L ${s.w + m} ${-m} L ${s.w + m} ${s.h + m} L ${-m} ${s.h + m} Z ${cut.map(box).join(' ')}')`;
        const region = `path('${s.over.map(box).join(' ')}')`;
        // the twins fill the cut-away region: one see-through by density, one multiplied onto what is below
        if (s.gel) { s.gel.style.clipPath = region; s.gel.style.visibility = "visible"; s.gel.style.opacity = String(1 - scene.stack); }
        if (s.mel) { s.mel.style.clipPath = region; s.mel.style.visibility = "visible"; s.mel.style.opacity = String(scene.stack); }
      } else {
        s.el.style.clipPath = "";
        if (s.gel) s.gel.style.visibility = "hidden";
        if (s.mel) s.mel.style.visibility = "hidden";
      }
    }
  }

  /* walk down a strip, each piece hanging off the end of the one above it */
  function chain(s) {
    let x = 0, dy = 0;
    s.cells.forEach((c, i) => {
      c.x = x; c.dy = dy;
      const len = i < s.cells.length - 1 ? s.cells[i + 1].top - c.top : c.h;
      x -= len * Math.sin(c.ang);
      dy += len * (Math.cos(c.ang) - 1);
    });
  }

  // ---------- the eyepiece rubbing the film ----------

  function stepRubbed(s, dt, eye, gate) {
    const n = s.cells.length;

    // how much of each piece is under the eyepiece
    const w = s.cells.map((c) => {
      const cx = s.left + s.w / 2 + s.ox + c.x;
      const cy = s.top + s.oy + c.top + c.h / 2 + c.dy;
      const t = Math.max(0, 1 - Math.hypot(eye.x - cx, eye.y - cy) / (eye.radius + c.h * 0.5));
      return t * t;
    });
    const under = Math.min(1, w.reduce((a, b) => a + b, 0) * 0.8);
    contactNow = Math.max(contactNow, under * gate);

    // the whole strip is pulled along by the eyepiece, and held back by the board
    if (held && held.s === s) {
      s.vx = s.vy = 0;
    } else {
      const pull = PUSH * gate * under * cfg.push;
      s.vx += (pull * (eye.vx - s.vx) - BOARD * s.vx) * dt;
      s.vy += (pull * (eye.vy - s.vy) - BOARD * s.vy) * dt;
      const lx = MAX_X * s.fw, ly = MAX_Y * s.fw;
      const wantX = s.ox + s.vx * dt, wantY = s.oy + s.vy * dt;
      const nx = Math.max(s.ax - lx, Math.min(s.ax + lx, wantX));
      const ny = Math.max(s.ay - ly, Math.min(s.ay + ly, wantY));
      if (nx !== wantX) s.vx = 0;
      if (ny !== wantY) s.vy = 0;
      const [ox, oy] = [s.ox, s.oy];
      s.ox = nx; s.oy = ny;
      if (!allowed(s)) { s.ox = ox; s.oy = oy; s.vx = s.vy = 0; }   // never slide over a neighbour
      if (Math.abs(s.vx) < 0.0004) s.vx = 0;     // board friction holds it once it is nearly still
      if (Math.abs(s.vy) < 0.0004) s.vy = 0;
    }

    // a gentle lean of each piece against its neighbours: a damped spring chain
    const speed = Math.hypot(eye.vx, eye.vy);
    for (let i = 0; i < n; i++) {
      const c = s.cells[i];
      const up = s.cells[Math.max(0, i - 1)], down = s.cells[Math.min(n - 1, i + 1)];
      const slope = ((w[Math.min(n - 1, i + 1)] - w[Math.max(0, i - 1)]) / 2);
      const noise = Math.sin(clock * 0.031 + i * 1.9 + s.left * 0.013) * Math.sin(clock * 0.0173 + i * 0.7);
      const force =
        -BEND * cfg.flutter * gate * eye.vx * slope +                // a dragged piece pulls its neighbours into an S
        FLICKER * cfg.flutter * gate * speed * w[i] * noise;         // friction catching and slipping
      const acc =
        -WN * WN * c.ang - 2 * ZETA * WN * c.omega +
        COUPLE * (up.ang - 2 * c.ang + down.ang) + force;
      c.omega += acc * dt;
      c.ang = Math.max(-MAX_ANG, Math.min(MAX_ANG, c.ang + c.omega * dt));
    }
    chain(s);
  }

  // ---------- grabbing a strip ----------

  /* Move a strip so the point you hold follows the pointer, as a rigid body on a board with friction.
     With sliding friction f_t per unit mass and turning friction f_r = SPIN * f_t * L^2 / 12, a pull
     dG at the held point splits into a slide and a turn:
       F = (I + r r^T / J)^-1 dG,  centre moves by F,  angle changes by (rx*Fy - ry*Fx) / J
     where r is the vector from the centre to the held point and J = SPIN * L^2 / 12.
     Holding the middle (r along the strip) makes the turn vanish; holding an end turns it about a point
     most of the way toward the other end. Returns what moved, or ok:false if a neighbour is in the way. */
  function pull(s, gx, gy, target, fraction) {
    const [cx, cy] = centreOf(s);
    const [rx, ry] = rotate(s.rot, gx, gy - s.h / 2);
    const dgx = (target.x - (cx + rx)) * fraction, dgy = (target.y - (cy + ry)) * fraction;
    const J = (SPIN * s.h * s.h) / 12;
    const det = 1 + (rx * rx + ry * ry) / J;
    const Fx = ((1 + (rx * rx) / J) * dgx + ((rx * ry) / J) * dgy) / det;
    const Fy = (((rx * ry) / J) * dgx + (1 + (ry * ry) / J) * dgy) / det;
    const dth = (rx * Fy - ry * Fx) / J;
    const rot = Math.max(s.rot0 - MAX_TURN, Math.min(s.rot0 + MAX_TURN, s.rot + dth));
    const turned = rot - s.rot;
    return { ok: place(s, cx + Fx, cy + Fy, rot), dx: Fx, dy: Fy, dth: turned };
  }

  // ---------- the public handle ----------

  return {
    /* eye: {x, y, vx, vy, radius} in sheet px and px per ms. Returns true while anything is still moving. */
    step(dtMs, eye) {
      const speed = Math.hypot(eye.vx, eye.vy);
      const gate = smoothstep(V0, V1, speed);
      let remaining = Math.min(dtMs, 40);
      contactNow = 0;
      let active = gate > 0.001 || held !== null || tidying;
      while (remaining > 0) {
        const dt = Math.min(STEP, remaining);
        remaining -= dt;
        clock += dt;
        if (held) held.speed *= Math.exp(-dt / 70);     // a held strip that stops moving falls silent

        for (const s of scene.strips) stepRubbed(s, dt, eye, gate);

        // released strips glide on, then stop
        for (const s of scene.strips) {
          if (held && held.s === s) continue;
          if (s.cvx || s.cvy || s.cw) {
            const [cx, cy] = centreOf(s);
            const rot = Math.max(s.rot0 - MAX_TURN, Math.min(s.rot0 + MAX_TURN, s.rot + s.cw * dt));
            if (!place(s, cx + s.cvx * dt, cy + s.cvy * dt, rot)) s.cvx = s.cvy = s.cw = 0;   // met a neighbour: stop
            const f = Math.exp(-dt / GLIDE_MS);
            s.cvx *= f; s.cvy *= f; s.cw *= f;
            if (Math.hypot(s.cvx, s.cvy) < 0.005 && Math.abs(s.cw) < 0.00002) s.cvx = s.cvy = s.cw = 0;
            active = true;
          }
        }

        if (tidying) {
          // organize: ease everything back to the starting layout
          const k = 1 - Math.exp(-dt / TIDY_MS);
          let left = 0;
          for (const s of scene.strips) {
            s.cvx = s.cvy = s.cw = s.vx = s.vy = 0;
            s.ox += (0 - s.ox) * k; s.oy += (0 - s.oy) * k; s.rot += (s.rot0 - s.rot) * k;
            s.ax = s.ox; s.ay = s.oy;
            for (const c of s.cells) { c.ang *= 1 - k; c.omega = 0; }
            chain(s);
            left = Math.max(left, Math.abs(s.ox), Math.abs(s.oy), Math.abs(s.rot - s.rot0) * s.h);
          }
          if (left < 0.1) {
            for (const s of scene.strips) {
              s.ox = s.oy = s.ax = s.ay = 0;
              s.rot = s.rot0;
              for (const c of s.cells) { c.ang = 0; c.omega = 0; }
              chain(s);
            }
            for (const s of scene.strips) { s.manual = false; s.z = 0; s.el.style.zIndex = ""; if (s.gel) s.gel.style.zIndex = ""; if (s.mel) s.mel.style.zIndex = ""; }
            zTop = 0;
            tidying = false;
          }
        } else {
          // keep neighbours apart even when bends swing them together
          for (let i = 0; i < scene.strips.length - 1; i++) {
            if (!mustStayApart(i)) continue;
            const over = KEEP_APART - spare(i);
            if (over > 0) {
              const a = scene.strips[i], b = scene.strips[i + 1];
              const aHeld = held && held.s === a, bHeld = held && held.s === b;
              if (!aHeld) a.ox -= bHeld ? over : over / 2;
              if (!bHeld) b.ox += aHeld ? over : over / 2;
              a.vx = b.vx = (a.vx + b.vx) / 2;
            }
          }
        }
      }
      for (const s of scene.strips) {
        if (Math.abs(s.vx) > 0 || Math.abs(s.vy) > 0) active = true;
        for (const c of s.cells) if (Math.abs(c.ang) > 0.0002 || Math.abs(c.omega) > 0.00001) active = true;
      }
      // sound: a strip moving on the board slides; one riding over another also crackles
      moveSlide = moveRub = 0;
      for (const s of scene.strips) {
        let sp = 0;
        if (held && held.s === s) sp = held.speed;
        else if (s.cvx || s.cvy || s.cw) sp = Math.hypot(s.cvx, s.cvy) + Math.abs(s.cw) * s.h * 0.25;
        if (sp < 0.03) continue;
        const level = Math.min(1, sp / 1.4);
        moveSlide = Math.max(moveSlide, level);
        const over = overlapOf(s);
        // ordinary drag speeds should already crackle clearly when one strip rides over another
        if (over > 0) moveRub = Math.max(moveRub, Math.min(1, sp / 0.8) * Math.min(1, 0.5 + over * 1.5));
      }
      if (active || wasActive) { findOverlaps(); applyDom(); }
      wasActive = active;
      contact = contactNow;
      return active;
    },

    /* how hard the eyepiece is rubbing the film (0..1), for the crackle */
    get contact() { return contact; },
    /* a strip is moving on the board (0..1), for the slide sound */
    get moveSlide() { return moveSlide; },
    /* a moving strip is riding over another strip (0..1), for the crackle */
    get moveRub() { return moveRub; },

    /* which strip, if any, is at this point (sheet px)? returns where on it you are holding */
    hit(x, y) {
      const topFirst = scene.strips.map((s, i) => [s, i]).sort((a, b) => (b[0].z - a[0].z) || (b[1] - a[1]));
      for (const [s] of topFirst) {
        const [tx, ty] = topOf(s);
        const [lx, ly] = rotate(-s.rot, x - tx, y - ty);
        if (Math.abs(lx) <= s.w / 2 && ly >= 0 && ly <= s.h) return { s, gx: lx, gy: ly };
      }
      return null;
    },

    /* pick a strip up at the point `hit` found */
    grab(hit) {
      tidying = false;
      hit.s.manual = true;
      hit.s.z = ++zTop;                                        // lift it above the others
      hit.s.el.style.zIndex = hit.s.z;
      if (hit.s.gel) hit.s.gel.style.zIndex = hit.s.z;
      if (hit.s.mel) hit.s.mel.style.zIndex = hit.s.z;
      held = { s: hit.s, gx: hit.gx, gy: hit.gy, t: performance.now(), v: { x: 0, y: 0, w: 0 }, speed: 0 };
      hit.s.cvx = hit.s.cvy = hit.s.cw = 0;
      hit.s.vx = hit.s.vy = 0;
    },

    /* the pointer moved: bring the held point toward it, as far as a neighbour allows */
    dragTo(point) {
      if (!held) return;
      const { s, gx, gy } = held;
      for (const f of [1, 0.5, 0.25, 0.12]) {
        const r = pull(s, gx, gy, point, f);
        if (!r.ok) continue;
        const now = performance.now();
        const dt = Math.max(1, now - held.t);
        held.t = now;
        const a = 0.4;                                         // smoothed velocity, for the glide after release
        held.v.x += (r.dx / dt - held.v.x) * a;
        held.v.y += (r.dy / dt - held.v.y) * a;
        held.v.w += (r.dth / dt - held.v.w) * a;
        held.speed = Math.hypot(r.dx, r.dy) / dt + (Math.abs(r.dth) / dt) * s.h * 0.25;   // for the sound
        return;
      }
    },

    /* let go: if it was still moving, it glides on a moment */
    release() {
      if (!held) return;
      const { s, v, t } = held;
      if (performance.now() - t < 80) { s.cvx = v.x; s.cvy = v.y; s.cw = v.w; }
      held = null;
    },

    get holding() { return held !== null; },

    /* 0 = stacked film blends by transparency, 1 = it multiplies the light */
    setStack(m) { scene.stack = m; findOverlaps(); applyDom(); },

    /* organize: ease the whole film back to its starting layout */
    reset() {
      this.release();
      tidying = true;
    },
  };
}
