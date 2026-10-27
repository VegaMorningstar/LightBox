# toggle-switch

A vintage brass toggle switch lying on its side: an aged-bronze plate with a raised brass rim and embossed OFF and ON, a round bezel with a knurled brass nut and a threaded collar, and a short ball-tipped lever that leans left (off) or right (on). It is set into its surface (a dark gap round it, a lit lip on the lower right, a shaded one on the upper left, a soft shadow to the lower right), light from the upper left. The plate is one SVG, so it stays sharp at any zoom.

```js
import { createToggleSwitch, paintToggle } from "./toggle-switch/toggle.js";

const sw = createToggleSwitch({ label: "Light", on: false, onChange: (on) => ... });
row.append(sw.el);                       // a <button role="switch">; click, tap, Enter or Space flips it
sw.set(true);                            // move it from outside (does not call onChange); sw.on is its state
paintToggle(ctx, { x, y, w: 78, h: 48, on });   // the same switch on a canvas (x, y: its centre), for a magnifier or anything that redraws the surface
```

Self-contained: `toggle.js` and `toggle.css` (it loads its own stylesheet). Size it with `--ts-w` and `--ts-h` (default 78 by 48 px). A switch with `data-covered` takes no presses (so something lying over it gets them). Every `data-*` and `aria-*` it uses is on the button itself.

In LightBox it turns the light on and off (`start-screen/`): see `PHYSICS.md` §9. Wired in at `lightbox.js` (`buildControls` makes it, `mountLightBox` ties it to the start screen, `updateCovered` and `placeSign` know its size), `raster.js` (`paintToggle` in the glasses, `buttonClear` for the dust) and `sw.js`.
