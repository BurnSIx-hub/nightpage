/* Repainting the colour picker.

   The picker's swatches are plain divs carrying an inline
   background-color, so the page filter transforms them along with
   everything else and the palette comes out scrambled: yellow reads as
   beige, blue as almost black.

   Compensating with a filter, the trick used for images, fails here.
   The palette is made of pure colours — the corners of the gamut — and
   inverting with a hue rotation throws them outside it. Clamping each
   channel on its own is what destroys the hue. Measured mean error
   stayed near 20% however the filter was tuned.

   What works is choosing the fill deliberately. Mid grey is the one
   colour the theme's filter maps to itself, so every swatch colour is
   walked along the straight line out from mid grey, as far as the gamut
   allows. The hue direction is never bent, so hues land exactly
   (measured: 0° error on all eight primaries) and only saturation is
   given up.

   Docs' own background-color is never written to. The corrected colour
   goes into a custom property and dark.css paints it as an overlay.
   Nothing else in the DOM carries the colour — no data attribute, no
   hex anywhere — so that inline value may well be what Docs reads when
   a swatch is clicked. Showing the wrong colour is cosmetic; applying
   the wrong colour would damage documents. */

const NP_SWATCH = '.docs-material-colorpalette-colorswatch';
const npRoot = document.documentElement;

/* hue-rotate(180deg) from the Filter Effects spec, with cos = -1, sin = 0. */
const NP_HUE180 = [
  [-0.574, 1.430, 0.144],
  [ 0.426, 0.430, 0.144],
  [ 0.426, 1.430, -0.856]
];

function npContrast() {
  const raw = parseFloat(npRoot.style.getPropertyValue('--np-contrast'));
  return raw > 0 ? raw : 0.804;
}

/* The fill that makes the page filter display `rgb` — or, where the
   gamut will not reach that far, the closest colour of the same hue. */
function npFillFor(rgb, c) {
  const v = rgb.map((x) => x / 255 - 0.5);
  const w = NP_HUE180.map((row) =>
    -(1 / c) * (row[0] * v[0] + row[1] * v[1] + row[2] * v[2]));

  let t = 1;
  for (const wi of w) {
    if (Math.abs(wi) > 1e-6) t = Math.min(t, 0.5 / Math.abs(wi));
  }

  return w.map((wi) => {
    const x = Math.round((0.5 + t * wi) * 255);
    return Math.max(0, Math.min(255, x));
  });
}

function npParse(css) {
  const m = String(css).match(/^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/);
  return m ? [+m[1], +m[2], +m[3]] : null;
}

function npPaint(swatch, c) {
  const css = swatch.style.backgroundColor;   /* Docs writes it inline */
  if (!css) return false;

  const stamp = css + '@' + c;
  if (swatch.dataset.npSource === stamp) return true;

  const rgb = npParse(css);
  if (!rgb) return false;

  swatch.style.setProperty('--np-swatch', 'rgb(' + npFillFor(rgb, c).join(',') + ')');
  swatch.dataset.npSource = stamp;
  return true;
}

/* The tick on the selected swatch is a background-image, which the
   overlay hides, so dark.css draws its own. Its two colours are fixed
   for a given black level — light on dark swatches, dark on light ones. */
function npRefreshTicks(c) {
  npRoot.style.setProperty('--np-check-on-dark',
    'rgb(' + npFillFor([255, 255, 255], c).join(',') + ')');
  npRoot.style.setProperty('--np-check-on-light',
    'rgb(' + npFillFor([32, 33, 36], c).join(',') + ')');
}

function npScan(node, c) {
  if (node.matches && node.matches(NP_SWATCH) && !npPaint(node, c)) {
    /* Created before its colour was set — look again next frame. */
    requestAnimationFrame(() => npPaint(node, npContrast()));
  }
  if (!node.querySelectorAll) return;
  node.querySelectorAll(NP_SWATCH).forEach((s) => {
    if (!npPaint(s, c)) requestAnimationFrame(() => npPaint(s, npContrast()));
  });
}

let npLastContrast = npContrast();
npRefreshTicks(npLastContrast);
npScan(document, npLastContrast);

/* Palettes are built the first time a colour menu is opened, and rebuilt
   after that, so watch for them arriving. Attributes are deliberately not
   watched: Docs rewrites inline styles across the editor constantly, and
   filtering that firehose costs more than it saves. */
new MutationObserver((records) => {
  const c = npContrast();
  for (const record of records) {
    record.addedNodes.forEach((node) => {
      if (node.nodeType === Node.ELEMENT_NODE) npScan(node, c);
    });
  }
}).observe(npRoot, { childList: true, subtree: true });

/* Moving the black level changes what every fill has to be. */
new MutationObserver(() => {
  const c = npContrast();
  if (c === npLastContrast) return;
  npLastContrast = c;
  npRefreshTicks(c);
  npScan(document, c);
}).observe(npRoot, { attributes: true, attributeFilter: ['style'] });
