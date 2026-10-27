# press-button

A latching push button on a weathered plate: a patinated teal-green metal plate with rust showing through, four corner screw holes, two eyelets and two holes, and in the middle a brass-rimmed round recess holding a glossy, polished cream knob with a fluted edge. Press it and the knob goes **in** and stays in (on); press again and it springs **out** (off). Light is from the upper left: the knob out casts a shadow to the lower right; pushed in it is lower, dimmer and the shadow is gone. The plate is set into its surface (a dark gap round it, a lit lip on the lower right, a shaded one on the upper left, a soft shadow to the lower right). It is one SVG, so it stays sharp at any zoom.

```js
import { createPressButton, paintPressButton } from "./press-button/press-button.js";

const pb = createPressButton({ label: "Light", on: false, onChange: (on) => ... });
row.append(pb.el);                       // a <button role="switch">; click, tap, Enter or Space presses it
pb.set(true);                            // move it from outside (does not call onChange); pb.on is its state
paintPressButton(ctx, { x, y, w: 95.9, h: 43.4, on });   // the same button on a canvas (x, y: its centre), for a magnifier or anything that redraws the surface
```

Self-contained: `press-button.js` and `press-button.css` (it loads its own stylesheet). Size it with `--pb-w` and `--pb-h` (default 95.9 by 43.4 px, which makes the brass-rimmed round button 38 px across: the same as the revert button and the other round buttons; keep the ratio 168 to 76). A button with `data-covered` takes no presses (so something lying over it gets them). It is drawn lying on its side; its rectangle is the one the page reads for covering and dust.

In LightBox it turns the light on and off (`start-screen/`): see `PHYSICS.md` §9. Wired in at `lightbox.js` (`buildControls` makes it, `mountLightBox` ties it to the start screen, `updateCovered` and `placeSign` know its size), `raster.js` (`paintPressButton` in the glasses, `buttonClear` for the dust) and `sw.js`.
