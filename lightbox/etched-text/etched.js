/* etched-text: lettering set into a surface, as a brass inlay.
 *
 *   import { createEtchedText } from "./etched-text/etched.js";
 *
 *   const sign = createEtchedText({ text: "dude with a pentax" });
 *   await sign.ready;                                    // the font has loaded and the lettering is drawn
 *   const { canvas, aspect } = sign.render(height, dpr); // a transparent canvas: lay it on the surface
 *   ctx.drawImage(sign.canvas, x, y, width, height);     // or draw it into anything else, e.g. a magnifier's view
 *
 * The look, all from a few hard-edged layers (no soft haze, so it stays crisp): the letters are cut into the surface, a dark brown groove
 * runs round them, a dark brown shadow lies along the upper-left wall of each stroke (the light is from the upper left), a thin pale lip
 * catches the light along the lower-right edge, and the inlay itself is polished brass, a warm gold gradient with a bright diagonal sheen.
 *
 * The font is a bold, slanted, connected brush script (Pacifico, SIL Open Font Licence, see OFL-Pacifico.txt), subset to basic Latin.
 * Pass `fontUrl` / `fontFamily` to use another.
 */

const FONT_URL = new URL("./Pacifico-latin.woff2", import.meta.url).href;

const BRASS = [[0, "#fff0bd"], [0.3, "#f0cd72"], [0.55, "#d19a38"], [0.8, "#a8721f"], [1, "#865a1a"]];
const BROWN = "#2f1b0a";           // the dark brown of the groove and the shadow
const LIP = "#fff1cf";             // the catch-light along the lower-right edge

export function createEtchedText({ text = "", fontFamily = "EtchedScript", fontUrl = FONT_URL, weight = "400" } = {}) {
  let ready = Promise.resolve();
  if (typeof FontFace !== "undefined") {
    const face = new FontFace(fontFamily, `url(${fontUrl})`, { weight });
    ready = face.load().then((f) => { document.fonts.add(f); }).catch(() => { /* falls back to the system's script face */ });
  }
  const canvas = document.createElement("canvas");
  const stack = `"${fontFamily}", "Snell Roundhand", "Brush Script MT", cursive`;

  /* draw the lettering so it is `height` css px tall, at `dpr` device px per css px; returns its width in css px */
  function render(height, dpr = 1) {
    const S = Math.max(1, dpr);
    const fs = height * 0.74;                                         // the type size that fills the height with room for the tails
    const probe = canvas.getContext("2d");
    probe.font = `${weight} ${fs}px ${stack}`;
    const tw = probe.measureText(text).width;
    const padX = fs * 0.16, padY = height * 0.14;
    const W = Math.ceil(tw + 2 * padX), H = Math.ceil(height + 2 * padY);
    canvas.width = Math.ceil(W * S); canvas.height = Math.ceil(H * S);
    const g = canvas.getContext("2d");
    g.setTransform(S, 0, 0, S, 0, 0);
    g.clearRect(0, 0, W, H);
    g.font = `${weight} ${fs}px ${stack}`;
    g.textBaseline = "alphabetic";
    g.lineJoin = "round";
    const bx = padX, by = padY + height * 0.72;                       // the baseline
    const line = Math.max(0.7, height * 0.017);                       // the thickness of the groove and walls, in css px

    // a layer is a copy of the lettering mask, optionally shifted or grown
    const mask = (ctx, dx = 0, dy = 0, grow = 0) => {
      ctx.save();
      ctx.translate(dx, dy);
      ctx.fillStyle = ctx.strokeStyle = "#000";
      ctx.fillText(text, bx, by);
      if (grow > 0) { ctx.lineWidth = grow * 2; ctx.strokeText(text, bx, by); }
      ctx.restore();
    };
    const layer = () => { const c = document.createElement("canvas"); c.width = canvas.width; c.height = canvas.height; const x = c.getContext("2d"); x.setTransform(S, 0, 0, S, 0, 0); x.font = g.font; x.textBaseline = "alphabetic"; x.lineJoin = "round"; return [c, x]; };
    const tint = (c, x, colour, alpha) => { x.save(); x.setTransform(1, 0, 0, 1, 0, 0); x.globalCompositeOperation = "source-in"; x.fillStyle = colour; x.globalAlpha = alpha; x.fillRect(0, 0, c.width, c.height); x.restore(); };
    const stamp = (c) => { g.save(); g.setTransform(1, 0, 0, 1, 0, 0); g.drawImage(c, 0, 0); g.restore(); };

    // 1. the dark brown shadow beyond the groove, a little to the lower right and softly spread (the only soft layer, and a faint one).
    //    The letters are drawn far off to the left and only their shadow is thrown back onto the canvas (shadow offsets ignore the transform).
    {
      const [c, x] = layer();
      const FAR = 4000;
      x.shadowColor = BROWN; x.shadowBlur = line * 1.6 * S; x.shadowOffsetX = (FAR + line * 0.9) * S; x.shadowOffsetY = line * 1.2 * S;
      x.translate(-FAR, 0);
      mask(x, 0, 0, line * 0.9);
      g.save(); g.setTransform(1, 0, 0, 1, 0, 0); g.globalAlpha = 0.55; g.drawImage(c, 0, 0); g.restore();
    }
    // 2. the groove: the letters grown by a line's width, in dark brown
    { const [c, x] = layer(); mask(x, 0, 0, line); tint(c, x, BROWN, 0.92); stamp(c); }
    // 3. the brass inlay: a warm gold gradient down the letters and a bright diagonal sheen across them
    {
      const [c, x] = layer(); mask(x);
      x.save(); x.setTransform(1, 0, 0, 1, 0, 0); x.globalCompositeOperation = "source-in";
      const v = x.createLinearGradient(0, (by - fs * 0.78) * S, 0, (by + fs * 0.08) * S);
      for (const [o, col] of BRASS) v.addColorStop(o, col);
      x.fillStyle = v; x.fillRect(0, 0, c.width, c.height);
      // the sheen: a narrow bright band on the diagonal, hard edged (polished metal), and a fainter second one
      x.globalCompositeOperation = "source-atop";
      const d = x.createLinearGradient(0, 0, c.width, c.height * 0.55);
      d.addColorStop(0, "rgba(255,255,255,0)"); d.addColorStop(0.26, "rgba(255,246,214,0)"); d.addColorStop(0.3, "rgba(255,250,228,0.85)"); d.addColorStop(0.36, "rgba(255,238,190,0)");
      d.addColorStop(0.62, "rgba(255,236,185,0)"); d.addColorStop(0.65, "rgba(255,244,210,0.45)"); d.addColorStop(0.69, "rgba(255,236,185,0)"); d.addColorStop(1, "rgba(255,255,255,0)");
      x.fillStyle = d; x.fillRect(0, 0, c.width, c.height);
      x.restore(); stamp(c);
    }
    // 4. the shaded wall: a dark brown band along the upper-left edge of every stroke, inside the brass (the groove's wall in shade)
    {
      const [c, x] = layer(); mask(x);
      x.save(); x.globalCompositeOperation = "destination-out"; x.translate(line * 0.9, line * 0.9); mask(x); x.restore();   // what is left is the band
      tint(c, x, BROWN, 0.7); stamp(c);
    }
    // 5. the lip: a thin pale line along the lower-right, just inside the edge where the metal catches the light
    {
      const [c, x] = layer(); mask(x, 0, 0);
      x.save(); x.globalCompositeOperation = "destination-out"; x.translate(-line * 0.7, -line * 0.7); mask(x); x.restore();
      tint(c, x, LIP, 0.55); stamp(c);
    }
    return { canvas, width: W, height: H };
  }
  return { canvas, ready, render };
}
