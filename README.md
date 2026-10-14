# LightBox

A contact sheet of film negatives lying on a light box. Slide the eyepiece over them to see the photos as positives.

- **Drag** the eyepiece to slide it. **Double-press and hold** the glass to lift it off the board.
- **Double-press and turn** the black ring to change the magnification.
- **Push the eyepiece against the top or bottom edge** of the window while dragging and the page scrolls; the harder you push, the faster.
- **Grab a film strip** to move it; the **Organize** button puts the film back.

## The rules

`PHYSICS.md` lists every rule the page follows (how light, glass, film and the buttons behave with each other), with the file each
lives in. A new rule is documented there and in the code beside it.

## Run it

```sh
python3 serve.py          # http://localhost:8000, never cached, so a plain refresh shows your edits
```

On localhost the Sliders bar is shown. On the published page only Organize is (add `?sliders` to the address to bring the sliders back).

## Photos

The page loads small versions of every photo, and only fetches a sharper one when the eyepiece is magnified enough to need it.
After adding or changing photos in `sample-photos/` (and listing them in `photos.json`), make the small versions:

```sh
tools/make-images.sh sample-photos     # needs ffmpeg; writes sample-photos/thumb and sample-photos/mid
```

The deploy does this itself, and only publishes `thumb/` and `mid/`, not the full-size originals.

## Install and offline (PWA)

`manifest.webmanifest`, `sw.js` and `icons/` make it an installable app that opens offline. The service worker is not
registered on localhost (it would hold on to old code while you edit); add `?pwa` to try it there.

## Performance

While the eyepiece is moving the page watches its frame time and, if a device cannot keep up, draws the two glass passes
with fewer pixels, stepping back up when it can. Add `?fixedquality` to switch that off, or `?quality=0` to `?quality=4`
(full to lowest) to hold a level and see how it looks.

## Sounds

The lift and the set-down play recordings of real glass (`audio/glass-lift.wav`, `audio/glass-place.wav`); every other sound is
synthesised, and the synthesised lift and set-down are the fallback if a recording is missing.

## Local-only audio

Longer recordings and clips still being auditioned live in `local-audio/` (not committed, not published), including the saved
glass-drag sample, which is switched off (`GLASS_DRAG_ENABLED` in `lightbox/sounds.js`). They play on localhost only.
