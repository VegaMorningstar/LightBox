/* Light seeping onto the film.
 * The rules it follows are listed in PHYSICS.md (§3.2); keep it in step when one changes.
 *
 * A light box is a sheet of light under the film. Where there is no film the light comes straight up; where there
 * is, it is held back, but not at the very edge: light spills sideways in the film base and the air, so the border
 * of a strip near open board glows a little, fading toward the middle of the strip.
 *
 * This works out that glow for the whole sheet in two steps. First a small map of open board (white) and film (black)
 * is blurred, which says how much open light there is within reach of each point. Then that glow is kept only
 * where there is film, so the board itself is not touched. The result is one sheet-sized canvas: the page lays it
 * over the film, and both glasses draw it into the views they refract and magnify, so all three agree.
 *
 * Light also comes up through some of the sprocket holes and blooms onto the film base around them. That is drawn
 * separately, as crisp shapes at whatever scale the picture is drawn at (paintHoles), so a lit hole is as sharp as a
 * dark one, even through the magnifier.
 *
 * Self-contained: it only needs the sheet size, the strips' outlines (four corners each, in sheet px) and the holes.
 */

const MAP_SCALE = 0.25;     // the board/film map is this fraction of the sheet's size (fine enough for a narrow glow, still cheap to blur)
const GLOW_SCALE = 0.5;     // and the glow canvas is this fraction
const LIGHT = [255, 238, 205];

export function createBleed() {
  const canvas = document.createElement("canvas");   // the glow, over film only
  const map = document.createElement("canvas");      // board/film map, then the blurred glow
  let key = "";

  /* the box blur of one channel, along rows then columns; `r` pixels either side */
  function blur(a, w, h, r) {
    const tmp = new Float32Array(a.length);
    const n = 2 * r + 1;
    for (let y = 0; y < h; y++) {
      let sum = 0;
      const row = y * w;
      for (let x = -r; x <= r; x++) sum += a[row + Math.min(w - 1, Math.max(0, x))];
      for (let x = 0; x < w; x++) {
        tmp[row + x] = sum / n;
        sum += a[row + Math.min(w - 1, x + r + 1)] - a[row + Math.max(0, x - r)];
      }
    }
    for (let x = 0; x < w; x++) {
      let sum = 0;
      for (let y = -r; y <= r; y++) sum += tmp[Math.min(h - 1, Math.max(0, y)) * w + x];
      for (let y = 0; y < h; y++) {
        a[y * w + x] = sum / n;
        sum += tmp[Math.min(h - 1, y + r + 1) * w + x] - tmp[Math.max(0, y - r) * w + x];
      }
    }
  }

  return {
    canvas,
    /* (re)draw if anything changed. quads: the strips' outlines. spread: how far the light reaches, sheet px.
       strength: 0 = none. Returns true if it redrew. */
    update(W, H, quads, spread, strength) {
      const sig = [W, H, spread, strength, ...quads.flat(2).map((v) => Math.round(v * 2))].join(",");
      if (sig === key) return false;
      key = sig;
      const mw = Math.max(2, Math.round(W * MAP_SCALE)), mh = Math.max(2, Math.round(H * MAP_SCALE));
      const gw = Math.max(2, Math.round(W * GLOW_SCALE)), gh = Math.max(2, Math.round(H * GLOW_SCALE));
      if (canvas.width !== gw || canvas.height !== gh) { canvas.width = gw; canvas.height = gh; }
      const g = canvas.getContext("2d");
      g.setTransform(1, 0, 0, 1, 0, 0);
      g.globalCompositeOperation = "source-over";
      g.clearRect(0, 0, gw, gh);
      if (strength <= 0 || !quads.length) return true;

      // the map: open board white, film black
      map.width = mw; map.height = mh;
      const m = map.getContext("2d", { willReadFrequently: true });
      m.fillStyle = "#fff";
      m.fillRect(0, 0, mw, mh);
      m.fillStyle = "#000";
      for (const q of quads) {
        m.beginPath();
        q.forEach(([x, y], i) => (i ? m.lineTo(x * MAP_SCALE, y * MAP_SCALE) : m.moveTo(x * MAP_SCALE, y * MAP_SCALE)));
        m.closePath();
        m.fill();
      }
      const px = m.getImageData(0, 0, mw, mh);
      const a = new Float32Array(mw * mh);
      for (let i = 0; i < a.length; i++) a[i] = px.data[i * 4] / 255;
      const r = Math.max(1, Math.round((spread * MAP_SCALE) / 2));
      blur(a, mw, mh, r);
      blur(a, mw, mh, r);
      // how much light there is within reach, as a soft ramp that is zero deep inside a strip, scaled by the strength
      for (let i = 0; i < a.length; i++) {
        const v = Math.max(0, a[i] - 0.04) / 0.96;
        const o = i * 4;
        px.data[o] = LIGHT[0]; px.data[o + 1] = LIGHT[1]; px.data[o + 2] = LIGHT[2];
        px.data[o + 3] = Math.round(255 * Math.min(1, Math.pow(v, 1.5) * 0.75 * strength));
      }
      m.putImageData(px, 0, 0);

      g.imageSmoothingEnabled = true;
      g.drawImage(map, 0, 0, gw, gh);

      // keep the glow only where there is film
      g.globalCompositeOperation = "destination-in";
      g.fillStyle = "#000";
      g.scale(GLOW_SCALE, GLOW_SCALE);
      g.beginPath();                          // one path for all the strips: "destination-in" keeps only what each fill covers
      for (const q of quads) {
        q.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y)));
        g.closePath();
      }
      g.fill("nonzero");
      g.setTransform(1, 0, 0, 1, 0, 0);
      g.globalCompositeOperation = "source-over";
      return true;
    },
  };
}

/* Draw the light coming through the glowing sprocket holes: for each, a soft bloom on the film around it and a crisp
 * bright hole. holes: {x, y, rx, ry, rot, si, k} in sheet px (si: which strip it is in, kept in order); quads: the
 * strips' outlines. Only film is lit: each strip's bloom is clipped to that strip. The context should already have the
 * sheet-to-canvas transform set; `view` (optional {x0,y0,x1,y1} in sheet px) skips holes out of sight. */
export function paintHoles(ctx, holes, quads, spread, strength, view, exclude = []) {
  // A hole only glows where the light box's surface shows through it. Where a strip lies over another (exclude: those shared
  // patches), there is film behind the hole, not the lit panel, so nothing is drawn there.
  if (exclude.length) {
    ctx.save();
    ctx.beginPath();
    ctx.rect(-1e5, -1e5, 2e5, 2e5);
    for (const q of exclude) { q.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y))); ctx.closePath(); }
    ctx.clip("evenodd");
  }
  const reach = 1 + 0.5 * (1.1 + spread / 30);                // how far the bloom runs past the hole, in hole sizes
  let clipped = -1;
  for (const h of holes) {
    if (view && (h.x + h.rx * reach < view.x0 || h.x - h.rx * reach > view.x1 || h.y + h.ry * reach < view.y0 || h.y - h.ry * reach > view.y1)) continue;
    if (h.si !== clipped) {
      if (clipped >= 0) ctx.restore();
      ctx.save();
      ctx.beginPath();
      quads[h.si].forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
      ctx.closePath();
      ctx.clip();
      clipped = h.si;
    }
    const a = Math.min(1, 0.8 * h.k * strength);
    ctx.save();
    ctx.translate(h.x, h.y);
    ctx.rotate(h.rot);
    ctx.save();
    ctx.scale(h.rx * reach, h.ry * reach);
    const gr = ctx.createRadialGradient(0, 0, 0, 0, 0, 1);
    gr.addColorStop(0, `rgba(${LIGHT},${a * 0.55})`);
    gr.addColorStop(1 / reach, `rgba(${LIGHT},${a * 0.45})`);
    gr.addColorStop(1, `rgba(${LIGHT},0)`);
    ctx.fillStyle = gr;
    ctx.fillRect(-1, -1, 2, 2);
    ctx.restore();
    ctx.fillStyle = `rgba(${LIGHT},${a})`;
    ctx.beginPath();
    if (ctx.roundRect) ctx.roundRect(-h.rx, -h.ry, 2 * h.rx, 2 * h.ry, [h.rx * 0.6, h.ry * 0.5]);
    else ctx.rect(-h.rx, -h.ry, 2 * h.rx, 2 * h.ry);
    ctx.fill();
    ctx.restore();
  }
  if (clipped >= 0) ctx.restore();
  if (exclude.length) ctx.restore();
}
