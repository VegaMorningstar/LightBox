# film-bend

Everything about film **bending**: a strip that is pushed lengthwise toward the eyepiece resting on it cannot slide, so it buckles into one smooth arch that lifts off the
board, casts a shadow, catches the light, pushes the eyepiece back, and makes a soft "womp". The rules are in `PHYSICS.md` (§4.9); this file is the map of the code.

Other parts of the page know about the bend only through the door, `index.js`. No file outside this folder imports any other file in it.

## Inside the folder

| file | what it is | who uses it |
|---|---|---|
| `shape.js` | the numbers (`BK`, `PERSP`, `EDGE_*`) and the pure maths of one bend: `profile` (height, slope, draw-in at a point along the strip), `placeBend`, `seedBend`, `archHeight`, `lighting`, `overRim`. No DOM, no state. | `physics.js`, `draw.js`, the explainer page `how-film-bends.html` |
| `physics.js` | `createBendPhysics`: when film buckles, how much slack is stored, how tall the arch grows, the push it gives the eyepiece, the "wop" events and crunch level for the sound, which strips must be drawn from canvases (`markDrawn`), and `holdBack` (a held strip cannot push the eyepiece it is buckling against). The **only writer** of `s.bk`, `s.bent`, `s.drawn` and each cell's `z`, `by`, `k`, `shade`. | `film.js` |
| `draw.js` | painting: `drawBentStrip` (the strip cut into 0.5 px slices, each placed and lit), `paintBendShadows`, `bentBounds`, `liftedPatches` (where film is off the board, so no edge light), `holeFade` (sprocket holes glow less as film lifts). Gets `drawStrip`, `polyPath`, `stripQuad` from the renderer through `bindHost`; imports nothing from it. | `raster.js`, `layers.js`, `lightbox.js` |
| `layers.js` | `createBendLayers`: the five canvases per bent strip set into the film's stack on the page (shadow, film, see-through part, multiplied part, light and shade). | `lightbox.js` |
| `sound.js` | `createWop`: the "womp" sound for one peak. Borrows the audio parts (`ctx`, `noise`, `jitter`, `envelope`, `noiseBurst`, `tone`) from `sounds.js`. | `sounds.js` |
| `film-bend.css` | `.lb-bend`: the bent strips' canvases. | `index.html`, `sw.js` |
| `index.js` | the door: re-exports the above. | everything outside |

## Outside the folder: every place that touches the bend

These are the only seams. Each one is a call into the door or a read of the data the bend writes (listed at the bottom).

| where | what it does for the bend |
|---|---|
| `film.js` `createFilm` | builds `bend = createBendPhysics({ scene, cfg, host })` and hands over what only it knows: who is held, a strip's top, `rotate`, `coverage` (how much of a strip lies under the eyepiece) |
| `film.js` `step` | `bend.update(dtMs, eye)` once a frame, after the strips have moved |
| `film.js` `step` and the idle check | `bend.isMoving(s)`: a strip holding slack or still bent keeps the physics awake |
| `film.js` `applyDom` | `bend.markDrawn()`; hides the page's own strip while it is drawn from canvases, shows it again afterwards |
| `film.js` the eyepiece's grip on film (`dragOnEye`) | `bend.holdBack`: a held strip pushed toward the eyepiece cannot push it |
| `film.js` public API | `eyePush`, `takeBendEvents()`, `bendCrunch`: read straight from `bend` |
| `film.js` `cfg` | `cfg.bend` (arch height), `cfg.bendPush` (how hard slack pushes the eyepiece), `cfg.edge` (the rim curl, currently switched off) |
| `raster.js` `holeSpots` | `holeFade(s, ly)` |
| `raster.js` `drawScene` | `paintBendShadows` and `drawBentStrip` for a strip with `s.drawn`, so the two glasses show the bend |
| `raster.js` end of file | `bindHost({ drawStrip, polyPath, stripQuad })` |
| `lightbox.js` `mountLightBox` | `bendLayers = createBendLayers()`; `bendLayers.paint(scene, dpr)` each frame the page is repainted; `bendLayers.clear()` when the layout is rebuilt |
| `lightbox.js` `paintSeep` | `liftedPatches(s)`: lifted film gets no edge light |
| `lightbox.js` the eyepiece's frame (`tick`) | adds `film.eyePush` to the eyepiece's velocity; `sounds.crackle(... film.bendCrunch * 0.15)`; `sounds.wop(e.k, e.kind)` for each queued event |
| `lightbox.js` `filmCfg` and the sliders | "Film bend height" (`bend`), "Bent film pushes eyepiece" (`bendPush`) in the Film group, "Film bend womp" (`vol_wave`) in Sound · sliding; and the `how` button that opens `how-film-bends.html` |
| `sounds.js` | `createWop(...)` wired to its audio parts; `wop(k, kind)`; the `wave` volume node |
| `lightbox/lightbox.css` | none (the bend's CSS is `film-bend.css`) |
| `how-film-bends.html` | imports the numbers and the shape from `film-bend/shape.js` to draw the diagrams |
| `index.html`, `sw.js` | link the CSS; list the files for offline use |

## The data the bend writes (read by other code)

- `s.bk` on each strip: `d` (slack, px), `a` (arch height, px), `sign`, `hand`, `pin`, `L`, `cover`, `can`, `hp`, plus the strip's own character from `seedBend` (`g`, `amp`, `rip`, `ph`, `at`, `wl`, `t0`, `t1`). Read by `draw.js` and by `physics.js`; nothing else.
- `s.bent` (this strip is lifted) and `s.drawn` (this strip is painted from canvases, also true for overlapping strips while any strip is bent). Read by `film.js` (`applyDom`), `raster.js` (`drawScene`), `layers.js`, `lightbox.js` (`paintSeep`).
- each cell's `z`, `by`, `k`, `shade`: its lifted height, draw-in, scale and darkening. Read by the flat page drawing in `film.js` (`applyDom`) and `raster.js`.
- `scene.bendEdge`: the rim-curl setting, read by `draw.js`.

## Not part of the bend

`film.js` keeps its own flutter (an S-curve of neighbouring frames when a strip is dragged sideways); its constant used to be called `BEND` and is now `DRAG_TILT` so the two are not mixed up. `dust.js` has a `bend` for the curve of a fibre. `glass.js` talks about light "bending" (refraction).
