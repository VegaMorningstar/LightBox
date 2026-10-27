# LightBox physics

The rules the page follows: how light, glass, film and the other things on screen behave with each other. Every new rule is
added here **and** documented in the code next to where it is implemented (the file named in each rule). Numbers quoted are the
current defaults; the sliders (localhost only, or `?sliders`) change many of them.

Light comes from the **upper left** everywhere: highlights sit on the upper left of every raised or curved thing, shade and cast
shadows fall to the lower right.

---

## 1. Layers, from the bottom up

1. **The light box surface** (`lightbox.css` `.lb-stage`, `.lb-edge`; `raster.js` `bakeEdge`): the dark room, the rim, the lit panel.
2. **Things set into the surface**: the push buttons (`socket-buttons/`).
3. **Film strips** (`.lb-film`; `film.js`).
4. **Light that comes up through the film's holes and over its edges** (`bleed.js`), then the panel's falloff, glow, grain and dust
   (`raster.js`, `dust.js`).
5. **The eyepiece**: outer glass (PA), black ring (PB), inner glass (PC) (`glass.js`, `dial.js`, `lightbox.js`).

The rule: *the surface is the bottom layer; everything else lies on it and reacts to it.* The film and the glass are not drawn into
the surface, they sit on top of it. The glasses redraw the layers below them themselves (they refract / magnify what is under
them), so every layer above must also be drawn in `raster.js` `createWindowView`, in this order: dark room → sheet board colour →
the rim picture → buttons → film → dust → light seep and lit holes → panel falloff and glow → grain (PA only).

## 2. The light box surface

- **A lit panel in a dark room** with rounded corners. From the dark outside inward: dark room; a faint warm glow just outside the
  edge; the edge, softened (a matte surface has no sharp line); a narrow highlight where the edge bends, with a glow so the light
  seems to be inside the box; a dark gradient; then the lit surface. (`bakeEdge`, `raster.js`)
- **The rim highlight is brightest toward the light** (upper left) and fainter on the opposite side.
- **The film starts only where the panel is at full brightness**: the dark margin and the fall of light are kept clear of film
  (`edgeM`, `edgeF` in `lightbox.js`, `--edge-m`, `--edge-f` in the stylesheet; they must match).
- **The panel's own effects stay on the panel.** Falloff and glow are clipped to the rounded panel, so they never show on the dark
  room (`lightbox.css` `.lb-glow`, `raster.js`).
- **Beyond the sheet is the dark room**, in the glass views too, so an eyepiece at an edge never refracts bare board
  (`createWindowView`).
- **The surface is matte**: it carries a fine grain. The grain is part of the panel, so it is *not* drawn inside the magnifier (PC)
  (see §6).
- **Panel light** (`raster.js` `PANEL_LAYERS`, `PANEL_GLOW`): the light falls off toward the edges and corners (multiply, so black
  stays black); brighter patches and a faint warm/cool drift raise light in proportion (colour-dodge, so black stays black); the
  whole panel is lifted by a broad glow. The board is a light beige (`#eadec6`); the light through the gaps is `#fcf2dc`.
- **Dust** lies on the board and the film borders, not on the photographs (`dust.js`, `lightbox.js` `paintDust`). It stays put
  while film slides over it.

## 3. Film

### 3.1 What film is
- **A strip is a stack of cells**, one per frame, each with its own film base and four see-through sprocket holes per frame. Each
  cell can shift and lean a hair against its neighbours (`film.js`).
- **Film is translucent by density.** Dark (dense) areas of the negative pass little light, clear areas pass the most; the sprocket
  borders are almost opaque. This shows only where film lies over film; against bare board the film is opaque
  (`raster.js` `FILM_DENSE`, `FILM_CLEAR`, `filmAlpha`).
- **Film over film multiplies the light** (two negatives stacked go darker, like double exposure). Through the eyepiece the upper
  strip is shown see-through by brightness, so the brightest parts of the lower film show in the darkest parts of the upper
  (multiplying two positives would just black out).
- **A film strip is never on top of the eyepiece.**

### 3.2 Light on and through the film (`bleed.js`)
- **Light seeps from open board onto the film's edge**: the border of a strip next to open board glows softly, fading toward the
  middle of the strip. Distance: 10 px by default (the *Seep distance* slider). Computed from a blurred map of board versus film.
- **Some sprocket holes glow, some do not** (a light box is uneven): about half of the sets of holes (the holes beside one frame
  on one side) glow, each by a different amount; fixed by a hash of strip / frame / side so it never flickers
  (`raster.js` `holeSpots`). A lit hole has a crisp bright hole and a bloom on the film base around it.
- **A hole only glows where the panel shows through it.** Where a strip lies over another strip there is film behind the hole, so
  no glow there; it returns as soon as the hole slides over bare board (`bleed.js` `paintHoles`, exclude patches).
- **Lit holes are drawn crisp** at whatever scale the picture is drawn (page, glass, magnifier), never from the low-resolution
  seep canvas.
- A cell's film base is clipped to the cell, so a hole at a cell's end never fills in outside it (`raster.js` `drawCell`).

### 3.3 Moving film: the eyepiece rubs it (`film.js` `stepRubbed`)
- **Below speed 0.8 px/ms the eyepiece glides over film without touching it**; the pull fades in up to 1.9 px/ms.
- **It drags the strip at the point it is over, as a hand would**, shared between a slide and a turn exactly as a grab is: over the
  top of a strip the top swings and the bottom barely moves; over the middle the whole strip slides; over the bottom the bottom
  swings. (Turn resistance for a rub, `SPIN_RUB`, is lower than for a firm grab, `SPIN`.)
- **Board friction** (`BOARD`) holds a strip; it can only be nudged a little from where it rests (`MAX_X`, `MAX_Y`,
  `NUDGE_END`, `NUDGE_TURN`); it never slides over a neighbour it has not been grabbed past.
- **The pieces lean against their neighbours** in a damped spring chain (heavily damped, no ringing), bending the strip into a
  soft S that settles.
- **A lifted eyepiece is off the film**: no push, no bend, no sliding or crackling sound. This fades back in as it touches down
  (`lightbox.js` `touch = 1 − smooth(lift)`).

### 3.4 Moving film: you grab it
- **Each strip is a rigid body on a board with friction.** A pull at one point is split between sliding and turning by how far the
  grab is from the strip's middle (`film.js` `pull`; `SPIN`, `MAX_TURN` ≈ 29°). There are three zones: top, middle, bottom.
- **Untouched strips never overlap** (`KEEP_APART` 2 px of clear board always left): a sprocket hole would show a neighbour's dark
  film instead of the lit board. A strip you have grabbed is yours to place over or under others until *Organize*.
- **Let go and it glides** (`GLIDE_MS`), then stops. The strip picked up last sits on top.
- **A strip moved over another drags it by friction** where they overlap, at the middle of the shared patch, sliding / turning the
  lower strip by the same rule as a grab (`stripDrives`, `RUB_STRIP`; the *Strip-on-strip drag* slider, default 0.5). A held
  strip that has stopped does not rub.
- **Organize** eases everything back to the starting layout (`TIDY_MS`).
- **Pressing where film covers a button grabs the film**, not the button (§5).

## 4. The eyepiece

### 4.1 Parts
- **PA**, the outer glass: a clear solid glass **frustum** (cone widest at its base), like a real film loupe.
- **PB**, the black ring: knurled, engraved scale and painted markings, a red arrow etched on the glass.
- **PC**, the inner glass: the magnifier. The centre is **fully clear** and never distorts; only a narrow band at the rim bends
  and splits colour.

### 4.2 PA, the frustum (`glass.js`)
- Each pixel is a ray looking straight down. It bends by **Snell's law** where it enters the sloped wall (default slope 60°,
  index 1.49 = acrylic), crosses the glass in the cone's cross-section, and either leaves through the base, leaves through a wall
  (it then sees the room), or is **totally internally reflected**. A ray out through the base lands on the board, possibly on the
  far side of the axis, which is why the image folds and mirrors near the edge.
- **Chromatic aberration**: red, green and blue use slightly different indices. The fringe is the same size as on the dome (it
  grows toward the rim and a little more when lifted); *Extra colour spread* adds more.
- **Thickness**: a rounded lip around the base, a soft band, a little greyer than the wall; lit on the lit side, shaded on the
  other; with a feathered inner line and a soft (not fine white) outer edge. The edge brightness is soft because real glass has
  no sharp edge.
- **Reflections**: a steep clear wall mirrors the room a little (Fresnel); there are broad, bright window highlights with slanted
  ends toward the light on the upper left, with a darker band beside the big one.
- **Cast on the board**: toward the lower right a faint, see-through shadow (the glass's outline shifted away from the light);
  a short caustic line near the foot (with a little colour split: red outermost, blue nearest the glass) and a fainter one; a pale
  glow on the lit side. The shadow is confined to the lower-right quadrant.
- **The black ring shades the glass beside it** on the lower right (an inner shadow), since it is solid and the light is upper left.
- **Rays see only what is below**: PA refracts the negative sheet and everything on the surface, but never the eyepiece itself.
- Only the ring of glass and its margin are drawn (an annulus mesh), since the middle is hidden under PB.

### 4.3 PC, the magnifier
- Magnification 1×–2.5× (`ZOOM_MIN`, `ZOOM_MAX`); the ring turns 180° per 1×. It shows the film as **positives**.
- **None of the panel's effects touch a photograph seen through PC**: light seep, tint and glow, falloff, rim, grain, dust. They are
  applied everywhere in the lens *except* over the picture frames (`raster.js`, `createWindowView`, `mode === "pos"`).
- The light-bleed glare (a veil that scatters from bright areas) belongs to the rim only; the centre is exact.
- The glare / aberration band is the part under PB's shadow, and follows the *Fade* slider.

### 4.4 PB, the ring
- **Single press and move = slide the eyepiece.** **Double press and turn = change the magnification.** A double press and hold on
  the glass (PA or PC) lifts it.
- **The numbered points (1×, 1.5×, 2×, 2.5×) are detents**: the ring catches, holds, then breaks free; a click sounds. Extra turn
  needed to break out ≈ 0.06 zoom; capture within 0.012 (`lightbox.js` `BREAK`, `CAPTURE`).
- The ring's light (its highlights) does not turn with the scale; the engraving's lighting is fixed (`dial.js` `setDialLight`).
- **PC sits inside PB, a little below it**: PB casts a shadow on PC's rim (strength and fade sliders), even all round.

### 4.5 Sliding and throwing
- **Sliding** it on the board: it keeps momentum when released and glides to a stop (time constant 330 ms), bouncing off the page
  edges with 30 % of its speed (`lightbox.js` `coast`).
- **Pushing the ring against the top or bottom of the window while dragging scrolls the page**, faster the further it pushes
  (`EDGE_MIN`…`EDGE_MAX`); only a drag does it, never a resting eyepiece.
- **A glass edge dragging over the board makes the slide sound**, only while it is down and moving, never while lifted.

### 4.6 Lifting (`lightbox.js`)
- Lift height ×1.25 and 200 ms to rise (the *Lift height* / *Lift time* sliders); setting down takes about 170 ms.
- **Lifted, the glass sees and bends more** of its surroundings (the lens takes in 40 % more of the sheet; the eyepiece looks
  4.5 % bigger; the rim bends harder).
- **Its cast light and shadow spread, soften and weaken as it rises, but a trace always stays** (the sharper the nearer the board).
  The ring's drop shadow grows and lightens.
- **Released while lifted, it keeps its speed and direction** and carries on along that line as it comes down (little friction in
  the air, then board friction on landing; *Drop carry* = 1.3× the release speed, capped).

### 4.7 Landing (`lightbox.js` `landed`, `film.js` `thump`, `slap`)
- **Setting it down gives the board a single give that eases back**, not a vibration: the film frames under it dip together and
  return (critically damped, no overshoot), strongest in the middle and fading toward its edge; the board's grain and dust give
  the same way, under a pixel. A drop from higher lands harder (*Landing shake* slider).
- **A drum-skin thump plays with the glass sound**: a soft low note settling in pitch, quick membrane overtones, a dull pad (sounds §7).
- **Landing while moving drags the film** under it along its line the moment it touches down (whatever its speed): a push and a
  turn at the contact point and an S-lean of the film pieces (`SLAP`).

### 4.8 The eyepiece is heavier than the film (`film.js` `dragOnEye`, `coverage`; `lightbox.js` `tick`)
- **Film moved under the eyepiece drags it along** by friction (not while it is lifted, and not while you are holding it). The
  pull acts at the patch of film under the eyepiece: the strip's own velocity there (its slide plus the swing of its turn, so the
  top and bottom of one strip drag differently), counted more toward the middle of the eyepiece and by how much of the eyepiece the
  strip covers. A strip that is not moving, or not under it, does nothing. (*Film drags eyepiece*, *Eyepiece weight*)
- **The eyepiece has inertia.** It is heavy, so it takes a while to pick up the film's speed and keeps going a little after
  (the heavier, the less it moves). *Eyepiece weight* scales this.
- **A strip held down under the eyepiece is slightly harder to drag**: it lags the hand a little, more the more of the eyepiece it
  carries (`EYE_LOAD`; *Strip heavier under eyepiece*).
- **A carried eyepiece still rubs the other strips under it**, a little, however slowly it moves: strip A moves the eyepiece, the
  eyepiece moves strip B (`CARRY_K`, `CARRY_GATE`; *Carried eyepiece rubs strips*).
- **Sounds**: the eyepiece being displaced makes the slide sound at a much lower speed than normal; a strip nudged along the board
  by the eyepiece or by a carried eyepiece makes the film slide sound, and the carried eyepiece rubbing film gives the crackle.

## 5. Buttons set into the surface (`socket-buttons/`)

- A button is a dark rim with a frosted ivory top and an etched icon, set into a **socket**: lit lip on the lower right, shaded
  lip on the upper left, all with soft (not hard) edges, and a faint matte grain on the lit lip.
- **Pressing it goes *into* the surface** (the top shrinks toward its centre and dims), it does not slide down. A toggle that is on
  stays pressed in.
- **The controls sit on the wooden bar** (`nav-bar/`, see §10), which rests on top of the light box, over the film. Film slides **under** the bar and is hidden by it; a press on the bar never takes hold of the film (`onBoard` in `lightbox.js`), and the controls are always pressable. The bar and its controls lie over the dust and everything else on the panel, so no dust shows on them. (The old rules, that film slid over the buttons and a covered button could not be pressed, are gone.)
- **The sign** (`etched-text/`): the wooden bar carries lettering between the controls, **inlaid like the knob's scale marks and its − and +** (cream in the dark wood; on a plain panel the same engraving is dark brown): a shaded band
  along the upper-left inside edge of each stroke, a thin pale lip along the lower-right edge (light from the upper left). It is **vector** (SVG text with an SVG filter), so it stays sharp when zoomed;
  the magnifier gets a canvas copy of it like the knob's. The four words are **one line that always stays together**: the whole lettering scales down to fit about 80% of the gap (it hides only if the gap is under about 60 px)
  and never wraps. It lies on the bar, it is centred on the screen by its real ink extents (so its room is set by the nearer of the knob and the buttons), and the middle of its small letters is level with the middle of the knob
  (`placeSign` in `lightbox.js`; the words are the `signText` option).
- **The sign can be switched off or reworded** from the sliders menu (group "Sign": "Show text", and "Words"). Off, or an empty line, hides it (`placeSign` returns early and the glass views stop drawing it);
  typing re-measures it, so it is re-fitted and re-centred as you type. It starts **hidden** (the `showSign` option turns it on from the start); the words are the `signText` option's.
- **The knob and the buttons are centred on one line**: every control is centred on the bar's own middle line (`.nb-row` in `nav-bar.css`), whatever its size, so the knob's, the light button's and the buttons' centres are level.
- **The volume knob** (`socket-buttons/knob.js`) sits at the left end of the wooden bar and sets the page's overall (master) volume, 0 to 2×,
  straight up = 1× (the normal level; the dial turns evenly through it, with no catch there). It is a rotary dial in the same socket: a knurled rim that turns, a brushed-metal face whose sheen
  does not turn (the light is fixed), a dark mark, and a scale round it, **engraved into the surface** (a dark shaded wall on the upper left of each groove, a light lip on the lower right), with a − and a + standing where the two end ticks would be. It turns by dragging round its centre or with the arrow keys, sweeps a half circle (180°),
  and **clicks like the eyepiece ring**: light ticks as it passes each step, a thud when it reaches an end. It stays where you left it on this device. Film covering it makes it unusable like the buttons,
  and the glasses draw it too, with its engraved scale and its markings (`paintSocketKnob`). It stands proud of the surface, so it casts a shadow toward the
  lower right (light from the upper left), on the page and in the glass views.
- The buttons sit on the fully lit part of the panel above the film, inside the clear margin; never over the film at rest.
- They are also drawn into the glass views, over the film with the bar they sit on, so the eyepiece shows them (`paintSocketButton`).
- **The sliders panel closes on a press anywhere else** or on Escape (localhost only; the live page has only the reset button).

## 6. How the glass treats everything under it

| Under the glass | PA (outer, refracts) | PC (inner, magnifies) |
|---|---|---|
| Board, dark room, rim | yes (refracted) | yes, outside the picture frames |
| Buttons | yes | yes |
| Film (negative / positive) | negative | positive |
| Dust | yes (not over photos) | yes (not over photos) |
| Light seep, lit holes | yes | outside the photos only |
| Panel falloff / glow | yes | outside the photos only |
| Matte grain | yes | **never** |

## 7. Sound rules (`sounds.js`)

- **Real recordings** of glass for lift and set-down (`audio/`); everything else synthesised. The synthesised versions are the
  fallback.
- **Dial**: soft ticks as it turns (0.30), a distinct notch click and end-stop thud (0.60). The volume knob makes the same sounds.
- **The slide sound** (0.01) plays only while the eyepiece or a strip actually moves over the board; **film crackle** (1.0) only
  where the eyepiece rubs film or a strip rides over another. Both are silent while the eyepiece is lifted.
- **Lift** (0.60), **set-down** (0.15) and the **surface thump** (0.60) are three separate volumes; the thump plays alongside the
  set-down at the same moment as the landing give.
- **Button** click: a crisp tick and low thud as it goes in, a lighter one as it comes back; the sliders button has it too.

## 8. Performance rules

- The two glass passes are the costly part of a frame. An adaptive quality governor lowers their pixel density when frames run slow
  (`Q_LEVELS`) and raises it again; `?fixedquality`, `?quality=N` override it.
- Anything that does not change per frame is baked once (panel falloff / glow, the rim, the seep map) and redrawn only when a
  slider moves or the sheet is resized.
- Hidden pixels are never shaded: PA is drawn as a ring, not a square.

---

*Adding a rule:* implement it, comment the rule in the code where it lives, and add it to the matching section above (or a new one),
with the file and constant it lives in.

## 9. The start screen (`start-screen/`)

The page opens on the light box with its **light off**, waits until everything is drawn, then the light comes on. Then the page is exactly as it always was.

- **Off:** a dark layer covers the whole light box (the eyepiece and buttons too: they are on the panel), so about a tenth of the light is left. It is there from the first frame, so there is never a flash of the lit page.
- **Waits for everything:** the fonts, every photo decoded and the scene built (`sceneReady` in `lightbox.js`), then two painted frames, then the dark is held at least 0.6 s so it is seen. It never waits longer than 6 s for the ready signal, whatever is still loading.
- **Light-up, about 1.6 s** (`timeline.js`; the "Light-up length" slider scales the whole shape): the switch goes over and the light **flashes at the same instant** (no flicker first): it jumps brighter than normal (a gentle flash: 0.7 of the timeline's full 1.5 times normal, the "Flash intensity" slider) and settles back to exactly normal; the dark and glow layers are then removed, so nothing of the effect is left running.
- **Over-bright light passes only through what is see-through.** It is a gain on what lies under it (a `brightness` backdrop-filter), not light added on top, so the bare board, the pictures and the sprocket holes get much brighter while opaque parts (the film's borders, the eyepiece's black ring, the dark parts of the buttons) stay as dark as they were. Only a trace of blur lets the glow soften past the film's edge.
- **Sound** (`sound.js`): **one** mechanical switch-on, like a camera's shutter snap: a bright "ka" and a lower "clack" over the thud of the switch going over, **at the same instant as the flash**, with a very soft, brief electronic crackle (a handful of tiny bright pops over about a quarter of a second, thinning out) as the light flashes. No repeated clicks, no whirr. Its level is the "Start-up sound" slider. Browsers only start audio after the visitor has touched the page, so with no touch yet there is no sound: it is skipped, not queued (a late snap would sound wrong). "Replay start screen" in the sliders menu plays it, because that is a click.
- **Reduced motion:** no flash, no sound: the light fades up over about half a second.
- **Sliders menu, group "Start screen":** light-up length, flash intensity, start-up sound level, replay.
- **The light button** (`press-button/`): a latching push button on a weathered plate sits on the wooden bar next to the volume knob, level with it and the buttons: a patinated teal-green metal plate (sized so its brass-rimmed round button is 38 px across, the same as the revert button) with rust showing through, four corner screw holes, two eyelets and two holes, and in the middle a brass-rimmed round recess holding a **glossy, polished** cream knob with a fluted edge (a curved window-like reflection across its top with a crisp lower edge, a small hard glint, a dark underside and light bounced back into its lower right rim). **Pressed in = on, out = off**: pressing it moves the knob in toward its centre, dims it and takes its shadow away (the same way the buttons go in); pressing again springs it out and the knob casts its shadow to the lower right again (light from the upper left). It is **set into the bar** like the knob and buttons, not floating on it: a dark gap right round the plate and a faint warm lip catching the light on its lower right (the plate's `surface: "wood"`). The plate is one SVG, so it stays sharp at any zoom, and the glasses draw the same drawing. It turns the light box's light on and off: **off** (the knob springs out) kills the light quickly (about a fifth of a second, fast at first, then lingering a moment) back to the dim unlit screen, with one softer click; **on** (the knob goes in) brings the flash with the switch-on sound, exactly as at the start. It follows the light, too: at the start it is out (off) and goes in at the moment of the flash. It lies on the panel under the film like the knob and buttons (film over it makes it take no presses), the glasses draw it (`paintToggle`), dust is kept off it, and it is dimmed with everything else while the light is off. The sign makes room for it (`placeSign`).

## 10. The wooden bar (`nav-bar/`)

A glossy wooden bar **rests on top of the light box**, across its top, **flush with the top edge of the lit panel**. It carries the volume knob and the light button (left end), the sliders and revert buttons (right end) and, if it is switched on, the sign (between them).

- **It follows the light box's top edge:** it starts at the panel's top edge (the dark margin's inner edge), is as wide as the panel, and its two top corners have the panel's own corner radius (`edgeF * 0.9`, the same as the glow's clip), so it fits the curve of the lit panel; its lower corners are small. The inlay line and its corner flourishes follow the same curves.
- **Wood:** dark rosewood veneer in two book-matched sunbursts (one each side of the middle), each wedge laid down three times, wide and faint then narrower, so its edges **blend into its neighbours** (no hard rays), the point where the grain meets softened by a warm glow; a fine grain along the same directions; a varnish shine from the upper left (a diagonal sheen and a soft band) and a darker fall toward the lower right; a cream **inlay line** inside the edge with a fan of leaves in each corner, let into the wood with a dark edge on its lower right and a lit one on its upper left; a lit bevel on the upper left and a thin dark line all round the front face (`drawBar`).
- **It looks three-dimensional:** a **thick edge** (`EDGE_T`, 6 px): the bar's whole outline is exactly the lit panel's top (same corner radii, so it stays concentric with the panel's edge all round the corner), the front face is that shape drawn smaller on the right and at the bottom, and what shows of the full shape beyond it is the side, in shade: nothing at the top and left, 6 px on the right and at the bottom, tapering round the top right corner as a real plank's side does; and a **shadow on the surface below it** (a tight dark line where it rests and a wide soft one thrown to the lower right, light from the upper left), drawn into the same picture so the page and the magnifier agree. It is drawn once on a canvas per size, corner shape and pixel density.
- **It is an object on the panel:** opaque, over the film and everything printed on the panel (grain, falloff, glow, dust, light seep), under the eyepiece and under the start screen's dark layer (so it dims with everything when the light is off). Film slides under it; presses on it never grab film (only the bar's own box takes presses, not the shadow round it).
- **The glasses draw it last** (`scene.bar`, then `scene.buttons` on it, in `raster.js`), so the eyepiece over the bar shows the wood, its edge and shadow, the controls and the sign.
- **Controls on dark wood** are restyled (`nav-bar.css`, and the `surface: "wood"` option of the canvas painters): the **volume knob** is smaller (48 px) and **stands on the wood with its shadow only to its lower right** (no dark ring all round), and its scale is smaller too (142% of the knob across) so it stays clear of the inlay line, in cream inlay; the **round buttons** (sliders, revert) are **spun, brushed brass** instead of ivory, still set into the wood with a dark gap and a faint warm lip: the finest concentric lines of the turning, and the light running across them in two bright wedges and two dark ones (brass brushed in circles reflects in bands, not in a spot); no patina; the light button's plate is set into it the same way.
- **Size and place** (`layout()` in `lightbox/lightbox.js`): 96 px tall (edge included); the film starts 36 px below it. Controls are centred on the middle line of the bar's front face and sit 42 px in from the ends (`--nb-pad`), well clear of the edge. The wood is made again when the window is resized or zoomed.
