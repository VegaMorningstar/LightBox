/* Liquid glass, in WebGL2: the outer glass ring (PA) and the inner lens glass (PC).
 *
 * Same idea as the TypeGPU "liquid glass" example: work from a signed distance, split the glass
 * into zones, and in the rim zone push the sampling position outward along the radial direction by
 * an amount that grows toward the edge (refraction), sampling the colour channels at slightly
 * different offsets (chromatic aberration), with a little blur and tint. Here the shape is a
 * circular annulus: flat next to the eyepiece ring, bending hard at the outer rim.
 */

const VERT = `#version 300 es
in vec2 a;
void main() { gl_Position = vec4(a, 0.0, 1.0); }`;

const FRAG = `#version 300 es
precision highp float;
uniform sampler2D uTex;   // the negative sheet around the eyepiece, centred on it
uniform vec2  uRes;       // canvas size, device px
uniform float uDpr;
uniform float uSide;      // width of that window, css px
uniform float uDo;        // outer glass diameter, css px
uniform float uRi;        // radius of the eyepiece ring the glass sits around
uniform float uStrength;  // refraction at the rim, css px
uniform float uChroma;    // colour fringe at the rim, css px
uniform float uBlur;      // frost, in mip levels at the rim
uniform float uLift;      // 0 = resting on the board, 1 = held up: it sees and bends more of its surroundings
out vec4 outColor;

vec3 refracted(vec2 base, vec2 dir, float disp, float ca, float lod) {
  vec2 h = vec2(uSide * 0.5);
  float r = textureLod(uTex, (base + dir * (disp + ca) + h) / uSide, lod).r;
  float g = textureLod(uTex, (base + dir * disp + h) / uSide, lod).g;
  float b = textureLod(uTex, (base + dir * (disp - ca) + h) / uSide, lod).b;
  return vec3(r, g, b);
}

void main() {
  vec2 fc = vec2(gl_FragCoord.x, uRes.y - gl_FragCoord.y) / uDpr;
  vec2 p = fc - vec2(uDo * 0.5);
  float r = length(p);
  float R = uDo * 0.5;
  float cover = 1.0 - smoothstep(R - 1.0, R, r);
  if (cover <= 0.0) { outColor = vec4(0.0); return; }

  float t = clamp((r - uRi) / (R - uRi), 0.0, 1.0);   // 0 at the ring, 1 at the outer rim
  vec2 dir = p / max(r, 1e-3);
  float prof = pow(t, 2.2);                           // flat inside, steep at the rim

  // Lifted off the board the glass is further from what it looks at: the rim bends harder and the whole
  // glass takes in a wider patch of the surroundings.
  float lift = uLift;
  vec3 col = refracted(p * (1.0 + 0.13 * lift), dir, uStrength * (1.0 + 0.95 * lift) * prof,
                       uChroma * (1.0 + 0.6 * lift) * prof, (uBlur + 0.7 * lift) * t);

  // light from the upper left: bright rim facing it, slight shade opposite
  vec2 L = normalize(vec2(-0.55, -0.8));
  float facing = dot(dir, L);
  float rim = pow(t, 5.0);
  col += vec3(1.0, 0.97, 0.9) * rim * (0.16 + 0.5 * max(facing, 0.0)) * (1.0 + 0.35 * lift);
  col -= vec3(0.12) * rim * max(-facing, 0.0);
  col *= mix(0.78, 1.0, smoothstep(0.0, 0.16, t));    // contact shadow beside the ring
  col = mix(col, vec3(1.0), 0.05 + 0.4 * smoothstep(R - 2.0, R - 0.6, r)); // haze + edge line

  outColor = vec4(col * cover, cover);
}`;

/* inner glass: fully clear in the middle; under the ring's shadow the edge bends outward and the
 * colour channels split (chromatic aberration) */
const LENS_FRAG = `#version 300 es
precision highp float;
uniform sampler2D uTex;   // lit positive sheet, already magnified, centred on the lens
uniform vec2  uRes;       // canvas size, device px
uniform float uDpr;
uniform float uG;         // glass diameter, css px
uniform float uPad;       // extra source margin around the glass, css px
uniform float uEdge;      // width of the aberration zone under the ring's shadow, css px
uniform float uStrength;  // edge bend, css px
uniform float uChroma;    // colour split at the very edge, css px
uniform float uGlare;     // how much bright areas bleed light into their surroundings
out vec4 outColor;

void main() {
  vec2 fc = vec2(gl_FragCoord.x, uRes.y - gl_FragCoord.y) / uDpr;
  vec2 p = fc - vec2(uG * 0.5);
  float r = length(p);
  float R = uG * 0.5;
  float cover = 1.0 - smoothstep(R - 1.0, R, r);
  if (cover <= 0.0) { outColor = vec4(0.0); return; }

  float t = clamp((r - (R - uEdge)) / uEdge, 0.0, 1.0);   // 0 clear centre -> 1 at the rim
  float prof = pow(t, 1.8);
  vec2 dir = p / max(r, 1e-3);
  float side = uG + 2.0 * uPad;

  vec2 uv = (p + dir * uStrength * prof + vec2(side * 0.5)) / side;
  vec2 ca = dir * uChroma * prof / side;
  vec3 col = vec3(texture(uTex, uv + ca).r, texture(uTex, uv).g, texture(uTex, uv - ca).b);

  // Light bleed. Light scatters inside the optics and the film base, so bright clear areas lift the dense
  // areas around them: a veil over everything (stronger when much of the view is bright) and a bloom
  // that spills from bright edges across the neighbouring dark ones.
  if (uGlare > 0.001) {                  // (no glare asked for: skip the blurred reads altogether)
    vec3 haze = (textureLod(uTex, uv, 3.0).rgb + textureLod(uTex, uv, 4.0).rgb + textureLod(uTex, uv, 5.0).rgb) / 3.0;
    float hl = dot(haze, vec3(0.2126, 0.7152, 0.0722));
    vec3 spill = max(haze - col, 0.0);
    col += uGlare * (0.2 * pow(hl, 1.5) * (1.0 - col) + 0.3 * spill * (1.0 - col));
  }
  outColor = vec4(col * cover, cover);
}`;

function compile(gl, type, src) {
  const s = gl.createShader(type);
  gl.shaderSource(s, src);
  gl.compileShader(s);
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
  return s;
}

/* shared setup: a full-screen triangle, one program, one texture. null if WebGL2 is unavailable */
function makePass(canvas, fragSrc, names) {
  const gl = canvas.getContext("webgl2", { alpha: true, premultipliedAlpha: true, antialias: false });
  if (!gl) return null;

  let program;
  try {
    program = gl.createProgram();
    gl.attachShader(program, compile(gl, gl.VERTEX_SHADER, VERT));
    gl.attachShader(program, compile(gl, gl.FRAGMENT_SHADER, fragSrc));
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(program));
  } catch (err) {
    console.warn("LightBox glass disabled:", err);
    return null;
  }
  gl.useProgram(program);

  gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  const loc = gl.getAttribLocation(program, "a");
  gl.enableVertexAttribArray(loc);
  gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);

  const U = Object.fromEntries(names.map((n) => [n, gl.getUniformLocation(program, n)]));
  const tex = gl.createTexture();
  let dpr = 1;

  return {
    U,
    get dpr() { return dpr; },
    /* canvas pixel size follows the glass diameter */
    resize(cssSize, quality = 1) {
      dpr = Math.min(2, window.devicePixelRatio || 1) * quality;      // quality < 1 on a slow device: fewer pixels to shade
      canvas.width = Math.round(cssSize * dpr);
      canvas.height = Math.round(cssSize * dpr);
      gl.viewport(0, 0, canvas.width, canvas.height);
    },
    upload(source, mipmaps) {
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);
      if (mipmaps) gl.generateMipmap(gl.TEXTURE_2D);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, mipmaps ? gl.LINEAR_MIPMAP_LINEAR : gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    },
    draw(set) {
      gl.useProgram(program);
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.uniform2f(U.uRes, canvas.width, canvas.height);
      gl.uniform1f(U.uDpr, dpr);
      set(gl, U);
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    },
  };
}

/* PA: the outer glass ring, refracting the negative sheet beneath it. null without WebGL2. */
export function createGlass(canvas) {
  const pass = makePass(canvas, FRAG, ["uTex", "uRes", "uDpr", "uSide", "uDo", "uRi", "uStrength", "uChroma", "uBlur", "uLift"]);
  if (!pass) return null;
  let size = 1;
  return {
    get dpr() { return pass.dpr; },
    resize(cssSize, quality = 1) { size = cssSize; pass.resize(cssSize, quality); },
    /* view: the window canvas from raster.js, `side` css px across and centred on the glass;
       ringRadius: the eyepiece ring's outer radius */
    draw(view, side, ringRadius, lift = 0) {
      const rimWidth = size / 2 - ringRadius;
      pass.upload(view, true);
      pass.draw((gl, U) => {
        gl.uniform1f(U.uSide, side);
        gl.uniform1f(U.uDo, size);
        gl.uniform1f(U.uRi, ringRadius);
        gl.uniform1f(U.uStrength, rimWidth * 0.62);
        gl.uniform1f(U.uChroma, rimWidth * 0.09);
        gl.uniform1f(U.uBlur, 1.4);
        gl.uniform1f(U.uLift, lift);
      });
    },
  };
}

/* PC: the inner glass. Clear in the middle; bends and splits colour only where the ring's shadow falls.
 * `view` is the magnified window from raster.js's createLensView; `edge` is the width of the zone. */
export function createLens(canvas) {
  const pass = makePass(canvas, LENS_FRAG, ["uTex", "uRes", "uDpr", "uG", "uPad", "uEdge", "uStrength", "uChroma", "uGlare"]);
  if (!pass) return null;
  let size = 1;
  return {
    get dpr() { return pass.dpr; },
    resize(cssSize, quality = 1) { size = cssSize; pass.resize(cssSize, quality); },
    draw(view, pad, edge, glare = 0) {
      pass.upload(view, glare > 0.001);       // mipmaps give the blurred light the glare is made from, so only build them when it is used
      pass.draw((gl, U) => {
        gl.uniform1f(U.uG, size);
        gl.uniform1f(U.uPad, pad);
        gl.uniform1f(U.uEdge, edge);
        gl.uniform1f(U.uStrength, Math.min(edge * 0.55, pad * 0.9));
        gl.uniform1f(U.uChroma, Math.min(edge * 0.26, pad * 0.5));
        gl.uniform1f(U.uGlare, glare);
      });
    },
  };
}
