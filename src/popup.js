const DEFAULTS = { enabled: true, intensity: 30, keepMedia: true };

const $ = (id) => document.getElementById(id);
const enabled = $('enabled');
const intensity = $('intensity');
const intensityOut = $('intensity-out');
const keepMedia = $('keepMedia');
const preview = $('preview');
const body = $('body');

/* То же преобразование, что в content.js: 0..100 → 0.72..1.0 */
const contrastFor = (v) => 0.72 + Math.min(100, Math.max(0, v)) * 0.0028;

/* Куда после contrast() + invert() уедут белый лист и чёрные буквы.
   Формула: значение v → 255 - ((v - 127.5) * c + 127.5). */
function paint(v) {
  const c = contrastFor(v);
  const page = Math.round(127.5 * (1 - c));
  const text = Math.round(127.5 * (1 + c));
  preview.style.background = `rgb(${page},${page},${page})`;
  preview.style.color = `rgb(${text},${text},${text})`;
  intensityOut.textContent = v;
}

function render(settings) {
  enabled.checked = settings.enabled;
  intensity.value = settings.intensity;
  keepMedia.checked = settings.keepMedia;
  body.dataset.disabled = String(!settings.enabled);
  paint(Number(settings.intensity));
}

const save = (patch) => chrome.storage.sync.set(patch);

chrome.storage.sync.get(DEFAULTS).then(render);

enabled.addEventListener('change', () => {
  body.dataset.disabled = String(!enabled.checked);
  save({ enabled: enabled.checked });
});

intensity.addEventListener('input', () => {
  const v = Number(intensity.value);
  paint(v);
  save({ intensity: v });
});

keepMedia.addEventListener('change', () => save({ keepMedia: keepMedia.checked }));

$('reset').addEventListener('click', async () => {
  await chrome.storage.sync.set(DEFAULTS);
  render(DEFAULTS);
});

$('shortcut').addEventListener('click', () => {
  chrome.tabs.create({ url: 'chrome://extensions/shortcuts' });
});
