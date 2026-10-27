# nav-bar

A glossy wooden bar that rests on top of a surface and carries its controls: dark rosewood veneer in two book-matched sunbursts whose wedges blend softly into each other, a varnished shine from the upper left, and a cream inlay line round it with a fan of leaves in each corner. It is an opaque object over everything on the surface and casts a soft shadow to the lower right.

```js
import { createNavBar, paintNavBar, BAR_H } from "./nav-bar/nav-bar.js";

const bar = createNavBar();
bar.left.append(knob, lightButton);       // controls, centred on the bar's own middle line, from its left end
bar.right.append(settings, revert);       // ...and from its right end
stage.append(bar.el);                     // positioned absolutely inside it (z-index 2: over the film, under an eyepiece at 3)
bar.place({ x, y, w, h: BAR_H }, dpr);    // where it lies, in px of the stage; redraws the wood when the size or density changed
paintNavBar(ctx, { x, y, w, h, wood: bar.wood });   // the same bar on a canvas, for a magnifier or anything that redraws the surface
```

Anything else can go on the bar (`bar.el.append(...)`, e.g. inlaid lettering). Controls placed on it are restyled for dark wood by `nav-bar.css` (dark socket gap, a faint warm lip, cream marks via `--sb-marks`); the canvas painters in `socket-buttons/` and `press-button/` take `surface: "wood"` for the same look in a magnifier.

Self-contained: `nav-bar.js` and `nav-bar.css` (it loads its own stylesheet). In LightBox: `lightbox.js` (`mountLightBox` makes it and mounts the controls on it, `layout()` places it, `updateBar` hands it to the glasses, `placeSign` puts the sign on it), `raster.js` (draws it last in both glass views), `sw.js`. Rules: `PHYSICS.md` §10.
