# toggle-switch

A brass toggle switch: a brushed brass plate with two slot screws, a black slot and a knurled lever that stands up when it is on and points down when it is off. Light is from the upper left, so the plate's bevel is lit on that side and its shadow and the lever's fall to the lower right.

```js
import { createToggleSwitch, paintToggle } from "./toggle-switch/toggle.js";

const sw = createToggleSwitch({ label: "Light", on: false, onChange: (on) => ... });
row.append(sw.el);                       // a <button role="switch">; click, tap, Enter or Space flips it
sw.set(true);                            // move it from outside (does not call onChange); sw.on is its state
paintToggle(ctx, { x, y, w: 30, h: 58, on });   // the same switch on a canvas (x, y: its centre), for a magnifier or anything that redraws the surface
```

Self-contained: `toggle.js` and `toggle.css` (it loads its own stylesheet). Size it with `--ts-w` and `--ts-h` (default 30 by 58 px). A switch with `data-covered` takes no presses (so something lying over it gets them). Every `data-*` and `aria-*` it uses is on the button itself.

In LightBox it turns the light on and off (`start-screen/`): see `PHYSICS.md` §9. Wired in at `lightbox.js` (`buildControls` makes it, `mountLightBox` ties it to the start screen, `updateCovered` and `placeSign` know its size), `raster.js` (`paintToggle` in the glasses, `buttonClear` for the dust) and `sw.js`.
