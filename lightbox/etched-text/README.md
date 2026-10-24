# etched-text

Lettering engraved into a surface, drawn as **vector** (SVG text), so it stays sharp at any size and at any zoom. The engraving matches the scale marks on the
volume knob: the letters are cut in dark brown, a dark band lies along the upper-left inside edge of each stroke (the cut's wall in shade) and a thin pale lip
catches the light along the lower-right edge. Light is from the upper left. The words are one line and stay together: the whole lettering scales to the box it is
given and never wraps.

```js
import { createEtchedText } from "./etched-text/etched.js";

const sign = createEtchedText({ text: "dude with a pentax" });
await sign.ready;                                   // the font has loaded
parent.append(sign.el);                             // an <svg>; size it with CSS width/height, it keeps its shape
const { aspect, midY } = sign.measure();            // width over height; and where the middle of the small letters sits, 0..1 of the height
sign.el.style.width = `${w}px`; sign.el.style.height = `${w / aspect}px`;
sign.paint(ctx, x, y, w, h);                        // the same lettering on a canvas, for anything that redraws the surface (a magnifier)
```

Self-contained: `etched.js` and the font (`Yellowtail-latin.woff2`, a slanted brush script, basic Latin only, Apache Licence 2.0, see `LICENSE-Yellowtail.txt`).
Every "e" is drawn in italic Times New Roman, taken from the machine's own fonts (the `swap` option: `{ chars, fontFamily, fullName: [...], style }`; `swap: null` for none). If that face is not installed the letters stay in the script.
Another font: `createEtchedText({ text, fontFamily: "MyFace", fontUrl: "./my-face.woff2" })`. A Marshall-style script, not Marshall's own logo face (a trademark).
