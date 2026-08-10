/* Giving images their colors back — runs in the page world (world: MAIN).

   On Chromium, Google Docs paints everything into a <canvas>, images
   included: there are no <img> elements for them in the DOM and CSS
   cannot reach them. So the drawImage call itself is intercepted here.
   Each source is run through the inverse of the theme's filter before
   it is painted; once the page filter lands on top, the image comes
   back to how it started.

   Docs moves text tiles through drawImage as well, but those sources
   are canvases — the source type is what separates them. Only real
   images are touched. */

(() => {
  const CANVAS_DRAW = CanvasRenderingContext2D.prototype.drawImage;
  const root = document.documentElement;

  /* State is read straight off <html>, where content.js writes it.
     Recomputed on mutation rather than on every drawImage — Docs
     calls that hundreds of times per repaint. */
  const state = { contrast: null };

  function refresh() {
    const on = !root.classList.contains('np-off') &&
               root.classList.contains('np-keep-media');
    const prev = state.contrast;

    if (!on) {
      state.contrast = null;
    } else {
      const raw = parseFloat(root.style.getPropertyValue('--np-contrast'));
      state.contrast = raw > 0 ? raw : 0.804;
    }

    /* Tiles already painted will not refresh on their own. Docs
       repaints them on a size change, so that is what we trigger. */
    if (prev !== state.contrast) {
      window.dispatchEvent(new Event('resize'));
    }
  }

  refresh();
  new MutationObserver(refresh).observe(root, {
    attributes: true,
    attributeFilter: ['class', 'style']
  });

  /* The inverse of the theme's contrast(c) invert(1) hue-rotate(180deg):
     the same functions in reverse, with contrast compensated by 1/c.

     Recovery is not exact. hue-rotate is invertible as a matrix (H·H is
     the identity), but it pushes saturated colors outside the gamut and
     they clip there — a property of the filter, not a flaw in the
     compensation. Mid tones, greens, blues and skin tones come back
     within a unit or two; vivid reds and yellows stay muted. The higher
     the black level, the smaller the gap. */
  const filterFor = (c) =>
    'hue-rotate(180deg) invert(1) contrast(' + (1 / c).toFixed(4) + ')';

  const cache = new WeakMap();   // source → { contrast, canvas }

  function preInverted(source, contrast) {
    const cached = cache.get(source);
    if (cached && cached.contrast === contrast) return cached.canvas;

    const w = source.naturalWidth || source.width;
    const h = source.naturalHeight || source.height;
    if (!w || !h) return null;               // not loaded yet

    const buffer = document.createElement('canvas');
    buffer.width = w;
    buffer.height = h;
    const ctx = buffer.getContext('2d');
    ctx.filter = filterFor(contrast);
    CANVAS_DRAW.call(ctx, source, 0, 0, w, h);

    cache.set(source, { contrast, canvas: buffer });
    return buffer;
  }

  const isImage = (s) =>
    (typeof HTMLImageElement !== 'undefined' && s instanceof HTMLImageElement) ||
    (typeof SVGImageElement !== 'undefined' && s instanceof SVGImageElement) ||
    (typeof ImageBitmap !== 'undefined' && s instanceof ImageBitmap);

  /* Each context is wrapped around its own original: handing the
     OffscreenCanvas method a function taken from the regular canvas
     would throw. */
  function wrap(original) {
    return function drawImage(source, ...rest) {
      const contrast = state.contrast;
      if (contrast !== null && isImage(source)) {
        try {
          const pre = preInverted(source, contrast);
          if (pre) return original.call(this, pre, ...rest);
        } catch (e) {
          /* Whatever went wrong, paint the way Docs meant to.
             Breaking the document is worse than a negative image. */
        }
      }
      return original.call(this, source, ...rest);
    };
  }

  CanvasRenderingContext2D.prototype.drawImage = wrap(CANVAS_DRAW);

  /* In case Docs paints through an OffscreenCanvas on the main thread. */
  if (typeof OffscreenCanvasRenderingContext2D !== 'undefined') {
    const offscreen = OffscreenCanvasRenderingContext2D.prototype;
    offscreen.drawImage = wrap(offscreen.drawImage);
  }
})();
