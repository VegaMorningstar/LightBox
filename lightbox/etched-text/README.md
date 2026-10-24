# etched-text

Lettering set into a surface as a polished brass inlay: a dark brown groove round every letter, a hard dark shadow where the cut's far wall stands, a dark brown shaded wall along the upper-left of each
stroke, a thin pale lip on the lower right, and a warm gold gradient with a bright diagonal sheen. All hard-edged layers (plus one faint soft shadow), so it
stays crisp. Light is from the upper left.

```js
import { createEtchedText } from "./etched-text/etched.js";

const sign = createEtchedText({ text: "dude with a pentax" });
await sign.ready;                                     // the font has loaded
const { aspect } = sign.measure();                    // the lettering's box, width over height, to fit it to a space
const r = sign.render(48, devicePixelRatio);          // draw it 48 css px tall: { canvas, width, height, midY } (css px); midY lines the small letters up with something
someContext.drawImage(sign.canvas, x, y, r.width, r.height);
```

Self-contained: `etched.js` and the font file (`Yellowtail-latin.woff2`, a slanted brush script, basic Latin only, Apache Licence 2.0, see `LICENSE-Yellowtail.txt`). Another font:
`createEtchedText({ text, fontFamily: "MyFace", fontUrl: "./my-face.woff2" })`. The lettering is a Marshall-style brush script (Yellowtail), not Marshall's own logo face
(that is a trademark and not an installable font).
