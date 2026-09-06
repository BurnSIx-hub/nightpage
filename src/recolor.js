/* Recolouring engine — for ordinary sites built out of DOM.

   The inversion used for Google Docs is a last resort: there the text
   lives in a canvas and nothing else can reach it. On a normal site
   inversion is the wrong tool, and Amazon shows why. Its home page
   carries 236 images, and its tiles are single pictures with the
   heading and a white background baked in — so restoring images
   faithfully restores the white blocks with them, while not restoring
   them leaves the goods in negative. On a shop, wrong product colours
   are not cosmetic.

   So nothing is inverted here. Every element's computed colours are
   read and replaced: light surfaces become dark ones, dark ink becomes
   light. Images, video and canvases are never touched at all, which is
   why photographs come out perfect by construction rather than by
   compensation.

   No class names are used, so this behaves the same on the home page,
   in search and on a product page, and it survives a redesign. */

(() => {
  const DEFAULTS = { enabled: true, intensity: 30 };
  const root = document.documentElement;

  /* Elements that carry pixels of their own, or no paint at all. */
  const SKIP = new Set([
    'IMG', 'PICTURE', 'SOURCE', 'VIDEO', 'AUDIO', 'TRACK', 'CANVAS', 'SVG',
    'IFRAME', 'EMBED', 'OBJECT', 'SCRIPT', 'STYLE', 'LINK', 'META', 'HEAD',
    'TITLE', 'BR', 'NOSCRIPT'
  ]);

  /* HSL calls a pale tint highly saturated, so saturation cannot decide
     what counts as grey. Chroma — the plain spread between the channels
     — can: #e7f3ff scores 0.09 and is page furniture, #ffd814 scores
     0.92 and is a brand colour worth keeping. */
  const NEUTRAL = 0.15;

  /* The band every neutral surface is squeezed into. Measured against a
     mock of Amazon's own colours: the earlier 0.10–0.28 band left a
     white card at #3d3d3d, mid grey rather than dark. */
  let floorL = 0.054;
  let ceilL = 0.170;

  function levels(intensity) {
    const k = Math.min(100, Math.max(0, Number(intensity) || 0)) / 100;
    floorL = 0.06 - 0.02 * k;
    ceilL = 0.20 - 0.10 * k;
  }

  function parse(value) {
    const m = String(value).match(
      /^rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)(?:[,\s/]+([\d.]+))?/);
    if (!m) return null;
    return [+m[1], +m[2], +m[3], m[4] === undefined ? 1 : parseFloat(m[4])];
  }

  function toHsl(r, g, b) {
    r /= 255; g /= 255; b /= 255;
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    const l = (max + min) / 2;
    const chroma = max - min;
    if (!chroma) return [0, 0, l, 0];
    const s = l > 0.5 ? chroma / (2 - max - min) : chroma / (max + min);
    let h;
    if (max === r) h = ((g - b) / chroma) % 6;
    else if (max === g) h = (b - r) / chroma + 2;
    else h = (r - g) / chroma + 4;
    return [((h * 60) + 360) % 360, s, l, chroma];
  }

  function toRgb(h, s, l) {
    h = ((h % 360) + 360) % 360;
    const c = (1 - Math.abs(2 * l - 1)) * s;
    const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
    const m = l - c / 2;
    const t = h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x]
            : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x];
    return t.map((v) => Math.round((v + m) * 255));
  }

  /* Surfaces. Greys keep their original ranking, so a white card still
     sits above the grey page it lies on rather than sinking below it.
     Brand colours are kept, and only pulled down when they would glow. */
  function mapSurface(rgb) {
    const [h, s, l, chroma] = toHsl(rgb[0], rgb[1], rgb[2]);
    if (chroma < NEUTRAL) {
      return toRgb(h, Math.min(s, 0.08),
        floorL + (ceilL - floorL) * Math.pow(l, 3));
    }
    /* Kept, but not left glowing. Amazon's buy button is #ffd814 at
       lightness 0.54, which on a dark page reads as a lamp rather than
       a button, so saturated surfaces are capped well below that. */
    return toRgb(h, Math.min(s, 0.85), Math.min(Math.max(l, 0.20), 0.45));
  }

  /* Ink. Darker text was the more important text, so that ranking is
     kept as well — headings stay brighter than captions. Text that is
     already light is left alone: it was sitting on something dark, and
     surfaces that started dark stay dark. */
  function mapInk(rgb) {
    const [h, s, l, chroma] = toHsl(rgb[0], rgb[1], rgb[2]);
    if (l >= 0.5) return null;
    if (chroma < NEUTRAL) return toRgb(h, Math.min(s, 0.06), 0.92 - 0.45 * l);
    return toRgb(h, Math.min(s, 0.75), Math.max(l, 0.62));
  }

  function mapEdge(rgb) {
    const [h, s, l, chroma] = toHsl(rgb[0], rgb[1], rgb[2]);
    if (chroma < NEUTRAL) return toRgb(h, Math.min(s, 0.06), 0.26);
    return toRgb(h, s, Math.min(l, 0.45));
  }

  const asCss = (rgb, a) => a >= 1
    ? 'rgb(' + rgb.join(', ') + ')'
    : 'rgba(' + rgb.join(', ') + ', ' + a + ')';

  /* What we last wrote, so a value can never be mapped twice. If the
     site later sets a colour of its own the computed value stops
     matching and the element is worked out again from scratch. */
  const applied = new WeakMap();
  const touched = new Set();
  const framed = new WeakSet();

  const SVG_NS = 'http://www.w3.org/2000/svg';

  /* A dark product shot used to be framed by the light card behind it.
     Now that the card is dark as well the photo bleeds into the page,
     so anything large enough to be a photograph gets a hairline of its
     own. The pixels are still never touched. */
  function frame(el) {
    if (framed.has(el)) return;
    const box = el.getBoundingClientRect();
    if (box.width < 80 || box.height < 80) return;
    el.style.setProperty('box-shadow', '0 0 0 1px rgba(255, 255, 255, 0.10)', 'important');
    framed.add(el);
    touched.add(el);
  }

  function process(el) {
    if (el.tagName === 'IMG') { frame(el); return; }
    if (SKIP.has(el.tagName)) return;

    const cs = getComputedStyle(el);
    const was = applied.get(el) || {};
    const now = {};

    const bg = cs.backgroundColor;
    if (bg === was.bg) {
      now.bg = was.bg;
    } else {
      const rgba = parse(bg);
      if (rgba && rgba[3] > 0.02) {
        const out = asCss(mapSurface(rgba), rgba[3]);
        if (out !== bg) {
          el.style.setProperty('background-color', out, 'important');
          now.bg = out;
        }
      }
    }

    /* Gradients. Amazon paints its buttons with them, and shows loading
       placeholders as a pale grey sweep — left alone those stay light
       and lie across the page as bright bands. Only the colour stops
       are rewritten, so any url() layer in the same shorthand survives. */
    const grad = cs.backgroundImage;
    if (grad === was.grad) {
      now.grad = was.grad;
    } else if (grad.indexOf('gradient') !== -1) {
      const out = grad.replace(/rgba?\([^)]*\)/g, (found) => {
        const rgba = parse(found);
        return rgba ? asCss(mapSurface(rgba), rgba[3]) : found;
      });
      if (out !== grad) {
        el.style.setProperty('background-image', out, 'important');
        now.grad = out;
      }
    }

    /* Icons drawn as SVG carry their colour in fill and stroke, not in
       `color`. Amazon's wishlist heart is a 60px path filled #000, so
       without this it stays black on a black page. Small ones only —
       a large SVG is more likely a picture than a glyph. */
    if (el.namespaceURI === SVG_NS) {
      const box = el.getBoundingClientRect();
      if (box.width <= 96 && box.height <= 96) {
        ['fill', 'stroke'].forEach((prop) => {
          const value = cs[prop];
          if (value === was[prop]) { now[prop] = was[prop]; return; }
          if (!value || value === 'none') return;
          const rgba = parse(value);
          const mapped = rgba && mapInk(rgba);
          if (!mapped) return;
          const out = asCss(mapped, rgba[3]);
          el.style.setProperty(prop, out, 'important');
          now[prop] = out;
        });
      }
    }

    const ink = cs.color;
    if (ink === was.ink) {
      now.ink = was.ink;
    } else {
      /* Only elements that set a colour of their own are written to;
         the rest inherit what their parent was already given. Document
         order means the parent has been dealt with by the time we look. */
      const parent = el.parentElement;
      const inherited = parent ? getComputedStyle(parent).color : null;
      if (ink !== inherited) {
        const rgba = parse(ink);
        const mapped = rgba && mapInk(rgba);
        if (mapped) {
          const out = asCss(mapped, rgba[3]);
          el.style.setProperty('color', out, 'important');
          now.ink = out;
        }
      }
    }

    const framed = parseFloat(cs.borderTopWidth) || parseFloat(cs.borderBottomWidth)
                || parseFloat(cs.borderLeftWidth) || parseFloat(cs.borderRightWidth);
    if (framed) {
      const edge = cs.borderTopColor;
      if (edge === was.edge) {
        now.edge = was.edge;
      } else {
        const rgba = parse(edge);
        if (rgba && rgba[3] > 0.02) {
          const out = asCss(mapEdge(rgba), rgba[3]);
          if (out !== edge) {
            el.style.setProperty('border-color', out, 'important');
            now.edge = out;
          }
        }
      }
    }

    if (now.bg || now.ink || now.edge || now.grad || now.fill || now.stroke) {
      touched.add(el);
    }
    applied.set(el, now);
  }

  function walk(node) {
    if (node.nodeType !== Node.ELEMENT_NODE) return;
    process(node);
    const kids = node.children;
    for (let i = 0; i < kids.length; i++) walk(kids[i]);
  }

  /* Work is batched per frame: Amazon rewrites styles constantly, and
     answering every mutation on the spot costs more than it saves. */
  let queue = new Set();
  let scheduled = false;

  function flush() {
    scheduled = false;
    const batch = queue;
    queue = new Set();
    batch.forEach((el) => { if (el.isConnected) walk(el); });
  }

  function schedule(el) {
    queue.add(el);
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(flush);
  }

  let observer = null;

  function start() {
    root.classList.remove('np-off');
    walk(root);
    if (observer) return;
    observer = new MutationObserver((records) => {
      for (const record of records) {
        if (record.type === 'childList') {
          record.addedNodes.forEach((n) => {
            if (n.nodeType === Node.ELEMENT_NODE) schedule(n);
          });
        } else if (record.target.nodeType === Node.ELEMENT_NODE) {
          schedule(record.target);
        }
      }
    });
    observer.observe(root, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['style', 'class', 'src']
    });

    /* Images have no size until they arrive, and a photograph cannot be
       measured for its hairline before then. One more pass once the
       page has finished loading catches them. */
    window.addEventListener('load', () => { if (observer) walk(root); }, { once: true });
  }

  function stop() {
    root.classList.add('np-off');
    if (observer) {
      observer.disconnect();
      observer = null;
    }
    touched.forEach((el) => {
      ['background-color', 'color', 'border-color', 'background-image',
       'box-shadow', 'fill', 'stroke'].forEach((p) => el.style.removeProperty(p));
    });
    touched.clear();
  }

  function apply(settings) {
    levels(settings.intensity);
    if (settings.enabled) start(); else stop();
  }

  function ready(fn) {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', fn, { once: true });
    } else {
      fn();
    }
  }

  /* With no extension around it — dropped straight into a page to try
     it out — fall back to the defaults. */
  if (typeof chrome === 'undefined' || !chrome.storage) {
    ready(() => apply(DEFAULTS));
    return;
  }

  chrome.storage.sync.get(DEFAULTS).then((s) => ready(() => apply(s)));
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'sync') return;
    chrome.storage.sync.get(DEFAULTS).then(apply);
  });
})();
