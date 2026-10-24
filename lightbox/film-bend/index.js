/* The one door into film-bend/: everything the rest of the page may use from here. Nothing outside this folder imports any other file in it.
 * See README.md for what each file does and every place outside the folder that touches the bend. */

export * from "./shape.js";                                                                   // the numbers and the shape (also read by how-film-bends.html)
export { createBendPhysics } from "./physics.js";                                             // film.js: when and how much film bends, what it does to the eyepiece
export { bindHost, bentBounds, drawBentStrip, holeFade, liftedPatches, paintBendShadows } from "./draw.js";   // raster.js, lightbox.js: painting it
export { createBendLayers } from "./layers.js";                                               // lightbox.js: the page's canvases for bent strips
export { createWop } from "./sound.js";                                                       // sounds.js: the womp
