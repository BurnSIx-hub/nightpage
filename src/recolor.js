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

  const mapGradient = (value) => value.replace(/rgba?\([^)]*\)/g, (found) => {
    const rgba = parse(found);
    return rgba ? asCss(mapSurface(rgba), rgba[3]) : found;
  });

  const isLight = (rgba) => rgba && rgba[3] > 0.05 &&
    (rgba[0] + rgba[1] + rgba[2]) / 3 > 120;

  /* What we last wrote, so a value can never be mapped twice. If the
     site later sets a colour of its own the computed value stops
     matching and the element is worked out again from scratch. */
  const applied = new WeakMap();
  const touched = new Set();
  const framed = new WeakSet();

  /* Regions painted with a picture. Anything lying on one is left
     exactly as the site drew it: the artwork is not ours to read, so we
     cannot tell whether lightening the text on it helps or hides it.
     Amazon's deal cards are precisely this — the colour is a background
     image on one layer and the heading is HTML on another, which is how
     "Most loved picks for you" ended up pale on pale.

     Geometry rather than ancestry, because the artwork layer is usually
     a sibling of the text and not its parent. Rectangles are stored
     relative to the document so scrolling cannot invalidate them, and
     anything covering half the viewport is ignored — a full-page
     backdrop would otherwise switch the whole theme off. */
  let artwork = [];

  function rememberArtwork(el) {
    const r = el.getBoundingClientRect();
    if (r.width < 40 || r.height < 40) return;
    if (r.width * r.height > innerWidth * innerHeight * 0.5) return;
    if (artwork.length > 400) return;
    artwork.push({
      left: r.left + scrollX, right: r.right + scrollX,
      top: r.top + scrollY, bottom: r.bottom + scrollY
    });
  }

  function insideArtwork(el) {
    if (!artwork.length) return false;
    const r = el.getBoundingClientRect();
    if (!r.width && !r.height) return false;
    const x = r.left + r.width / 2 + scrollX;
    const y = r.top + r.height / 2 + scrollY;
    for (let i = 0; i < artwork.length; i++) {
      const a = artwork[i];
      if (x >= a.left && x <= a.right && y >= a.top && y <= a.bottom) return true;
    }
    return false;
  }

  /* An element can be judged artwork-covered only after the layer above
     it has been seen, so a later pass may have to take back what an
     earlier one wrote. */
  function unpaint(el) {
    const was = applied.get(el);
    if (!was) return;
    if (was.bg) el.style.removeProperty('background-color');
    if (was.ink) el.style.removeProperty('color');
    if (was.edge) el.style.removeProperty('border-color');
    if (was.grad) el.style.removeProperty('background-image');
    applied.set(el, {});
  }

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

  /* Pseudo-elements take no inline style, so the few that paint
     something light get a rule of their own in a sheet we own. They are
     keyed by tag and class, because pseudo styling comes from CSS rules
     and every element with the same signature therefore shares one
     verdict. Measured on an Amazon product page: 1237 signatures, of
     which 5 paint anything light — among them the divider whose white
     ::after gradient lay across the section headings as a bright band. */
  const pseudoIndex = new Map();
  let ownSheet = null;

  function sheetFor() {
    if (ownSheet) return ownSheet;
    const style = document.createElement('style');
    style.id = 'np-pseudo';
    (document.head || root).appendChild(style);
    ownSheet = style.sheet;
    return ownSheet;
  }

  function pseudoPaints(cs) {
    if (cs.content === 'none') return null;
    const decls = [];
    const bi = cs.backgroundImage;
    if (bi !== 'none' && bi.indexOf('gradient') !== -1) {
      const stops = bi.match(/rgba?\([^)]*\)/g) || [];
      if (stops.some((s) => isLight(parse(s)))) {
        decls.push('background-image:' + mapGradient(bi) + ' !important');
      }
    }
    const bg = parse(cs.backgroundColor);
    if (isLight(bg)) {
      decls.push('background-color:' + asCss(mapSurface(bg), bg[3]) + ' !important');
    }
    return decls.length ? decls.join(';') : null;
  }

  function pseudo(el) {
    const sig = el.tagName + '|' + String(el.className);
    let idx = pseudoIndex.get(sig);

    if (idx === undefined) {
      const rules = [];
      ['::before', '::after'].forEach((part) => {
        const decl = pseudoPaints(getComputedStyle(el, part));
        if (decl) rules.push([part, decl]);
      });
      idx = null;
      if (rules.length) {
        idx = pseudoIndex.size;
        const s = sheetFor();
        rules.forEach(([part, decl]) => {
          try {
            s.insertRule('[data-np-pe="' + idx + '"]' + part + '{' + decl + '}', s.cssRules.length);
          } catch (e) { /* нестандартный селектор — пропускаем */ }
        });
      }
      pseudoIndex.set(sig, idx);
    }

    if (idx !== null && el.getAttribute('data-np-pe') !== String(idx)) {
      el.setAttribute('data-np-pe', String(idx));
      touched.add(el);
    }
  }

  function process(el) {
    const media = el.tagName === 'IMG';
    if (SKIP.has(el.tagName) && !media) return;

    const cs = getComputedStyle(el);

    /* Blending is undone first, and for images as well as wrappers.
       Shops knock the white background out of a product shot with
       mix-blend-mode: multiply — invisible over the light card it was
       drawn for, fatal over a dark one. Jumping straight to the hairline
       left 32 images on Amazon's home page still multiplying against a
       dark card, which is exactly what dimmed them. */
    const blend = cs.mixBlendMode;
    if (blend === 'multiply' || blend === 'darken') {
      el.style.setProperty('mix-blend-mode', 'normal', 'important');
      touched.add(el);
    }

    if (media) { frame(el); return; }
    pseudo(el);

    const backdrop = cs.backgroundImage;
    if (backdrop !== 'none' && backdrop.indexOf('url(') !== -1) {
      rememberArtwork(el);
    } else if (insideArtwork(el)) {
      unpaint(el);
      return;
    }

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
      const out = mapGradient(grad);
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
    /* A pass over the whole document rebuilds the map of artwork; a pass
       over a subtree that has just arrived adds to the one we have. */
    if (node === root) artwork = [];
    process(node);
    const kids = node.children;
    for (let i = 0; i < kids.length; i++) walk(kids[i]);
  }

  /* Work is batched per frame: Amazon rewrites styles constantly, and
     answering every mutation on the spot costs more than it saves. */
  let queue = new Set();
  let scheduled = false;

  function flush() {
    if (!scheduled) return;
    scheduled = false;
    const batch = queue;
    queue = new Set();
    batch.forEach((el) => { if (el.isConnected) walk(el); });
  }

  function schedule(el) {
    queue.add(el);
    if (scheduled) return;
    scheduled = true;
    /* A tab that is not being looked at gets no animation frames at all,
       so on its own the queue would sit untouched until the tab came
       forward — and then repaint in front of the reader. The timer is
       the fallback; whichever arrives first does the work and the other
       finds nothing scheduled. */
    requestAnimationFrame(flush);
    setTimeout(flush, 200);
  }

  let observer = null;

  /* An element parsed before its stylesheet arrived was measured against
     the browser's defaults, and a stylesheet landing later fires no
     mutation of its own. So every sheet that loads asks for another
     pass. */
  function watchSheet(node) {
    if (node.tagName !== 'LINK') return;
    if (String(node.rel || '').toLowerCase().indexOf('stylesheet') === -1) return;
    node.addEventListener('load', () => schedule(root), { once: true });
  }

  function start() {
    root.classList.remove('np-off');
    walk(root);
    if (observer) return;

    observer = new MutationObserver((records) => {
      for (const record of records) {
        if (record.type === 'childList') {
          record.addedNodes.forEach((n) => {
            if (n.nodeType !== Node.ELEMENT_NODE) return;
            watchSheet(n);
            schedule(n);
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

    document.querySelectorAll('link').forEach(watchSheet);

    /* Two more passes at the loading milestones. The first catches
       anything whose styling settled late; the second catches images,
       which have no size until they arrive and so cannot be measured
       for their hairline before then. */
    document.addEventListener('DOMContentLoaded', () => schedule(root), { once: true });
    window.addEventListener('load', () => schedule(root), { once: true });

    /* Layout is measured for the artwork map and the hairlines, and a
       hidden tab has no layout worth measuring. Look again when it is
       shown. */
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden) schedule(root);
    });
  }

  function stop() {
    root.classList.add('np-off');
    if (observer) {
      observer.disconnect();
      observer = null;
    }
    touched.forEach((el) => {
      ['background-color', 'color', 'border-color', 'background-image',
       'box-shadow', 'fill', 'stroke', 'mix-blend-mode']
        .forEach((p) => el.style.removeProperty(p));
      el.removeAttribute('data-np-pe');
    });
    touched.clear();
    const style = document.getElementById('np-pseudo');
    if (style) style.remove();
    ownSheet = null;
    pseudoIndex.clear();
  }

  function apply(settings) {
    levels(settings.intensity);
    if (settings.enabled) start(); else stop();
  }

  /* Nothing here waits for DOMContentLoaded. The walk starts the moment
     the settings arrive and the observer picks elements up as the parser
     appends them, so the page darkens while it is still being built.
     Waiting for the document to finish first cost one to two seconds of
     the site's own light theme on Amazon. Docs never showed that,
     because its darkness comes from a stylesheet with no script in the
     path at all. */

  /* With no extension around it — dropped straight into a page to try
     it out — fall back to the defaults. */
  if (typeof chrome === 'undefined' || !chrome.storage) {
    apply(DEFAULTS);
    return;
  }

  chrome.storage.sync.get(DEFAULTS).then(apply);
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'sync') return;
    chrome.storage.sync.get(DEFAULTS).then(apply);
  });
})();
