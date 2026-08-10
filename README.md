# Nightpage

A Chrome extension (Manifest V3) that turns Google Docs dark — the document
and the interface around it: menus, toolbar, sidebars, dialogs, comments and
the document list.

Unlike themes built from selector overrides, Nightpage does not know a single
Google class name, so a redesign on their side cannot leave half the UI light.
And unlike every dark theme that stops at the canvas, it gives the colors back
to images inside the document.

## Install

1. Open `chrome://extensions/`
2. Turn on **Developer mode** (top right)
3. **Load unpacked** → pick the `nightpage` folder
4. Open or reload a document

After changing any file, hit reload on the extension card and refresh the Docs
tab.

## Controls

Clicking the toolbar icon opens the panel:

- the **switch** in the header turns the theme on and off;
- **Black level** sets how dark the sheet gets — grey (`#242424`) at the left,
  near-black at the right. The swatch below the slider previews the result;
- **Keep image colors** restores photos, diagrams and avatars instead of
  leaving them inverted.

`Alt+Shift+D` toggles the theme. Rebind it at `chrome://extensions/shortcuts`.

Settings live in `chrome.storage.sync`, so they follow the Chrome profile and
apply to every open tab at once, without a reload.

## How it works

Since 2021 Google Docs paints document text into a `<canvas>` rather than DOM
nodes. Recoloring the letters with CSS is not possible — as elements they do
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

The side benefit is that the whole Google UI falls under the same filter, which
is why no list of class names is needed and why redesigns do not break it.

### Images

Images are a separate problem. On Chromium, Docs paints them into the canvas
too, so CSS cannot reach them. `src/canvas-images.js` handles that: it runs in
the page world (`world: "MAIN"`) and wraps
`CanvasRenderingContext2D.drawImage`. Every image is run through the inverse of
the theme's filter before it is painted, so once the page filter lands on top,
the image is back to how it started. Results are cached in a `WeakMap` keyed by
source — without it the work would repeat on every tile repaint.

Docs moves text tiles through `drawImage` as well, but those sources are
canvases; the source type is what separates them, and only real images are
touched.

DOM elements — collaborator avatars, menu previews — are handled the simpler
way, with a CSS filter of their own: a child filter runs before its parent's.

The two content scripts live in different worlds and never talk directly.
`content.js` sits in the isolated world and writes state into classes and a
custom property on `<html>`; `canvas-images.js` reads it from there through a
`MutationObserver`. No message passing needed — `<html>` is shared anyway.

## Known limits

- **Saturated colors do not come back exactly.** `hue-rotate(180deg)` is
  invertible as a matrix (verified: `H·H` is the identity), but it pushes
  saturated colors outside the gamut, where they clip. The inverse cannot
  recover what was clipped. Measured round trips: green `#43a047` → `#45a248`,
  blue `#1e88e5` → `#208adb`, brown `#6d4c41` → `#6e4d42` — mid tones, greens,
  blues and skin tones return within a unit or two. Vivid yellow `#fdd835`
  lands on `#e9c4ae` and red `#e53935` on `#c15652`.

  Raising **Black level** narrows the gap: at maximum, blue returns to
  `#1e88e6`. Doing the compensation as a single `feColorMatrix` instead of a
  filter chain buys 0.3 of a unit out of 255 — not worth the complexity, so the
  code uses the chain.
- **Documents that are mostly photographs.** If color fidelity matters there,
  turn the theme off for that tab; muted reds and yellows are most visible on
  photos.
- **Printing** is untouched — an `@media print` rule drops the filter, so paper
  and PDF export get the normal light document.
- **Performance.** A filter on the root element makes the browser repaint a
  composited layer. On weak integrated graphics, very large documents may feel
  slightly less responsive while typing.

## Files

```
nightpage/
├── manifest.json
├── icons/               16/32/48/128
└── src/
    ├── dark.css         the filter and the fixes on top of it
    ├── content.js       settings → classes and a custom property on <html>
    ├── canvas-images.js drawImage interception, page world
    ├── background.js    defaults and the keyboard shortcut
    └── popup.*          the control panel
```

## Other Google services

Nightpage only runs on `https://docs.google.com/document/*`. To darken Sheets
and Slides, add them to `matches` in `manifest.json`:

```json
"matches": [
  "https://docs.google.com/document/*",
  "https://docs.google.com/spreadsheets/*",
  "https://docs.google.com/presentation/*"
]
```

Sheets is the less comfortable case: inversion repaints cell fills too, and
conditional formatting loses the meaning its colors carried.

## License

[MIT](LICENSE).

Not affiliated with, endorsed by, or sponsored by Google. Google Docs is a
trademark of Google LLC, used here only to describe what this extension works
with.
