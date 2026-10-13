/* Liquid glass, in WebGL2: the outer glass ring (PA) and the inner lens glass (PC).
 *
 * Same idea as the TypeGPU "liquid glass" example: work from a signed distance, split the glass
 * into zones, and in the rim zone push the sampling position outward along the radial direction by
 * an amount that grows toward the edge (refraction), sampling the colour channels at slightly
 * different offsets (chromatic aberration), with a little blur and tint. Here the shape is a
 * circular annulus: flat next to the eyepiece ring, bending hard at the outer rim.
 *
 * The outer glass can be drawn two ways, blended by `shape`:
 *   0  a dome: the lookup is pushed outward by an amount that grows steeply toward the rim (a rounded lens edge).
 *   1  a solid clear frustum, widest at its base, like a real film loupe's glass. Seen from above, the black collar covers
 *      the flat top, so what shows is the sloped wall. Each pixel is a ray looking straight down: it is bent by Snell's law
 *      where it enters the wall, crosses the glass (its path is followed in the cone's cross-section, since a ray that
 *      starts vertical stays in the plane through the axis), and may meet the far wall or the base. At each surface it
 *      either leaves or, if it meets the glass too slantwise, is totally internally reflected. A ray that gets out through
 *      the base lands on the board, at a point that can be on the far side of the axis, which is what makes the image
 *      fold and mirror inside a real loupe. Red, green and blue use slightly different indices, so they land apart.
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
uniform float uShape;     // 0 = dome, 1 = frustum
uniform float uTopR;      // radius where the flat top ends and the sloped wall begins, css px
uniform float uSlope;     // the wall's angle from the board, radians
uniform float uIndex;     // refractive index of the glass
uniform float uDisp;      // how much the index differs between red and blue
uniform float uReflect;   // how much of the wall's reflection to show, 0..1
uniform float uLip;       // width of the thick rounded lip around the base, css px
uniform float uLipK;      // strength of the lip's highlights and shadow
uniform float uPad;       // margin of canvas around the glass, css px (room for the glass's light and shadow on the board)
uniform float uCast;      // strength of that light and shadow
uniform float uSquig;     // strength of the wavy highlights on the glass, toward the light
uniform float uShade;     // strength of the shadow the solid part of the loupe casts on the glass
uniform float uShadeOff;  // how far that shadow falls, as a multiple of the margin
out vec4 outColor;

vec3 refracted(vec2 base, vec2 dir, vec3 disp, float lod) {
  vec2 h = vec2(uSide * 0.5);
  float r = textureLod(uTex, (base + dir * disp.r + h) / uSide, lod).r;
  float g = textureLod(uTex, (base + dir * disp.g + h) / uSide, lod).g;
  float b = textureLod(uTex, (base + dir * disp.b + h) / uSide, lod).b;
  return vec3(r, g, b);
}

/* Follow one ray that looks straight down and enters the sloped wall at distance r from the axis, through the glass's
 * cross-section. Returns where it reaches the board (signed distance along the ray's meridian) and what it ended up
 * seeing: 0 the board, 1 the room (it left through a wall), 2 the dark underside of the collar. */
vec2 trace(float n, float r, float gap) {
  float st = sin(uSlope), ct = cos(uSlope);
  float R = uDo * 0.5;
  float H = (R - uTopR) * (st / ct);
  vec2 nR = vec2(st, ct);                 // outward normals of the right and left walls
  vec2 nL = vec2(-st, ct);
  vec2 P = vec2(r, (R - r) * (st / ct));
  vec2 D = refract(vec2(0.0, -1.0), nR, 1.0 / n);
  float seen = 0.0;
  for (int i = 0; i < 6; i++) {
    float dR = dot(nR, D), dL = dot(nL, D);
    float tB = D.y < -1e-4 ? -P.y / D.y : 1e9;
    float tR = dR > 1e-4 ? (st * R - dot(nR, P)) / dR : 1e9;
    float tL = dL > 1e-4 ? (st * R - dot(nL, P)) / dL : 1e9;
    float tT = D.y > 1e-4 ? (H - P.y) / D.y : 1e9;
    float t = min(min(tB, tR), min(tL, tT));
    P += D * t;
    vec2 N = vec2(0.0, 1.0);
    bool base = false;
    if (t == tB) { N = vec2(0.0, -1.0); base = true; }
    else if (t == tR) N = nR;
    else if (t == tL) N = nL;
    float cs = dot(N, D);
    float k = 1.0 - n * n * (1.0 - cs * cs);
    if (t == tT) { seen = 2.0; D = reflect(D, N); continue; }
    if (k < 0.0) { D = reflect(D, N); continue; }        // total internal reflection
    if (!base) return vec2(0.0, 1.0);                     // out through a wall: sees the room
    vec2 Do = refract(D, -N, n);
    return vec2(P.x + Do.x / max(-Do.y, 0.05) * gap, seen);
  }
  return vec2(0.0, 2.0);                                  // trapped: dark
}

/* the share of light a clear surface reflects (unpolarised), for a view that meets it at cosine ci */
float fresnel(float n, float ci) {
  float ctt = sqrt(max(1.0 - (1.0 - ci * ci) / (n * n), 0.0));
  float rs = (ci - n * ctt) / (ci + n * ctt);
  float rp = (n * ci - ctt) / (n * ci + ctt);
  return 0.5 * (rs * rs + rp * rp);
}

/* A window reflected in the curved glass: a broad, bright, soft-edged pane that follows the glass around, with its ends
 * cut on a slant. Along its outer edge the glass reads darker (the surface turns away there).
 *   da  angle around the glass, measured from the direction of the light      x  distance in from the black ring, px
 *   f0, f1  where the pane runs across the clear band (0 at the ring, 1 at the rim)
 *   a0, a1  the angles it runs between   slant  how much the ends lean   soft  edge softness, px   rr  radius, px
 * Returns the pane's brightness in x and the darkening beside it in y. */
vec2 pane(float da, float x, float rimW, float rr, float f0, float f1, float a0, float a1, float slant, float soft) {
  float f = x / rimW;
  float aa = da - slant * (f - 0.5);
  float sf = soft / rimW, sa = soft / max(rr, 1.0);
  float across = smoothstep(f0, f0 + sf, f) * (1.0 - smoothstep(f1 - sf, f1, f));
  float along = smoothstep(a0, a0 + sa, aa) * (1.0 - smoothstep(a1 - sa, a1, aa));
  float lit = across * along * mix(1.0, 0.72, clamp((aa - a0) / (a1 - a0), 0.0, 1.0));
  float g = (f - (f1 + 0.1)) / 0.1;
  float dark = exp(-g * g) * smoothstep(a0, a0 + 4.0 * sa, aa) * (1.0 - smoothstep(a1 - 6.0 * sa, a1, aa));
  return vec2(lit, dark);
}

void main() {
  vec2 fc = vec2(gl_FragCoord.x, uRes.y - gl_FragCoord.y) / uDpr;
  vec2 p = fc - vec2(uDo * 0.5 + uPad);
  float r = length(p);
  float R = uDo * 0.5;
  float cover = 1.0 - smoothstep(R - 1.0, R, r);
  vec2 L = normalize(vec2(-0.55, -0.8));

  // Nothing to draw under the black ring (it is opaque and sits on top) or beyond the reach of the glass's light and
  // shadow: about half the pixels of the canvas, skipped before any of the work below.
  if (r < uRi - 1.5 || r > R + uPad) { outColor = vec4(0.0); return; }

  // What the glass does to the board around its foot, as in a photo of clear glass on a table in a raking light:
  //  - its shadow falls away from the light, as the glass's outline shifted that way; it is thin and see-through, darker
  //    where the glass is thick (toward the outline) and lighter in the middle where the light passes through
  //  - light the glass bends toward the shadow gathers into bright lines (caustics): one close to the foot, and a
  //    fainter one just inside the shadow's far edge
  //  - on the side facing the light a pale glow pools around the foot
  // All of it goes when the glass is held up, away from the surface.
  // The black ring and collar are solid: with the light at the upper left they shade the clear glass beside them on the
  // lower right, darkest against the ring and fading outward. Held up, the shadow falls further and is fainter.
  float shadeW = uPad * 0.75 * (1.0 + uLift);
  float ringE = length(p + L * uPad * 0.5625 * uShadeOff * (1.0 + 0.6 * uLift)) - uRi;
  float inner = (1.0 - smoothstep(-0.5 * shadeW, 0.5 * shadeW, ringE)) * uShade * uShape * (1.0 - 0.45 * smoothstep(0.0, 1.0, uLift));

  vec4 onBoard = vec4(0.0);
  if (r > R - 1.0 && uShape > 0.001) {
    float dd = max(r - R, 0.0);
    vec2 dirOut = p / max(r, 1e-3);
    float away = max(-dot(dirOut, L), 0.0);
    float toward = max(dot(dirOut, L), 0.0);
    // Rising off the board the glass's light and shadow spread out and go soft (the higher, the softer), and weaken, but a
    // trace stays on the surface even when it is held high.
    float sp = 1.0 + 2.0 * uLift;
    float spo = min(sp, 3.0);                                           // (how far they are thrown is capped to the margin)
    float on = uCast * uShape * mix(1.0, 0.65, smoothstep(0.1, 1.0, uLift));
    float q = length(p + L * uPad * 0.375 * spo);                         // distance from the shifted outline's centre
    float pen = uPad * 0.175 * sp;
    float sil = 1.0 - smoothstep(R - pen, R + pen * 0.6, q);
    float shade = sil * (0.45 + 0.55 * smoothstep(R * 0.82, R, q)) * smoothstep(0.15, 0.75, away) * 0.2 * on;   // kept to the lower-right quadrant
    // the colours of the bent light land a little apart: red further out, blue nearer the glass
    float split = uPad * 0.0125 * sp;
    vec3 gd = (vec3(dd) - uPad * 0.0875 * spo - vec3(split, 0.0, -split)) / (uPad * 0.0625 * sp);
    vec3 glint = exp(-gd * gd) * smoothstep(0.55, 0.95, away) * 0.8 * on / pow(sp, 0.35);
    vec3 cq = (vec3(q) - (R - uPad * 0.0625 * spo) + vec3(split, 0.0, -split)) / (uPad * 0.044 * sp);
    vec3 far = exp(-cq * cq) * sil * smoothstep(0.1, 0.7, away) * 0.3 * on / pow(sp, 0.35);
    float glow = exp(-dd / (uPad * 0.1875 * sp)) * smoothstep(0.1, 0.9, toward) * 0.1 * on;
    vec3 lightC = clamp(glint + far + vec3(glow), 0.0, 1.0);
    float lightA = max(lightC.r, max(lightC.g, lightC.b));
    onBoard = vec4(vec3(1.0, 0.97, 0.9) * lightC, lightA + shade * (1.0 - lightA));
    onBoard *= 1.0 - smoothstep(uPad - 4.0, uPad, dd);
  }
  if (cover <= 0.0) { outColor = onBoard; return; }

  float t = clamp((r - uRi) / (R - uRi), 0.0, 1.0);   // 0 at the ring, 1 at the outer rim
  vec2 dir = p / max(r, 1e-3);
  float d = R - r;                                    // distance in from the outer edge
  float prof = pow(t, 2.2);                           // flat inside, steep at the rim

  // Lifted off the board the glass is further from what it looks at: the rim bends harder and the whole
  // glass takes in a wider patch of the surroundings.
  float lift = uLift;
  float liftK = 1.0 + 0.95 * lift;

  // the dome: a push outward that grows steeply toward the rim, plus a colour fringe
  float domeD = uStrength * liftK * prof;
  float domeCa = uChroma * (1.0 + 0.6 * lift) * prof;
  vec3 domeDisp = vec3(domeD + domeCa, domeD, domeD - domeCa);

  // the frustum: a flat top (no bend) out to uTopR, then the sloped wall out to the base at R, traced ray by ray
  vec3 frustDisp = vec3(0.0);
  vec3 seen = vec3(0.0);                                        // per colour: 0 board, 1 room, 2 dark
  float wall = step(uTopR, r);
  if (wall > 0.5 && uShape > 0.001) {
    float H = (R - uTopR) * tan(uSlope);
    float gap = 0.45 * lift * H;                                // lifted, the base is above the board
    // (with no colour spread the three colours follow the same path, so it is traced once)
    vec2 tg = trace(uIndex, r, gap);
    vec2 tr = tg, tb = tg;
    if (uDisp > 1e-4) { tr = trace(uIndex - uDisp, r, gap); tb = trace(uIndex + uDisp, r, gap); }
    frustDisp = vec3(tr.x - r, tg.x - r, tb.x - r) * step(vec3(tr.y, tg.y, tb.y), vec3(0.5));
    seen = vec3(tr.y, tg.y, tb.y);
  }
  // the colour fringe is the dome's, unchanged, so the two shapes split colours by the same amount; the glass's own
  // dispersion (the slider) adds to it
  // the base's lip is a thick rounded edge: it pulls the view outward a little, more toward the very edge
  float lipW = max(uLip, 0.01);
  float inLip = 1.0 - smoothstep(lipW - 3.5, lipW + 1.5, d);   // a soft inner edge: the lip is rounded, not cut
  float lipBend = inLip * pow(clamp(1.0 - d / lipW, 0.0, 1.0), 2.0) * lipW * 0.5 * uLipK;
  vec3 disp = mix(domeDisp, frustDisp + vec3(domeCa, 0.0, -domeCa) + vec3(lipBend), uShape);
  vec3 col = refracted(p * (1.0 + 0.13 * lift), dir, disp, (uBlur + 0.7 * lift) * t * mix(1.0, 0.0, uShape) + 0.5 * uShape);

  // light from the upper left: bright rim facing it, slight shade opposite
  float facing = dot(dir, L);
  float rim = pow(t, 5.0);                            // the same rim light on the dome and the frustum
  col += vec3(1.0, 0.97, 0.9) * rim * (0.16 + 0.5 * max(facing, 0.0)) * (1.0 + 0.35 * lift);
  col -= vec3(0.12) * rim * max(-facing, 0.0);
  if (uShape > 0.001) {
    // rays that left through a wall see the lit room; ones that ended under the collar see black
    vec3 room = vec3(0.86, 0.83, 0.77) + 0.14 * max(facing, 0.0);
    col = mix(col, room, step(vec3(0.5), seen) * step(seen, vec3(1.5)) * uShape);
    col = mix(col, col * 0.3, step(vec3(1.5), seen) * uShape);
    // a clear surface also mirrors the room a little (Fresnel), mostly as a sheen on the side facing the light
    float mirror = fresnel(uIndex, cos(uSlope)) * uReflect * wall;
    col += vec3(1.0, 0.98, 0.94) * mirror * (0.1 + 0.9 * pow(max(facing, 0.0), 2.0)) * uShape;
    // the thickness of the glass: a rounded lip around the base, one soft band rather than two lines. It is a little
    // greyer than the wall, darker toward its outer edge on the side away from the light and brighter toward its inner
    // border on the side facing it, with a faint line along each border
    float lf = max(facing, 0.0), ls = max(-facing, 0.0);
    float gi = (d - lipW) / max(2.6, lipW * 0.45);
    float inner = exp(-gi * gi);                            // a broad faint line, so the edge reads as rounded
    float outer = smoothstep(0.0, 1.4, d) * (1.0 - smoothstep(1.4, 4.0, d));   // soft on both sides, peaking just inside the edge
    float bandT = clamp(d / lipW, 0.0, 1.0);
    float k = uLipK * uShape;
    col = mix(col, col * 0.82 + vec3(0.04), inLip * 0.5 * k);
    col -= vec3(0.14) * ls * (1.0 - bandT) * inLip * k;
    col += vec3(1.0, 0.97, 0.9) * lf * bandT * 0.12 * inLip * k;
    // windows reflected in the glass, toward the light (the upper left): one broad pane, a smaller one beside it, and a
    // tiny bright corner; the glass reads darker along the outer edge of the big pane
    float da = atan(sin(atan(p.y, p.x) - atan(L.y, L.x)), cos(atan(p.y, p.x) - atan(L.y, L.x)));
    float rimW = R - uRi, xin = r - uRi;
    vec2 big = pane(da, xin, rimW, r, 0.10, 0.72, -0.72, 0.16, 0.5, 1.3);
    vec2 small = pane(da, xin, rimW, r, 0.22, 0.58, 0.30, 0.52, -0.4, 1.1);
    vec2 tip = pane(da, xin, rimW, r, 0.35, 0.75, -0.96, -0.86, 0.3, 0.9);
    float win = clamp(big.x * 0.8 + small.x * 0.6 + tip.x * 0.9, 0.0, 1.0);
    col *= 1.0 - 0.3 * clamp(big.y, 0.0, 1.0) * uSquig * uShape;
    col = mix(col, vec3(1.0, 0.99, 0.97), win * 0.8 * uSquig * uShape * (1.0 + 0.2 * lift));
    // a bright streak where the lip catches the light, like the window reflected in a real rim
    float spec = pow(lf, 28.0) * exp(-pow((d - lipW * 0.5) / (lipW * 0.35 + 1.0), 2.0));
    col += vec3(1.0, 0.99, 0.95) * spec * 0.5 * k * (1.0 + 0.35 * lift);
    col += vec3(1.0, 0.97, 0.9) * (inner * (0.07 + 0.22 * lf) + outer * (0.1 + 0.3 * lf)) * k * (1.0 + 0.35 * lift);
  }
  col *= 1.0 - 0.75 * inner;                          // the loupe's own shadow on the glass
  col *= mix(0.78, 1.0, smoothstep(0.0, 0.16, t));    // contact shadow beside the ring
  // the very edge: a line on the dome; on the glass frustum a glow that fades softly inward, since real glass has no fine edge
  float edgeSoft = smoothstep(0.0, 1.4, d) * (1.0 - smoothstep(1.4, 4.0, d));
  float edge = mix(smoothstep(R - 2.0, R - 0.6, r), edgeSoft * 0.75, uShape);
  col = mix(col, vec3(1.0), 0.05 + 0.4 * edge); // haze + edge line

  outColor = vec4(col * cover, cover) + onBoard * (1.0 - cover);
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
  // The glare belongs to the rim (it flares round the glass's edge); the middle is clear, so the picture there is exactly as it is.
  float gw = smoothstep(0.0, 0.5, t);
  if (uGlare > 0.001 && gw > 0.0) {      // (no glare asked for, or in the clear middle: skip the blurred reads altogether)
    vec3 haze = (textureLod(uTex, uv, 3.0).rgb + textureLod(uTex, uv, 4.0).rgb + textureLod(uTex, uv, 5.0).rgb) / 3.0;
    float hl = dot(haze, vec3(0.2126, 0.7152, 0.0722));
    vec3 spill = max(haze - col, 0.0);
    col += uGlare * gw * (0.2 * pow(hl, 1.5) * (1.0 - col) + 0.3 * spill * (1.0 - col));
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

  const vbuf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, vbuf);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  let drawMode = gl.TRIANGLES, drawCount = 3;
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
    /* draw only a shape (clip-space triangle strip) instead of the whole canvas: pixels outside it cost nothing */
    setStrip(verts) {
      gl.useProgram(program);
      gl.bindBuffer(gl.ARRAY_BUFFER, vbuf);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(verts), gl.STATIC_DRAW);
      drawMode = gl.TRIANGLE_STRIP;
      drawCount = verts.length / 2;
    },
    draw(set) {
      gl.useProgram(program);
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.uniform2f(U.uRes, canvas.width, canvas.height);
      gl.uniform1f(U.uDpr, dpr);
      set(gl, U);
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.drawArrays(drawMode, 0, drawCount);
    },
  };
}

/* the margin of canvas around the outer glass, as a share of its diameter: room for its light and shadow on the board */
const PAD = 0.16;

/* PA: the outer glass ring, refracting the negative sheet beneath it. null without WebGL2. */
export function createGlass(canvas) {
  const pass = makePass(canvas, FRAG, ["uTex", "uRes", "uDpr", "uSide", "uDo", "uRi", "uStrength", "uChroma", "uBlur", "uLift", "uShape", "uTopR", "uSlope", "uIndex", "uDisp", "uReflect", "uLip", "uLipK", "uPad", "uCast", "uShade", "uShadeOff", "uSquig"]);
  if (!pass) return null;
  let size = 1;
  let meshKey = "";
  return {
    get dpr() { return pass.dpr; },
    /* the canvas is bigger than the glass by `pad` on every side, for the glass's shadow and light on the board */
    get pad() { return Math.round(size * PAD); },
    resize(cssSize, quality = 1) { size = cssSize; pass.resize(cssSize + 2 * Math.round(cssSize * PAD), quality); },
    /* view: the window canvas from raster.js, `side` css px across and centred on the glass;
       ringRadius: the eyepiece ring's outer radius */
    /* shape: 0 dome, 1 frustum. slope: the wall's angle from the board, in degrees. wall: the share of the glass ring
       that is the sloped wall (the rest, beside the black ring, is the flat top). index and dispersion: the glass.
       reflect: how much of the wall's mirror sheen shows. lip: width of the thick edge around the base, css px; lipK: its strength. cast: the glass's shadow and light on the board beside it (gone when lifted). */
    draw(view, side, ringRadius, lift = 0, { shape = 1, slope = 60, wall = 1, index = 1.49, dispersion = 0, reflect = 0.5, lip = 6, lipK = 1, cast = 1, ringShade = 0.6, ringShadeOff = 1, squig = 0.8 } = {}) {
      const rimWidth = size / 2 - ringRadius;
      const rimPad = Math.round(size * PAD);
      // Only the ring of glass and the margin around it need drawing: the middle is hidden under the black ring. So the
      // pass draws an annulus (a strip of thin triangles) instead of the whole square, about half the pixels.
      const key = `${size}|${rimPad}|${ringRadius}`;
      if (key !== meshKey) {
        meshKey = key;
        const N = 72, cw = size + 2 * rimPad;
        const rIn = ((ringRadius - 1.5) / cw) * 2, rOut = ((size / 2 + rimPad) / cw) * 2 / Math.cos(Math.PI / N);
        const v = [];
        for (let i = 0; i <= N; i++) {
          const a = (i / N) * Math.PI * 2, c = Math.cos(a), s = Math.sin(a);
          v.push(c * rIn, s * rIn, c * rOut, s * rOut);
        }
        pass.setStrip(v);
      }
      pass.upload(view, true);
      pass.draw((gl, U) => {
        gl.uniform1f(U.uSquig, squig);
        gl.uniform1f(U.uShade, ringShade);
        gl.uniform1f(U.uShadeOff, ringShadeOff);
        gl.uniform1f(U.uSide, side);
        gl.uniform1f(U.uDo, size);
        gl.uniform1f(U.uRi, ringRadius);
        gl.uniform1f(U.uStrength, rimWidth * 0.62);
        gl.uniform1f(U.uChroma, rimWidth * 0.09);
        gl.uniform1f(U.uBlur, 1.4);
        gl.uniform1f(U.uLift, lift);
        gl.uniform1f(U.uShape, shape);
        gl.uniform1f(U.uTopR, size / 2 - wall * rimWidth);
        gl.uniform1f(U.uSlope, (slope * Math.PI) / 180);
        gl.uniform1f(U.uIndex, index);
        gl.uniform1f(U.uDisp, dispersion);
        gl.uniform1f(U.uReflect, reflect);
        gl.uniform1f(U.uLip, lip);
        gl.uniform1f(U.uLipK, lipK);
        gl.uniform1f(U.uPad, rimPad);
        gl.uniform1f(U.uCast, cast);
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
