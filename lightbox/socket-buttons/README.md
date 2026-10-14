# socket-buttons

Round push buttons that look set into a surface, like fittings in a light box's panel: a dark rim, a frosted ivory top with an
etched icon, a narrow socket around it (lit lip lower right, shaded lip upper left), and a press that goes *into* the surface.

Two files, no dependencies. Copy this folder into another project and:

```js
import { createSocketButton, mountSocketCorner, setPressed, ICONS } from "./socket-buttons/buttons.js";

const reset = createSocketButton({
  icon: ICONS.reset,                 // or ICONS.sliders, or your own 24 x 24 artwork
  label: "Reset",
  onClick: () => doReset(),
  onPress: (phase) => playClick(phase),   // "down" and "up", optional (for a click sound)
});
mountSocketCorner(document.querySelector("#panel"), [reset]);   // the container must be positioned
```

- Importing `buttons.js` loads `buttons.css` next to it by itself. (Add your own `<link>` to it if you want it before the script runs.)
- `setPressed(button, true)` keeps a button pressed in, for a toggle.
- Theme with CSS variables on the button or any ancestor: `--sb-size`, `--sb-gap`, `--sb-top`, `--sb-right`, `--sb-ink`.
- Custom icons: strokes with `class="arc"`, fills with `class="hd"`, drawn in a 24 x 24 box; they are etched automatically.

## The knob (`knob.js`, `knob.css`)

A rotary knob in the same socket, for a value you set by turning (volume, say):

```js
import { createSocketKnob } from "./socket-buttons/knob.js";
const volume = createSocketKnob({
  label: "Volume", min: 0, max: 2, value: 1, home: 1,     // home: a detent it catches on, as well as both ends
  onInput: (v) => setVolume(v),
  onTick: (n) => tickSound(n), onNotch: () => notchSound(), onStop: () => thudSound(),
});
mountSocketCorner(container, [volume.el]);                  // mountSocketCorner is in buttons.js
volume.set(1.4);                                            // move it from outside (silent)
```

Drag round its centre or use the arrow keys. `--sb-knob` sets its diameter. `paintSocketKnob(ctx, { x, y, size, angle })` draws it on a canvas.
