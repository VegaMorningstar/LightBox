/* The bent strips on the page. A strip that is bent (or hangs over the rim) is hidden as a page element and drawn instead into canvases that
 * sit in the film's stack right after it, so it keeps its place: over the strips below it, under the strips above it. Five canvases per bent
 * strip: its shadow on what lies below, the film itself, the part that is seen through by density, the part that is multiplied onto the film
 * below, and the light and shade over all of it (draw.js paints them).
 *
 *   const layers = createBendLayers();
 *   layers.paint(scene, dpr);       // each frame the page is repainted: makes, moves, redraws and removes the canvases
 *   layers.clear();                 // forget them all (the layout was rebuilt, so the old canvases went with it)
 *
 * The canvases carry the class `lb-bend` (film-bend.css).
 */

import { bentBounds, drawBentStrip, paintBendShadows } from "./draw.js";

export function createBendLayers() {
  const bentLayers = new Map();                        // for each bent strip: its shadow and its slices, each a canvas set into the stack at the strip's own place

  function paint(sc, dpr) {
    for (const s of sc.strips) {
      let L = bentLayers.get(s);
      if (!s.drawn) {
        if (L) { for (const cv of Object.values(L)) cv.remove(); bentLayers.delete(s); }
        continue;
      }
      // Each bent strip is drawn into canvases that sit in the film's stack right after the strip's own (hidden) element and carry its
      // stacking, so it keeps its place: over the strips below it, under the strips above it.
      if (!L) {
        L = { shadow: document.createElement("canvas"), film: document.createElement("canvas"), alpha: document.createElement("canvas"), mult: document.createElement("canvas"), shade: document.createElement("canvas") };
        for (const cv of Object.values(L)) cv.className = "lb-bend";
        s.el.after(L.shadow, L.film, L.alpha, L.mult, L.shade);
        bentLayers.set(s, L);
      }
      const bb = bentBounds(s);
      const z = s.z ? String(s.z) : "";
      for (const cv of Object.values(L)) {
        const w = Math.round(bb.w * dpr), h = Math.round(bb.h * dpr);
        if (cv.width !== w || cv.height !== h) { cv.width = w; cv.height = h; }
        Object.assign(cv.style, { left: `${bb.x}px`, top: `${bb.y}px`, width: `${bb.w}px`, height: `${bb.h}px`, zIndex: z });
        const c = cv.getContext("2d");
        c.setTransform(1, 0, 0, 1, 0, 0);
        c.clearRect(0, 0, cv.width, cv.height);
        c.setTransform(dpr, 0, 0, dpr, -bb.x * dpr, -bb.y * dpr);
      }
      // where this strip lies over another, the page blends it as it blends a flat one: faded by density, and/or multiplied onto the film below
      L.alpha.style.opacity = String(1 - sc.stack);
      L.mult.style.opacity = String(sc.stack);
      L.mult.style.mixBlendMode = "multiply";
      const sh = L.shadow.getContext("2d");
      paintBendShadows(sh, [s], bb.w, bb.h, bb.x, bb.y);
      drawBentStrip(null, sc, s, "neg", dpr, { opaque: L.film.getContext("2d"), alpha: L.alpha.getContext("2d"), mult: L.mult.getContext("2d"), shade: L.shade.getContext("2d") });
    }
  }

  return { paint, clear: () => bentLayers.clear() };
}
