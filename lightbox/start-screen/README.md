# start-screen

The page opens on the light box with its light **off**; once everything is drawn the light comes on the way a tube does (the switch goes over and it flashes at once, brighter than normal, then settles to normal) with a single camera-shutter-like switch sound and a very soft electronic crackle, in about 1.6 s. Then the layers are removed and the page is exactly as it was.

```js
import { createStartScreen } from "./start-screen/start-screen.js";

const start = createStartScreen({
  host: stage,                      // the positioned element it covers
  ready: promise,                   // settles when everything under it is drawn (never waited for longer than 6 s)
  play: () => promise,              // optional: start the sound; resolves true when it is playing
  length: 1600,                     // ms
});
host.append(...start.els);          // keep start.els in the host if it is rebuilt
start.run();                        // wait for ready, then light up (call once)
start.replay();                     // dark again, then light up now
```

| file | what it is |
|---|---|
| `timeline.js` | pure numbers: how bright the light is at each moment (the flash, the over-bright, the settle). The picture and the sound both read it. |
| `start-screen.js` | the two layers (a dark cover and a brightening glow), waiting for ready, running the timeline, removing the layers at the end; reduced-motion path |
| `sound.js` | `createStrobeSound(audio)`: one shutter snap ("ka-clack") over the thud of the switch, and a soft brief crackle. Borrows audio parts from `sounds.js`. |
| `start-screen.css` | the layers' position and colour (`--ss-dark`) |

**Wired in at:** `lightbox.js` `mountLightBox` (creates it, supplies `sceneReady`, keeps the layers in the stage in `layout()`, the "Start screen" rows in the sliders menu), `sounds.js` (`strobe`, its volume node and `vols.strobe`), `index.html` and `sw.js` (the CSS and the files).

The over-bright light is a **gain** (`backdrop-filter: brightness`) so it brightens what lets light through and leaves opaque parts dark. Rules: `PHYSICS.md` §9.
