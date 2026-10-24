# etched-text

Lettering set into a surface as a polished brass inlay: a dark brown groove round every letter, a dark brown shaded wall along the upper-left of each
stroke, a thin pale lip on the lower right, and a warm gold gradient with a bright diagonal sheen. All hard-edged layers (plus one faint soft shadow), so it
stays crisp. Light is from the upper left.

```js
import { createEtchedText } from "./etched-text/etched.js";

const sign = createEtchedText({ text: "dude with a pentax" });
await sign.ready;                                     // the font has loaded
const r = sign.render(48, devicePixelRatio);          // draw it 48 css px tall: returns { canvas, width, height } (css px)
someContext.drawImage(sign.canvas, x, y, r.width, r.height);
```

Self-contained: `etched.js` and the font file (`Pacifico-latin.woff2`, basic Latin only, SIL Open Font Licence, see `OFL-Pacifico.txt`). Another font:
`createEtchedText({ text, fontFamily: "MyFace", fontUrl: "./my-face.woff2" })`. The lettering is a Marshall-style brush script, not Marshall's own logo face
(that is a trademark and not an installable font).
