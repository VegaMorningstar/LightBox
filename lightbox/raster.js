/* Draws the contact sheet onto 2D canvases for the glass shaders.
 *
 *   readScene(stage, root)      reads the laid-out DOM sheet into a plain description
 *   rasterizeNegative(scene)    the whole sheet as negatives (the outer glass refracts this)
 *   createLensView(scene, dpr)  a small window onto the lit positive sheet, redrawn at the
 *                               eyepiece's own magnification and resolution (the inner glass)
 *
 * Geometry is read back from the DOM, so it stays in step with lightbox.css.
 */

const ORANGE = [217 / 255, 132 / 255, 58 / 255]; // film-mask cast, matches .lb-neg .lb-img::after
const ORANGE_MIX = 0.55;

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);

/* Same chain as the CSS: invert, contrast .82, brightness .82, saturate .8, orange multiply. */
function toNegative(data) {
  for (let i = 0; i < data.length; i += 4) {
    let r = 1 - data[i] / 255, g = 1 - data[i + 1] / 255, b = 1 - data[i + 2] / 255;
    r = clamp01((r - 0.5) * 0.82 + 0.5); g = clamp01((g - 0.5) * 0.82 + 0.5); b = clamp01((b - 0.5) * 0.82 + 0.5);
    r = clamp01(r * 0.82); g = clamp01(g * 0.82); b = clamp01(b * 0.82);
    const l = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    r = clamp01(l + 0.8 * (r - l)); g = clamp01(l + 0.8 * (g - l)); b = clamp01(l + 0.8 * (b - l));
    data[i] = 255 * r * (1 - ORANGE_MIX * (1 - ORANGE[0]));
    data[i + 1] = 255 * g * (1 - ORANGE_MIX * (1 - ORANGE[1]));
    data[i + 2] = 255 * b * (1 - ORANGE_MIX * (1 - ORANGE[2]));
  }
}

/* rounded rect with elliptical corners (the sprocket holes are stretched, like the CSS mask) */
function ellipticRect(ctx, x, y, w, h, rx, ry) {
  ctx.moveTo(x + rx, y);
  ctx.lineTo(x + w - rx, y);
  ctx.ellipse(x + w - rx, y + ry, rx, ry, 0, -Math.PI / 2, 0);
  ctx.lineTo(x + w, y + h - ry);
  ctx.ellipse(x + w - rx, y + h - ry, rx, ry, 0, 0, Math.PI / 2);
  ctx.lineTo(x + rx, y + h);
  ctx.ellipse(x + rx, y + h - ry, rx, ry, 0, Math.PI / 2, Math.PI);
  ctx.lineTo(x, y + ry);
  ctx.ellipse(x + rx, y + ry, rx, ry, 0, Math.PI, Math.PI * 1.5);
  ctx.closePath();
}

/* object-fit: cover source rectangle */
function coverCrop(img, w, h) {
  const k = Math.max(w / img.naturalWidth, h / img.naturalHeight);
  const sw = w / k, sh = h / k;
  return [(img.naturalWidth - sw) / 2, (img.naturalHeight - sh) / 2, sw, sh];
}

/* a frame's photo as a negative, sized for the given raster scale */
function negativePhoto(img, w, h, rs) {
  const pw = Math.max(1, Math.round(w * rs)), ph = Math.max(1, Math.round(h * rs));
  const tmp = document.createElement("canvas");
  tmp.width = pw; tmp.height = ph;
  const t = tmp.getContext("2d", { willReadFrequently: true });
  t.drawImage(img, ...coverCrop(img, pw, ph), 0, 0, pw, ph);
  try {
    const d = t.getImageData(0, 0, pw, ph);
    toNegative(d.data);
    t.putImageData(d, 0, 0);
  } catch {
    // cross-origin photos can't be read back; fall back to the canvas filter where it exists
    t.globalCompositeOperation = "copy";
    t.filter = "invert(1) contrast(.82) brightness(.82) saturate(.8)";
    t.drawImage(tmp, 0, 0);
  }
  return tmp;
}

export async function readScene(stage, root) {
  const sheet = stage.querySelector(".lb-neg");
  await Promise.all([...sheet.querySelectorAll("img")].map((i) => i.decode().catch(() => {})));

  const cs = getComputedStyle(root);
  const css = (name, fallback) => cs.getPropertyValue(name).trim() || fallback;
  const strips = [...sheet.querySelectorAll(".lb-strip")].map((strip) => {
    const frames = [...strip.querySelectorAll(".lb-frame")];
    const fw = frames[0].offsetWidth, fh = frames[0].offsetHeight;
    const g = fw * 0.06;
    return {
      left: strip.offsetLeft, top: strip.offsetTop, w: strip.offsetWidth, h: strip.offsetHeight,
      rot: ((parseFloat(strip.style.getPropertyValue("--rot")) || 0) * Math.PI) / 180,
      fw, fh, b: fw * 0.21, g, hp: (fh + g) / 4, pt: g * 2,
      frames: frames.map((f) => ({
        x: f.offsetLeft, y: f.offsetTop,
        img: f.querySelector("img"),
        tagL: f.querySelector(".lb-tag.l")?.textContent ?? "",
        tagR: f.querySelector(".lb-tag.r")?.textContent ?? "",
      })),
    };
  });
  return {
    W: stage.clientWidth, H: stage.offsetHeight, strips,
    bg: css("--lb-bg", "#ddd0b6"), lit: css("--lb-lit", "#fff7e2"),
    film: css("--lb-film", "#1b1917"), ink: css("--lb-edge-ink", "#d89a4c"),
  };
}

/* mode "neg": processed negatives, cached per frame at scale rs. mode "pos": the photos as they are.
 * view: optional {x0, y0, x1, y1} in sheet px; strips and frames outside it are skipped. */
function drawScene(ctx, scene, { mode, rs = 1, view }) {
  const pad = 16;
  for (const s of scene.strips) {
    if (view && (s.left + s.w + pad < view.x0 || s.left - pad > view.x1 || s.top + s.h + pad < view.y0 || s.top - pad > view.y1)) continue;

    ctx.save();
    ctx.translate(s.left + s.w / 2, s.top);   // transform-origin: 50% 0
    ctx.rotate(s.rot);
    ctx.translate(-s.w / 2, 0);

    // film base with see-through sprocket holes
    ctx.beginPath();
    ctx.rect(0, 0, s.w, s.h);
    for (let y = s.pt - Math.ceil(s.pt / s.hp) * s.hp; y < s.h; y += s.hp) {
      ellipticRect(ctx, 0.14 * s.b, y + 0.26 * s.hp, 0.46 * s.b, 0.48 * s.hp, 0.14 * s.b, 0.12 * s.hp);
      ellipticRect(ctx, s.w - s.b + 0.4 * s.b, y + 0.26 * s.hp, 0.46 * s.b, 0.48 * s.hp, 0.14 * s.b, 0.12 * s.hp);
    }
    ctx.fillStyle = scene.film;
    ctx.fill("evenodd");

    for (const f of s.frames) {
      if (view && (s.top + f.y + s.fh + pad < view.y0 || s.top + f.y - pad > view.y1)) continue;
      if (f.img.naturalWidth) {
        if (mode === "neg") {
          f.neg ??= negativePhoto(f.img, s.fw, s.fh, rs);
          ctx.drawImage(f.neg, f.x, f.y, s.fw, s.fh);
        } else {
          ctx.drawImage(f.img, ...coverCrop(f.img, s.fw, s.fh), f.x, f.y, s.fw, s.fh);
        }
      }

      // edge printing
      const size = s.fw * 0.045;
      ctx.font = `600 ${size}px ui-monospace, "SF Mono", Menlo, monospace`;
      if ("letterSpacing" in ctx) ctx.letterSpacing = `${size * 0.12}px`;
      ctx.fillStyle = scene.ink;
      ctx.globalAlpha = 0.85;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.save();
      ctx.translate(f.x - s.fw * 0.065, f.y + s.fh / 2);
      ctx.rotate(-Math.PI / 2);
      ctx.fillText(f.tagL, 0, 0);
      ctx.restore();
      ctx.save();
      ctx.translate(f.x + s.fw + s.fw * 0.065, f.y + s.fh / 2);
      ctx.rotate(Math.PI / 2);
      ctx.fillText(f.tagR, 0, 0);
      ctx.restore();
      ctx.globalAlpha = 1;
    }
    ctx.restore();
  }
}

/* the whole sheet as negatives, for the outer glass to refract */
export function rasterizeNegative(scene) {
  const { W, H } = scene;
  const rs = Math.min(2, window.devicePixelRatio || 1, 8192 / Math.max(W, H));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(W * rs);
  canvas.height = Math.round(H * rs);
  const ctx = canvas.getContext("2d");
  ctx.scale(rs, rs);
  ctx.fillStyle = scene.bg;
  ctx.fillRect(0, 0, W, H);
  drawScene(ctx, scene, { mode: "neg", rs });
  return { canvas, width: W, height: H };
}

/* A square window onto the lit positive sheet, centred on the eyepiece and drawn at its own
 * magnification. It is (G + 2*pad) css px across so the glass shader can bend the rim outward
 * without running off the edge. Call render() whenever the eyepiece moves or the zoom changes. */
export function createLensView(scene, dpr) {
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d");
  ctx.imageSmoothingQuality = "high";
  let size = 0;
  return {
    canvas,
    resize(cssSize) {
      size = cssSize;
      canvas.width = canvas.height = Math.max(1, Math.round(cssSize * dpr));
    },
    render(cx, cy, zoom) {
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.fillStyle = scene.lit;               // light shining up through the gaps and holes
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      const k = dpr * zoom;
      ctx.setTransform(k, 0, 0, k, (canvas.width - k * 2 * cx) / 2, (canvas.height - k * 2 * cy) / 2);
      const half = size / 2 / zoom;
      drawScene(ctx, scene, { mode: "pos", view: { x0: cx - half, y0: cy - half, x1: cx + half, y1: cy + half } });
    },
  };
}
