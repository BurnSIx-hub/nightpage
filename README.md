# Nightpage

A Chrome extension (Manifest V3) that turns Google Docs and Amazon dark
without ruining the pictures on them.

It carries **two engines**, because the two sites need opposite treatments and
pretending otherwise makes both worse:

| | Google Docs | Amazon |
|---|---|---|
| approach | invert the page | recolour the elements |
| why | document text is painted into a `<canvas>`, so CSS cannot reach it | ordinary DOM, where inverting wrecks the photographs |
| images | restored by intercepting `drawImage` | never touched at all |

Neither engine knows a single class name of the site it themes, so a redesign
cannot leave half the interface light.

## Install

1. Open `chrome://extensions/`
2. Turn on **Developer mode** (top right)
3. **Load unpacked** → pick the `nightpage` folder
4. Open or reload a Docs or Amazon tab

After changing any file, hit reload on the extension card and refresh the tab.
Chrome remembers an unpacked extension by its path, so moving the folder means
loading it again from the new one.

## Where it runs

`https://docs.google.com/document/*`, and Amazon on seventeen domains — `.com`,
`.co.uk`, `.de`, `.fr`, `.it`, `.es`, `.nl`, `.pl`, `.se`, `.ca`, `.com.mx`,
`.com.br`, `.com.au`, `.co.jp`, `.in`, `.ae`, `.com.tr`. Add more by editing
`matches` in `manifest.json`.

## Controls

Clicking the toolbar icon opens the panel:

- the **switch** in the header turns the theme on and off;
- **Black level** sets how dark things get. On Docs it drives the contrast the
  filter applies before flipping; on Amazon it sets the band every neutral
  surface is squeezed into;
- **Keep image colors** restores photographs, diagrams and avatars instead of
  leaving them inverted. Docs only — on Amazon images are never inverted in the
  first place, so there is nothing to undo.

`Alt+Shift+D` toggles the theme. Rebind it at `chrome://extensions/shortcuts`.

Settings live in `chrome.storage.sync`, so they follow the Chrome profile and
apply to every open tab at once, without a reload.

## Google Docs — inversion

Since 2021 Google Docs paints document text into a `<canvas>` rather than DOM
nodes. Recolouring the letters with CSS is not possible — as elements they do
not exist. So the page is flipped with a filter:

```css
filter: contrast(var(--np-contrast)) invert(1) hue-rotate(180deg);
```

- `contrast()` runs first and pulls white and black toward grey, so the flipped
  sheet reads as softly dark instead of pure black. This is what the slider
  drives;
- `invert(1)` performs the flip;
- `hue-rotate(180deg)` puts hues back where they were — without it blue would
  come out orange.

The side benefit is that the whole Google interface falls under the same
filter, which is why no list of class names is needed.

### Images in the document

On Chromium, Docs paints images into the canvas too, so CSS cannot reach them
either. `src/canvas-images.js` handles that: it runs in the page world
(`world: "MAIN"`) and wraps `CanvasRenderingContext2D.drawImage`. Every image
is put through the inverse of the theme's filter before it is painted, so once
the page filter lands on top the image is back to how it started. Results are
cached in a `WeakMap` keyed by source — without it the work would repeat on
every tile repaint.

Docs moves text tiles through `drawImage` as well, but those sources are
canvases; the source type is what separates them, and only real images are
touched.

### The colour picker

Swatches are plain divs with an inline `background-color`, so the page filter
scrambled them: yellow read as beige, blue as almost black. A compensating
filter — the trick that works for images — fails here, because the palette is
made of pure colours, the corners of the gamut, and clamping each channel on
its own is what bends the hue. Mean error stayed near 20% across twelve tuned
variants.

`src/palette.js` picks the fill deliberately instead. Mid grey is the one
colour the filter maps to itself, so each swatch colour is walked along the
straight line out from mid grey as far as the gamut allows. The hue direction
is never bent: measured 0° error on all eight primaries, at the cost of
saturation, which no method can keep.

Docs' own `background-color` is never written to — the corrected colour goes
into a custom property and `dark.css` paints it as an overlay. Nothing else in
the DOM carries the colour, so that inline value may well be what Docs reads
when a swatch is clicked. Showing a wrong colour is cosmetic; applying one
would damage documents. The overlay hides the tick Docs draws on the selected
swatch as a background image, so the stylesheet redraws it.

### How the pieces talk

The content scripts live in different worlds and never message each other.
`content.js` sits in the isolated world and writes state into classes and a
custom property on `<html>`; `canvas-images.js` reads it from there through a
`MutationObserver`. `<html>` is shared anyway.

## Amazon — recolouring

Inversion was tried here first and fails both ways round. Amazon's tiles are
single pictures with the heading and a white background baked in, so restoring
images faithfully restores the white blocks with them — while not restoring
them leaves the goods in negative, and on a shop a wrong product colour is not
cosmetic.

So `src/recolor.js` inverts nothing. It reads each element's computed colours
and replaces them, never touching `img`, `video` or `canvas`, which is why
photographs come out right by construction rather than by compensation.

Three decisions carry most of the result:

**Grey is told from brand colour by chroma, not saturation.** HSL calls the
pale tint `#e7f3ff` fully saturated though it is plainly page furniture. The
plain spread between channels is honest: 0.09 for that tint against 0.92 for
the buy button's `#ffd814`. Below the threshold a colour is remapped into the
dark band; above it the brand colour is kept, capped so it stops glowing.

**Surfaces keep their ranking rather than flipping it**, so a white card still
sits above the grey page instead of sinking below it. Measured on Amazon's own
palette: nav `0.055`, page `0.137`, card `0.169`.

**Text is written only where an element sets its own colour.** The rest inherit
from a parent already dealt with, which keeps the walk to hundreds of nodes
instead of thousands.

### Two traps in other people's markup

Both looked like something they were not, and both are worth knowing about
before theming any site this way.

**`mix-blend-mode: multiply`.** Shops knock the white background out of a
product shot with it: multiplied against the light card it was designed for,
the white disappears and nothing else changes. Multiplied against a dark card
it swallows the whole picture. On Amazon this is what made "frequently bought
together" look like negatives — the pixels were never touched, the backdrop
under them was. `multiply` and `darken` are switched off, so the photograph
shows the white background it actually has.

**Pseudo-elements take no inline style.** A white gradient on
`hr.bucketDivider::after` lay across the section headings as a bright band, and
no amount of fixing the elements themselves could reach it. Those get rules in
a stylesheet of the extension's own, keyed by tag and class — pseudo styling
comes from CSS rules, so every element with the same signature shares one
verdict and one rule serves the group. Measured on a product page: 1237
signatures, of which 5 paint anything light, across 12 elements.

## Known limits

**Docs — saturated colours do not come back exactly.** `hue-rotate(180deg)` is
invertible as a matrix (verified: `H·H` is the identity), but it pushes
saturated colours outside the gamut, where they clip, and the inverse cannot
recover what was clipped. Measured round trips: green `#43a047` → `#45a248`,
blue `#1e88e5` → `#208adb`, brown `#6d4c41` → `#6e4d42`. Vivid yellow
`#fdd835` lands on `#e9c4ae` and red `#e53935` on `#c15652`. Raising **Black
level** narrows the gap; at maximum blue returns to `#1e88e6`. Doing the
compensation as a single `feColorMatrix` instead of a filter chain buys 0.3 of
a unit out of 255, so the code uses the chain.

**Docs — documents that are mostly photographs.** If colour fidelity matters,
turn the theme off for that tab; muted reds and yellows show most on photos.

**Docs — printing is untouched.** An `@media print` rule drops the filter, so
paper and PDF export get the normal light document.

**Amazon — light-on-dark widgets.** The recolouring rule is "light surface
becomes dark", which is right nearly everywhere but wrong where a site already
puts something light on a dark ground of its own. The video player's progress
bar is the known case: it dims.

**Amazon — product photographs keep their white backgrounds.** They are never
touched, so a white-backed shot stays a bright square on a dark page. Images
past 80px get a hairline outline so a dark product does not bleed into the
page.

**Performance.** On Docs, a filter on the root element makes the browser
repaint a composited layer; on weak integrated graphics very large documents
may feel slightly less responsive while typing. On Amazon the first pass walks
the document once and then works per frame from a mutation observer.

## Files

```
nightpage/
├── manifest.json
├── icons/               16/32/48/128
└── src/
    ├── dark.css         Docs: the filter, and the fixes on top of it
    ├── content.js       Docs: settings → classes and a custom property
    ├── canvas-images.js Docs: drawImage interception, page world
    ├── palette.js       Docs: colour picker swatches
    ├── recolor.css      Amazon: the base coat
    ├── recolor.js       Amazon: the recolouring engine
    ├── background.js    defaults and the keyboard shortcut
    └── popup.*          the control panel
```

## Adding another site

For a site built out of DOM, point the recolouring engine at it — add the
domain to the third `content_scripts` block in `manifest.json`. Nothing in
`recolor.js` is Amazon-specific.

Inversion is only worth reaching for when a site paints its text somewhere CSS
cannot follow, as Docs does. Google Sheets is a poor fit for either: inversion
repaints cell fills, and conditional formatting loses the meaning its colours
carried.

## License

[MIT](LICENSE).

Not affiliated with, endorsed by, or sponsored by Google or Amazon. Google Docs
is a trademark of Google LLC and Amazon is a trademark of Amazon.com, Inc.,
used here only to describe what this extension works with.
