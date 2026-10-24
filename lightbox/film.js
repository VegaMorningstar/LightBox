/* The film on the board.
 *
 * Two ways it moves:
 *
 * 1. The eyepiece rubs it. Friction between the eyepiece and the film, and between the film and the
 *    board. Only a fast slide matters: below V0 the eyepiece glides over the film without touching it;
 *    the pull fades in up to V1. A strip under the eyepiece is dragged a little along with it, then
 *    stops again (board friction), and each frame-sized piece of it leans a hair against its
 *    neighbours, bending the strip into a soft S-curve that eases in and settles without wobbling.
 *    The drag acts where the eyepiece is, as a hand would, so it works like a grab (below): over the
 *    top of a strip the top swings across while the bottom barely moves, over the middle the whole
 *    strip slides, over the bottom it is the other way round.
 *    A strip that is moved over another (held, or gliding after a throw) rubs it the same way: friction
 *    where they overlap pulls the strip beneath along a little, at the point where they touch.
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
 * The rules here are listed in PHYSICS.md (§3, §4.7, §4.8 and §4.9); keep it in step when a rule changes.
 *
 * It only edits numbers on the scene (see raster.js) and the matching DOM transforms, so the page
 * and both glasses draw the same film.
 */

import { stripQuad } from "./raster.js";
import { createBendPhysics } from "./film-bend/index.js";

const V0 = 0.8;               // eyepiece speed (px per ms) where the film starts to be dragged
const V1 = 1.9;               // ...and where it is dragged fully
const PUSH = 0.0012;          // how strongly the eyepiece pulls a strip, per ms
const BOARD = 0.012;          // board friction on a sliding strip, per ms
const MAX_X = 0.14;           // furthest the eyepiece nudges a strip sideways, in frame widths
const MAX_Y = 0.22;           // ...and along its length
const RUB_STRIP = 0.01;       // how strongly a moving strip drags the one beneath it, per ms, where they fully overlap
const EYE_LOAD = 0.4;         // how much a strip held under the eyepiece lags the hand: the eyepiece is heavier than the film
const CARRY_GATE = 0.6;       // how firmly an eyepiece that is itself being carried by film still rubs the other strips under it, even when slow
const CARRY_K = 0.007;        // per ms: how firmly a carried eyepiece drags the other strips beneath it (times the Carried slider)
// (film that buckles when pushed lengthwise against the eyepiece: film-bend/physics.js, see PHYSICS.md §4.9)
const SLAP = 0.35;            // share of the eyepiece's speed it hands to the film under it the moment it lands
const NUDGE_END = 0.2;        // furthest an end of a strip is swung by the eyepiece, in frame widths (the turn is limited to match)
const SPIN_RUB = 0.9;         // how stubbornly a strip resists being turned by the eyepiece (a light rub turns it more readily than a firm grab)
const NUDGE_TURN = 0.06;      // ...and never more than this many radians

const WN = (2 * Math.PI * 4) / 1000;   // stiffness of the bend, in rad per ms
const ZETA = 0.75;                     // heavily damped: it eases back without overshooting or ringing
const COUPLE = 0.5 * WN * WN;          // how much neighbouring pieces pull on each other
const DRAG_TILT = 0.03 * WN * WN;      // sideways drag -> tilt (the S-curve of flutter, not the buckling of film-bend/)
const FLICKER = 0.0004 * WN * WN;      // a trace of friction stick-slip -> tilt (kept tiny: jitter looks fake)
const MAX_ANG = 0.016;                 // about 0.9 degrees; keeps neighbouring pieces overlapping

// the jolt when the eyepiece is set down: the film is a thin sheet answering a weight put on it, so it gives once and eases back,
// with no ringing (a critically damped spring: one bump, then back to rest)
const JW = 0.02;                       // rad per ms: the bump peaks about 50 ms in
const JZ = 1;                          // critical damping: never overshoots, so it cannot shake
const JOLT = 0.09;                     // px per ms of the first kick at full strength, in the middle of the eyepiece (a bump of about 1.5 px)

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

export function createFilm(scene, cfg = { push: 1, flutter: 1, rub: 0.5, eyeLoad: EYE_LOAD, carry: CARRY_GATE, slap: SLAP, bend: 1, bendPush: 1, edge: 1 }) {
  let clock = 0;
  let wasActive = false;
  let contact = 0;      // 0..1: how hard the eyepiece is rubbing the film right now
  let contactNow = 0;
  let held = null;      // the strip being gripped: { s, gx, gy, t, v }
  let tidying = false;
  let moveSlide = 0;    // 0..1: a strip is sliding on the board (held, or gliding after a throw)
  let moveRub = 0;      // 0..1: a moving strip is also riding over another strip
  let eyeLoad = 0;      // 0..: how much of the eyepiece lies on the strip being held, times its weight
  let zTop = 0;         // the strip last picked up sits on top
  scene.strips.forEach((s) => {
    s.cells.forEach((c) => { c.jx = c.jy = c.jvx = c.jvy = 0; c.by = 0; c.z = 0; c.k = 1; c.shade = 1; });
  });
  // film that buckles under a push (film-bend/): it reads who holds a strip and what lies under the eyepiece from here, and writes s.bk, s.bent, s.drawn and each cell's z / by / k / shade
  const bend = createBendPhysics({ scene, cfg, host: { held: () => held, topOf: (s) => topOf(s), rotate, coverage: (s, eye) => coverage(s, eye) } });
  scene.strips.forEach((s) => { s.rot0 = s.rot; s.ax = 0; s.ay = 0; s.arot = s.rot; s.cvx = s.cvy = s.cw = 0; s.vw = 0; s.manual = false; s.z = 0; });

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

  /* where a strip rests when nothing is rubbing it: the eyepiece only ever nudges it a little way from here */
  function anchorHere(s) {
    s.ax = s.ox; s.ay = s.oy; s.arot = s.rot;
    [s.acx, s.acy] = centreOf(s);
  }
  scene.strips.forEach(anchorHere);

  /* put a strip's centre at (cx, cy) and its angle at `rot`; refuse (and leave it as it was) if not allowed */
  function place(s, cx, cy, rot, anchor = true) {
    const old = [s.ox, s.oy, s.rot];
    const dx = Math.sin(rot) * s.h / 2, dy = Math.cos(rot) * s.h / 2;
    s.rot = rot;
    s.ox = cx + dx - (s.left + s.w / 2);
    s.oy = cy - dy - s.top;
    if (allowed(s)) { if (anchor) anchorHere(s); return true; }
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
    bend.markDrawn();
    for (const s of scene.strips) {
      // Writing a style makes the browser re-check the layout, so only what actually changed is written (most strips
      // sit still while the eyepiece or one other strip moves).
      // a bent strip (or one that must be drawn with it) is drawn from a canvas instead (film-bend/draw.js), so the page one is hidden
      if (!!s.drawn !== !!s._bentShown) {
        s._bentShown = !!s.drawn;
        s.el.style.visibility = s.drawn ? "hidden" : "";
        if (s.drawn) { if (s.gel) s.gel.style.visibility = "hidden"; if (s.mel) s.mel.style.visibility = "hidden"; }
        else s._clip = undefined;                         // the overlap twins re-check their visibility
      }
      const t = `translate(${s.ox.toFixed(2)}px, ${s.oy.toFixed(2)}px) rotate(${s.rot.toFixed(5)}rad)`;
      if (s._t !== t) {
        s._t = t;
        s.el.style.transform = t;
        if (s.gel) s.gel.style.transform = t;
        if (s.mel) s.mel.style.transform = t;
      }
      for (const c of s.cells) {
        // a lifted or curved-away piece looks bigger or smaller about its middle, and darker as it falls away from the light
        const ct = `translate(${c.x.toFixed(2)}px, ${(c.dy + (c.h / 2) * (1 - c.k)).toFixed(2)}px) rotate(${c.ang.toFixed(5)}rad)` + (c.k !== 1 ? ` scale(${c.k.toFixed(4)})` : "");
        const cf = c.shade < 0.99 ? `brightness(${c.shade.toFixed(3)})` : "";
        if (c._t === ct && c._f === cf) continue;
        c._t = ct;
        c.el.style.transform = ct;
        if (c.gel) c.gel.style.transform = ct;
        if (c.mel) c.mel.style.transform = ct;
        if (c._f !== cf) { c._f = cf; c.el.style.filter = cf; if (c.gel) c.gel.style.filter = cf; if (c.mel) c.mel.style.filter = cf; }
      }
      // Where this strip lies over another, it is split in two: the strip itself is cut away there, and its
      // twin (the ghost) fills just that region through a filter that makes each pixel as transparent as its
      // negative is clear. Elsewhere the strip is whole and opaque.
      const box = (pts) => 'M' + pts.map((p) => toBox(s, p).map((v) => v.toFixed(1)).join(' ')).join(' L') + ' Z';
      if (s.over.length) {
        const m = 80;                                  // generous margin: bent pieces reach a little past the box
        // the opaque part reaches 1px into the overlap, so the two parts always meet with no hairline between them
        const cut = s.over.map((poly) => inset(poly, 1)).filter((poly) => poly.length >= 3);
        const hole = `path(evenodd, 'M ${-m} ${-m} L ${s.w + m} ${-m} L ${s.w + m} ${s.h + m} L ${-m} ${s.h + m} Z ${cut.map(box).join(' ')}')`;
        const region = `path('${s.over.map(box).join(' ')}')`;
        const key = hole + region + scene.stack;
        if (s._clip !== key) {
          s._clip = key;
          s.el.style.clipPath = hole;
          // the twins fill the cut-away region: one see-through by density, one multiplied onto what is below
          if (s.gel) { s.gel.style.clipPath = region; s.gel.style.visibility = s.drawn ? "hidden" : "visible"; s.gel.style.opacity = String(1 - scene.stack); }
          if (s.mel) { s.mel.style.clipPath = region; s.mel.style.visibility = s.drawn ? "hidden" : "visible"; s.mel.style.opacity = String(scene.stack); }
        }
      } else if (s._clip) {
        s._clip = "";
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
      c.x = x + c.jx; c.dy = dy + c.jy + c.by;
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

    // The strip is pulled along by the eyepiece, and held back by the board. The pull acts at the point of the strip the eyepiece
    // is over, like a hand would, and is shared between sliding the strip and turning it exactly as when you grab it: over the
    // top the top swings, over the middle the whole strip slides, over the bottom the bottom swings.
    if (held && held.s === s) {
      s.vx = s.vy = s.vw = 0;
    } else {
      const [tx, ty] = topOf(s);
      const [lx, ly] = rotate(-s.rot, eye.x - tx, eye.y - ty);
      const gx = Math.max(-s.w / 2, Math.min(s.w / 2, lx)), gy = Math.max(0, Math.min(s.h, ly));
      const [crx, cry] = rotate(s.rot, gx, gy - s.h / 2);       // from the strip's centre to the point under the eyepiece
      const J = (SPIN_RUB * s.h * s.h) / 12;
      const [cx0, cy0] = centreOf(s);
      // An eyepiece that film is carrying along also drags the other strips under it, a little, however slowly it goes
      const kEye = Math.max(PUSH * gate * under * cfg.push, eye.carried ? CARRY_K * (cfg.carry ?? CARRY_GATE) * under : 0);
      const pushes = [{ rx: crx, ry: cry, vx: eye.vx, vy: eye.vy, k: kEye }];
      for (const d of s.drives ?? []) pushes.push({ rx: d.px - cx0, ry: d.py - cy0, vx: d.vx, vy: d.vy, k: d.k });
      let fx = 0, fy = 0, tq = 0;
      for (const p of pushes) {
        if (p.k <= 0) continue;
        const vpx = s.vx - s.vw * p.ry, vpy = s.vy + s.vw * p.rx;      // how fast the strip is moving at that point now
        const ax = p.k * (p.vx - vpx), ay = p.k * (p.vy - vpy);
        fx += ax; fy += ay;
        tq += (p.rx * ay - p.ry * ax) / J;
      }
      s.vx += (fx - BOARD * s.vx) * dt;
      s.vy += (fy - BOARD * s.vy) * dt;
      s.vw += (tq - BOARD * s.vw) * dt;
      const [cx, cy] = centreOf(s);
      const lxm = MAX_X * s.fw, lym = MAX_Y * s.fw;
      const turnMax = Math.min(NUDGE_TURN, (NUDGE_END * s.fw) / (s.h / 2));
      const wantX = cx + s.vx * dt, wantY = cy + s.vy * dt, wantR = s.rot + s.vw * dt;
      const nx = Math.max(s.acx - lxm, Math.min(s.acx + lxm, wantX));
      const ny = Math.max(s.acy - lym, Math.min(s.acy + lym, wantY));
      const nr = Math.max(s.arot - turnMax, Math.min(s.arot + turnMax, wantR));
      if (nx !== wantX) s.vx = 0;
      if (ny !== wantY) s.vy = 0;
      if (nr !== wantR) s.vw = 0;
      if (nx !== cx || ny !== cy || nr !== s.rot) {                  // (a strip that is not moving cannot have run into anything)
        if (!place(s, nx, ny, nr, false)) s.vx = s.vy = s.vw = 0;    // never slide over a neighbour
      }
      if (Math.abs(s.vx) < 0.0004) s.vx = 0;     // board friction holds it once it is nearly still
      if (Math.abs(s.vy) < 0.0004) s.vy = 0;
      if (Math.abs(s.vw) < 0.0008 / s.h) s.vw = 0;
    }

    // the shiver from the eyepiece being set down: each piece rings like a spring on the board and dies away
    for (const c of s.cells) {
      if (!c.jx && !c.jy && !c.jvx && !c.jvy) continue;
      c.jvx += (-JW * JW * c.jx - 2 * JZ * JW * c.jvx) * dt;
      c.jvy += (-JW * JW * c.jy - 2 * JZ * JW * c.jvy) * dt;
      c.jx += c.jvx * dt; c.jy += c.jvy * dt;
      if (Math.abs(c.jx) < 0.01 && Math.abs(c.jy) < 0.01 && Math.abs(c.jvx) < 0.0002 && Math.abs(c.jvy) < 0.0002) c.jx = c.jy = c.jvx = c.jvy = 0;
    }

    // a gentle lean of each piece against its neighbours: a damped spring chain
    const speed = Math.hypot(eye.vx, eye.vy);
    for (let i = 0; i < n; i++) {
      const c = s.cells[i];
      const up = s.cells[Math.max(0, i - 1)], down = s.cells[Math.min(n - 1, i + 1)];
      const slope = ((w[Math.min(n - 1, i + 1)] - w[Math.max(0, i - 1)]) / 2);
      const noise = Math.sin(clock * 0.031 + i * 1.9 + s.left * 0.013) * Math.sin(clock * 0.0173 + i * 0.7);
      const force =
        -DRAG_TILT * cfg.flutter * gate * eye.vx * slope +                // a dragged piece pulls its neighbours into an S
        FLICKER * cfg.flutter * gate * speed * w[i] * noise;         // friction catching and slipping
      const acc =
        -WN * WN * c.ang - 2 * ZETA * WN * c.omega +
        COUPLE * (up.ang - 2 * c.ang + down.ang) + force;
      c.omega += acc * dt;
      c.ang = Math.max(-MAX_ANG, Math.min(MAX_ANG, c.ang + c.omega * dt));
    }
    chain(s);
  }

  // ---------- strips rubbing each other ----------

  /* How fast a strip is being moved by hand or by its glide: {x, y, w} in px and rad per ms (0 when it is not). */
  function moverVelocity(s) {
    // what the strip is really doing on screen, measured frame to frame (it includes the turn), for a strip that is held or gliding
    if ((held && held.s === s) || s.cvx || s.cvy || s.cw) return s.mv && (s.mv.x || s.mv.y || s.mv.w) ? s.mv : null;
    return null;
  }

  /* how much of the eyepiece's disc a strip lies under, weighted toward the middle of the eyepiece (which holds the film more than its
     edge): {n: weight under the strip, tot: total weight, sx, sy: where that patch is} */
  function coverage(s, eye) {
    const [tx, ty] = topOf(s);
    let n = 0, tot = 0, sx = 0, sy = 0, lySum = 0, lyMin = Infinity, lyMax = -Infinity;
    for (let i = -4; i <= 4; i++) for (let j = -4; j <= 4; j++) {
      if (i * i + j * j > 16) continue;
      const px = eye.x + (i * eye.radius) / 4, py = eye.y + (j * eye.radius) / 4;
      const wgt = 1 - 0.5 * Math.hypot(i, j) / 4;
      tot += wgt;
      const [lx, ly] = rotate(-s.rot, px - tx, py - ty);
      if (Math.abs(lx) <= s.w / 2 && ly >= 0 && ly <= s.h) {
        n += wgt; sx += px * wgt; sy += py * wgt; lySum += ly * wgt;
        if (ly < lyMin) lyMin = ly;
        if (ly > lyMax) lyMax = ly;
      }
    }
    return { n, tot, sx, sy, lySum, lyMin, lyMax };
  }

  /* measure how fast each strip's centre moved and turned since the last frame (smoothed a little) */
  function measureMotion(dtMs) {
    for (const s of scene.strips) {
      const [cx, cy] = centreOf(s);
      if (s.pc && dtMs > 0) {
        const a = 0.5;
        const vx = (cx - s.pc[0]) / dtMs, vy = (cy - s.pc[1]) / dtMs, vw = (s.rot - s.pc[2]) / dtMs;
        s.mv = s.mv ?? { x: 0, y: 0, w: 0 };
        s.mv.x += (vx - s.mv.x) * a; s.mv.y += (vy - s.mv.y) * a; s.mv.w += (vw - s.mv.w) * a;
      }
      s.pc = [cx, cy, s.rot];
    }
  }

  /* A strip being moved over another one drags it along by friction where they overlap: the push acts at the middle of the shared
     patch, at the speed the moving strip has there. stepRubbed turns these into a slide and a turn of the strip beneath. */
  function stripDrives() {
    for (const t of scene.strips) t.drives = [];
    for (const m of scene.strips) {
      const V = moverVelocity(m);
      if (!V || Math.hypot(V.x, V.y) + Math.abs(V.w) * m.h * 0.25 < 0.02) continue;
      const [mcx, mcy] = centreOf(m);
      const qm = stripQuad(m);
      for (const t of scene.strips) {
        if (t === m || (held && held.s === t)) continue;
        const poly = clipPolygon(qm, stripQuad(t));
        if (poly.length < 3) continue;
        const A = area(poly);
        if (A < 12) continue;
        const frac = Math.min(1, A / (t.w * t.w));                // a patch about as long as the strip is wide grips fully
        let px = 0, py = 0;
        for (const [x, y] of poly) { px += x; py += y; }
        px /= poly.length; py /= poly.length;
        const rx = px - mcx, ry = py - mcy;
        t.drives.push({ px, py, vx: V.x - V.w * ry, vy: V.y + V.w * rx, k: RUB_STRIP * frac * (cfg.rub ?? 1) });
      }
    }
  }

  // ---------- bending ----------
  // Film that buckles when it is pushed lengthwise against the eyepiece lives in film-bend/ (physics.js: bend.update, called once a frame from step()).

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
      let gate = smoothstep(V0, V1, speed);
      // An eyepiece that film is carrying (slowly: it is heavy) still rubs the other strips under it, a little
      if (eye.carried) gate = Math.max(gate, (cfg.carry ?? CARRY_GATE) * smoothstep(0.03, 0.2, speed));
      // A strip held down under the eyepiece is harder to drag: the eyepiece rests on it
      if (held && eye.down > 0.01) { const c = coverage(held.s, eye); eyeLoad = Math.min(1, c.n / c.tot / 0.3) * (eye.mass ?? 1) * eye.down; } else eyeLoad = 0;
      // Nothing touching the film, and the film at rest (the usual case while the eyepiece just glides about):
      // there is nothing to work out, so skip the physics for the frame.
      const stirring = gate > 0.001 || held !== null || tidying || scene.strips.some((s) =>
        s.vx || s.vy || s.vw || s.cvx || s.cvy || s.cw || bend.isMoving(s) || s.cells.some((c) => Math.abs(c.ang) > 0.0002 || Math.abs(c.omega) > 0.00001 || c.jvx || c.jvy || c.jx || c.jy));
      if (!stirring) {
        if (wasActive) { findOverlaps(); applyDom(); wasActive = false; }
        for (const s of scene.strips) { s.pc = null; s.mv = null; }
        contact = 0; moveSlide = moveRub = 0;
        return false;
      }
      let remaining = Math.min(dtMs, 40);
      contactNow = 0;
      let active = gate > 0.001 || held !== null || tidying;
      while (remaining > 0) {
        const dt = Math.min(STEP, remaining);
        remaining -= dt;
        clock += dt;
        if (held) held.speed *= Math.exp(-dt / 70);     // a held strip that stops moving falls silent

        stripDrives();
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
            s.cvx = s.cvy = s.cw = s.vx = s.vy = s.vw = 0;
            s.ox += (0 - s.ox) * k; s.oy += (0 - s.oy) * k; s.rot += (s.rot0 - s.rot) * k;
            s.vw = 0;
            for (const c of s.cells) { c.ang *= 1 - k; c.omega = 0; c.jx *= 1 - k; c.jy *= 1 - k; c.jvx = c.jvy = 0; }
            chain(s);
            anchorHere(s);
            left = Math.max(left, Math.abs(s.ox), Math.abs(s.oy), Math.abs(s.rot - s.rot0) * s.h);
          }
          if (left < 0.1) {
            for (const s of scene.strips) {
              s.ox = s.oy = s.ax = s.ay = 0;
              s.rot = s.rot0;
              for (const c of s.cells) { c.ang = 0; c.omega = 0; }
              chain(s);
              anchorHere(s);
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
        if (Math.abs(s.vx) > 0 || Math.abs(s.vy) > 0 || Math.abs(s.vw) > 0 || bend.isMoving(s) || !!s.drawn !== !!s._bentShown) active = true;
        for (const c of s.cells) if (Math.abs(c.ang) > 0.0002 || Math.abs(c.omega) > 0.00001 || c.jx || c.jy || c.jvx || c.jvy) active = true;
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
      bend.update(dtMs, eye);
      // a strip nudged along the board (by the eyepiece rubbing it, being carried, or another strip riding it) slides softly too
      for (const s of scene.strips) {
        if (held && held.s === s) continue;
        const sp = Math.hypot(s.vx, s.vy) + Math.abs(s.vw) * s.h * 0.25;
        if (sp > 0.008) moveSlide = Math.max(moveSlide, Math.min(1, sp / 0.12) * 0.7);
      }
      measureMotion(Math.min(dtMs, 40));
      if (active || wasActive) { findOverlaps(); applyDom(); }
      wasActive = active;
      contact = contactNow;
      return active;
    },

    /* Film being moved under the eyepiece drags it along. eye = {x, y, radius}. Returns {x, y, f}: the velocity (px/ms) the moving film
       would give the eyepiece, and how firmly it holds it (0..1). It is worked out at the patch of film that is under the eyepiece: the
       strip's own velocity there (its slide plus the swing of its turn, so the top and bottom of one strip drag differently), counted
       more the nearer the middle of the eyepiece, and by how much of the eyepiece the strip covers. A strip that is not moving, or is
       not under the eyepiece, does nothing. */
    dragOnEye(eye) {
      let fSum = 0, vx = 0, vy = 0;
      for (const s of scene.strips) {
        const V = moverVelocity(s);
        if (!V || Math.hypot(V.x, V.y) + Math.abs(V.w) * s.h * 0.25 < 0.02) continue;
        const [cx, cy] = centreOf(s);
        let { n, tot, sx, sy } = coverage(s, eye);
        if (n <= 0) continue;
        sx /= n; sy /= n;
        const rx = sx - cx, ry = sy - cy;
        const f = Math.min(1, n / tot / 0.3);                        // a strip about as wide as the eyepiece's third grips it fully
        let wvx = V.x - V.w * ry, wvy = V.y + V.w * rx;
        // A held strip pushed lengthwise toward the eyepiece cannot push it: the film buckles instead (film-bend/physics.js). Only a pull away from it, or sideways, passes through.
        if (held && held.s === s) [wvx, wvy] = bend.holdBack(s, wvx, wvy);
        fSum += f; vx += wvx * f; vy += wvy * f;
      }
      return fSum > 0 ? { x: vx / fSum, y: vy / fSum, f: Math.min(1, fSum) } : { x: 0, y: 0, f: 0 };
    },

    /* The eyepiece lands while moving (eye = {x, y, vx, vy, radius}): it drags the film beneath along its line the moment it touches,
       whatever its speed, as a rub at speed would. The strips under it get a push and a turn at the point it lands, and their pieces
       lean into the S-bend. strength: 0 = none, 1 = the usual. */
    slap(eye, strength = 1) {
      if (strength <= 0 || Math.hypot(eye.vx, eye.vy) < 0.05) return;
      for (const s of scene.strips) {
        const n = s.cells.length;
        const w = s.cells.map((c) => {
          const cx = s.left + s.w / 2 + s.ox + c.x, cy = s.top + s.oy + c.top + c.h / 2 + c.dy;
          const t = Math.max(0, 1 - Math.hypot(eye.x - cx, eye.y - cy) / (eye.radius + c.h * 0.5));
          return t * t;
        });
        const under = Math.min(1, w.reduce((a, b) => a + b, 0) * 0.8);
        if (under < 0.02) continue;
        const [tx, ty] = topOf(s);
        const [lx, ly] = rotate(-s.rot, eye.x - tx, eye.y - ty);
        const gx = Math.max(-s.w / 2, Math.min(s.w / 2, lx)), gy = Math.max(0, Math.min(s.h, ly));
        const [rx, ry] = rotate(s.rot, gx, gy - s.h / 2);
        const J = (SPIN_RUB * s.h * s.h) / 12;
        const K = (cfg.slap ?? SLAP) * strength * under * cfg.push;
        const fx = K * (eye.vx - (s.vx - s.vw * ry)), fy = K * (eye.vy - (s.vy + s.vw * rx));
        s.vx += fx; s.vy += fy; s.vw += (rx * fy - ry * fx) / J;
        s.cells.forEach((c, i) => {
          const slope = (w[Math.min(n - 1, i + 1)] - w[Math.max(0, i - 1)]) / 2;
          c.omega += -DRAG_TILT * cfg.flutter * eye.vx * slope * 70 * strength;
        });
      }
      wasActive = true;
    },

    /* the eyepiece has just been set down at eye = {x, y, radius}: the film directly under it gets a quick shiver, strongest in the
       middle and fading out toward the edge of the eyepiece. strength: 0 = none, 1 = the usual landing. */
    thump(eye, strength = 1) {
      if (strength <= 0) return;
      for (const s of scene.strips) {
        s.cells.forEach((c, i) => {
          const cx = s.left + s.w / 2 + s.ox + c.x;
          const cy = s.top + s.oy + c.top + c.h / 2 + c.dy;
          const d = Math.hypot(eye.x - cx, eye.y - cy) / (eye.radius * 1.15);
          const w = Math.exp(-d * d * 1.6);
          if (w < 0.03) return;
          const ripple = 0.7 + 0.3 * Math.sin(i * 2.1 + s.left * 0.01);
          c.jvy += JOLT * strength * w * ripple;                       // every piece under the weight gives the same way
          c.jvx += JOLT * 0.12 * strength * w * Math.sin(i * 1.3 + s.left * 0.02);
        });
      }
      wasActive = true;
    },

    /* the push (px per ms squared) the film's slack gives the eyepiece: read it each frame and add it to the eyepiece's velocity */
    get eyePush() { return bend.eyePush; },
    /* the wops waiting to be played ({kind: "up" | "down", k}); reading them empties the list */
    takeBendEvents() { return bend.takeEvents(); },
    /* the film is bending or springing back (0..1), for the crunch */
    get bendCrunch() { return bend.crunch; },

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
      hit.s.vx = hit.s.vy = hit.s.vw = 0;
    },

    /* the pointer moved: bring the held point toward it, as far as a neighbour allows */
    dragTo(point) {
      if (!held) return;
      const { s, gx, gy } = held;
      const lag = 1 / (1 + (cfg.eyeLoad ?? EYE_LOAD) * eyeLoad);
      for (const f0 of [1, 0.5, 0.25, 0.12]) {
        const f = f0 * lag;
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
