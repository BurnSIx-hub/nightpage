/* Reads the settings and turns them into classes and a custom property
   on <html>. The styling itself lives in dark.css and is injected at
   document_start, so the theme is there before the first paint — this
   script only takes it off when the user has turned it off. */

const DEFAULTS = { enabled: true, intensity: 30, keepMedia: true };

const root = document.documentElement;
let current = DEFAULTS;

/* intensity 0..100 → contrast 0.72..1.0
   0.72 leaves the sheet light grey (#242424), 1.0 makes it black. */
function contrastFor(intensity) {
  const clamped = Math.min(100, Math.max(0, Number(intensity) || 0));
  return (0.72 + clamped * 0.0028).toFixed(3);
}

function apply(settings) {
  current = settings;
  root.classList.toggle('np-off', !settings.enabled);
  root.classList.toggle('np-keep-media', !!settings.keepMedia);
  root.style.setProperty('--np-contrast', contrastFor(settings.intensity));
}

chrome.storage.sync.get(DEFAULTS).then(apply);

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'sync') return;
  chrome.storage.sync.get(DEFAULTS).then(apply);
});

/* Docs rewrites attributes on <html> as it loads and may drop our
   classes. Put them back — but only when they are actually missing,
   or the observer would keep waking itself up. */
const observer = new MutationObserver(() => {
  const wantOff = !current.enabled;
  const wantMedia = !!current.keepMedia;
  if (root.classList.contains('np-off') !== wantOff ||
      root.classList.contains('np-keep-media') !== wantMedia ||
      !root.style.getPropertyValue('--np-contrast')) {
    apply(current);
  }
});
observer.observe(root, { attributes: true, attributeFilter: ['class', 'style'] });
