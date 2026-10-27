# nav-bar

A glossy wooden bar that rests on top of a surface and carries its controls: dark rosewood veneer in two book-matched sunbursts whose wedges blend softly into each other, a varnished shine from the upper left, a cream inlay line round it with a fan of leaves in each corner, a thick edge (its right and lower sides show in shade) and a shadow on the surface below it. It is an opaque object over everything on the surface. Give it corner radii that follow the surface's own corners and it lies flush along its top edge.

```js
import { createNavBar, paintNavBar, BAR_H } from "./nav-bar/nav-bar.js";

const bar = createNavBar();
bar.left.append(knob, lightButton);       // controls, centred on the bar's own middle line, from its left end
bar.right.append(settings, revert);       // ...and from its right end
stage.append(bar.el);                     // positioned absolutely inside it (z-index 2: over the film, under an eyepiece at 3)
bar.place({ x, y, w, h: BAR_H, radii: [tl, tr, br, bl] }, dpr);   // where it lies, in px of the stage (the box includes the thick edge), its corner radii; redraws the wood when something changed
paintNavBar(ctx, { x, y, w, h, wood: bar.wood });   // the same bar on a canvas, for a magnifier or anything that redraws the surface
```

Anything else can go on the bar (`bar.el.append(...)`, e.g. inlaid lettering). Controls placed on it are restyled for dark wood by `nav-bar.css` (the knob stands on the wood with its shadow to the lower right, a smaller cream scale via `--sb-marks`; the round buttons are spun brushed brass); the canvas painters in `socket-buttons/` and `press-button/` take `surface: "wood"` for the same look in a magnifier.

Self-contained: `nav-bar.js` and `nav-bar.css` (it loads its own stylesheet). In LightBox: `lightbox.js` (`mountLightBox` makes it and mounts the controls on it, `layout()` places it, `updateBar` hands it to the glasses, `placeSign` puts the sign on it), `raster.js` (draws it last in both glass views), `sw.js`. Rules: `PHYSICS.md` §10.
