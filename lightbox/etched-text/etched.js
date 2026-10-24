/* etched-text: lettering set into a surface, as a brass inlay.
 *
 *   import { createEtchedText } from "./etched-text/etched.js";
 *
 *   const sign = createEtchedText({ text: "dude with a pentax" });
 *   await sign.ready;                                   // the font has loaded
 *   const { aspect } = sign.measure();                  // width over height of the lettering's box, to fit it to a space
 *   const r = sign.render(48, devicePixelRatio);        // draw it 48 css px tall: { canvas, width, height, midY }
 *   ctx.drawImage(r.canvas, x, y, r.width, r.height);   // midY: where the middle of the small letters sits in the box, to line it up with something
 *
 * The look is a brass inlay cut into the surface and sitting in its groove, not stuck on top of it: a dark brown groove runs round every letter, a hard dark
 * brown shadow lies against the lower-right of the groove where the surface rises, a dark brown shaded wall runs along the upper-left inside each stroke, a
 * thin pale lip catches the light along the lower-right edge, and the brass itself is a warm gold gradient with a bright diagonal sheen. Light is from the
 * upper left. Every layer is hard edged, so it stays crisp.
 *
 * The font is Yellowtail, a slanted brush script (Apache Licence 2.0, see LICENSE-Yellowtail.txt), subset to basic Latin. Pass `fontUrl` / `fontFamily` for
 * another.
 */

const FONT_URL = new URL("./Yellowtail-latin.woff2", import.meta.url).href;

const BRASS = [[0, "#fff0bd"], [0.3, "#f0cd72"], [0.55, "#d19a38"], [0.8, "#a8721f"], [1, "#865a1a"]];
const BROWN = "#2a1708";           // the dark brown of the groove and the shadow
const LIP = "#fff1cf";             // the catch-light along the lower-right edge

export function createEtchedText({ text = "", fontFamily = "EtchedScript", fontUrl = FONT_URL, weight = "400" } = {}) {
  let ready = Promise.resolve();
  if (typeof FontFace !== "undefined") {
    const face = new FontFace(fontFamily, `url(${fontUrl})`, { weight });
    ready = face.load().then((f) => { document.fonts.add(f); }).catch(() => { /* falls back to the system's script face */ });
  }
  const canvas = document.createElement("canvas");
  const stack = `"${fontFamily}", "Snell Roundhand", "Brush Script MT", cursive`;
  const FS = 0.72;                                                    // the type size as a share of the height asked for

  /* the lettering's real extents at a type size: the ink (not the advance), so it can be centred and fitted exactly */
  function ink(fs) {
    const g = canvas.getContext("2d");
    g.font = `${weight} ${fs}px ${stack}`;
    const m = g.measureText(text);
    const xm = g.measureText("x");
    return { left: m.actualBoundingBoxLeft, right: m.actualBoundingBoxRight, up: m.actualBoundingBoxAscent, down: m.actualBoundingBoxDescent, xh: xm.actualBoundingBoxAscent };
  }
  /* the box's width over its height, whatever the size */
  function measure() {
    const fs = 100, k = ink(fs), pad = fs * 0.12;
    return { aspect: (k.left + k.right + 2 * pad) / (k.up + k.down + 2 * pad) };
  }

  /* draw the lettering so its box is `height` css px tall, at `dpr` device px per css px */
  function render(height, dpr = 1) {
    const S = Math.max(1, dpr);
    const probe = ink(100), unit = (probe.up + probe.down + 24) / 100;     // box height per unit of type size, with a 12% pad each side
    const fs = height / unit;
    const k = ink(fs), pad = fs * 0.12;
    const W = Math.ceil(k.left + k.right + 2 * pad), H = Math.ceil(k.up + k.down + 2 * pad);
    canvas.width = Math.ceil(W * S); canvas.height = Math.ceil(H * S);
    const g = canvas.getContext("2d");
    g.setTransform(S, 0, 0, S, 0, 0);
    g.clearRect(0, 0, W, H);
    g.font = `${weight} ${fs}px ${stack}`;
    g.textBaseline = "alphabetic";
    g.lineJoin = "round";
    const bx = pad + k.left, by = pad + k.up;                         // where the text starts: its left ink edge and its baseline
    const line = Math.max(0.8, fs * 0.022);                           // the thickness of the groove and walls, in css px

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

    // 1. the surface's own shadow against the groove: a hard dark brown band to the lower right, where the cut's far wall stands in shade
    { const [c, x] = layer(); mask(x, line * 1.1, line * 1.3, line * 1.5); tint(c, x, BROWN, 0.55); stamp(c); }
    // 2. the groove: the letters grown a little, in dark brown, all the way round
    { const [c, x] = layer(); mask(x, 0, 0, line * 1.35); tint(c, x, BROWN, 0.95); stamp(c); }
    // 3. the brass inlay: a warm gold gradient down the letters and a bright diagonal sheen across them
    {
      const [c, x] = layer(); mask(x);
      x.save(); x.setTransform(1, 0, 0, 1, 0, 0); x.globalCompositeOperation = "source-in";
      const v = x.createLinearGradient(0, (by - k.up) * S, 0, (by + k.down * 0.2) * S);
      for (const [o, col] of BRASS) v.addColorStop(o, col);
      x.fillStyle = v; x.fillRect(0, 0, c.width, c.height);
      x.globalCompositeOperation = "source-atop";
      const d = x.createLinearGradient(0, 0, c.width, c.height * 0.55);
      d.addColorStop(0, "rgba(255,255,255,0)"); d.addColorStop(0.26, "rgba(255,246,214,0)"); d.addColorStop(0.3, "rgba(255,250,228,0.85)"); d.addColorStop(0.36, "rgba(255,238,190,0)");
      d.addColorStop(0.62, "rgba(255,236,185,0)"); d.addColorStop(0.65, "rgba(255,244,210,0.45)"); d.addColorStop(0.69, "rgba(255,236,185,0)"); d.addColorStop(1, "rgba(255,255,255,0)");
      x.fillStyle = d; x.fillRect(0, 0, c.width, c.height);
      x.restore(); stamp(c);
    }
    // 4. the shaded wall: a dark brown band along the upper-left inside edge of every stroke (the groove's wall in shade)
    {
      const [c, x] = layer(); mask(x);
      x.save(); x.globalCompositeOperation = "destination-out"; x.translate(line * 1.1, line * 1.1); mask(x); x.restore();
      tint(c, x, BROWN, 0.72); stamp(c);
    }
    // 5. the lip: a thin pale line along the lower-right, just inside the edge where the metal catches the light
    {
      const [c, x] = layer(); mask(x, 0, 0);
      x.save(); x.globalCompositeOperation = "destination-out"; x.translate(-line * 0.8, -line * 0.8); mask(x); x.restore();
      tint(c, x, LIP, 0.6); stamp(c);
    }
    return { canvas, width: W, height: H, midY: by - k.xh / 2 };
  }
  return { canvas, ready, render, measure };
}
