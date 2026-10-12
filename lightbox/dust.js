/* Dust lying on the light box.
 *
 * A scattering of minute specks, a few little clusters and some short fibres. They block a little light, so
 * they are drawn as dark, translucent marks that multiply onto whatever is beneath: they show on the bare board
 * and through clear film, and vanish on the dark film base, as real dust would.
 *
 * Everything is in sheet pixels, the same space as the film, so the page and both glasses can draw it:
 *   specks.draw(ctx, view)   draws it at the context's current transform (it magnifies in the lens, staying crisp);
 *                            with a `view` ({x0, y0, x1, y1}) it skips the specks that are outside it
 */

const DUST_INK = "36,27,17";

function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function createSpecks(W, H, { seed = 7 } = {}) {
  const rand = rng(seed);
  const dust = [];
  const count = Math.round(Math.min(240, Math.max(70, (W * H) / 8000)));
  for (let i = 0; i < count; i++) {
    const x = rand() * W, y = rand() * H;
    if (rand() < 0.12) {                                       // a short fibre
      const len = 3 + rand() * 8, a = rand() * Math.PI * 2, bend = (rand() - 0.5) * 0.9;
      dust.push({ fibre: true, x, y, len, a, bend, w: 0.5 + rand() * 0.4, alpha: 0.35 + rand() * 0.35 });
      continue;
    }
    const n = rand() < 0.18 ? 2 + Math.floor(rand() * 3) : 1;  // now and then a little cluster
    for (let k = 0; k < n; k++) {
      dust.push({
        x: x + (rand() - 0.5) * 9, y: y + (rand() - 0.5) * 9,
        r: 0.3 + Math.pow(rand(), 3) * 1.3,                    // mostly minute, a few bigger
        alpha: 0.22 + rand() * 0.5,
      });
    }
  }

  return {
    dust,
    draw(ctx, view) {
      ctx.save();
      ctx.globalCompositeOperation = "multiply";
      ctx.lineCap = "round";
      for (const d of dust) {
        if (view && (d.x < view.x0 - 14 || d.x > view.x1 + 14 || d.y < view.y0 - 14 || d.y > view.y1 + 14)) continue;   // not in this window
        if (d.fibre) {
          ctx.strokeStyle = `rgba(${DUST_INK},${d.alpha})`;
          ctx.lineWidth = d.w;
          const ex = Math.cos(d.a) * d.len, ey = Math.sin(d.a) * d.len;
          ctx.beginPath();
          ctx.moveTo(d.x, d.y);
          ctx.quadraticCurveTo(d.x + ex / 2 - ey * d.bend, d.y + ey / 2 + ex * d.bend, d.x + ex, d.y + ey);
          ctx.stroke();
        } else {
          ctx.fillStyle = `rgba(${DUST_INK},${d.alpha})`;
          ctx.beginPath();
          ctx.arc(d.x, d.y, d.r, 0, Math.PI * 2);
          ctx.fill();
        }
      }
      ctx.restore();
    },
  };
}
