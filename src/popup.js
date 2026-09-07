const DEFAULTS = { enabled: true, intensity: 30, keepMedia: true };

const $ = (id) => document.getElementById(id);
const enabled = $('enabled');
const intensity = $('intensity');
const intensityOut = $('intensity-out');
const keepMedia = $('keepMedia');
const preview = $('preview');
const body = $('body');

/* The same mapping content.js uses: 0..100 → 0.72..1.0 */
const contrastFor = (v) => 0.72 + Math.min(100, Math.max(0, v)) * 0.0028;

/* Where contrast() + invert() will land the white sheet and the black
   letters. Per channel: v → 255 - ((v - 127.5) * c + 127.5). */
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

/* chrome.storage.sync counts writes and refuses more than a hundred or
   so a minute. The slider fires input on every step of a drag, and one
   sweep across the range was enough to spend the whole quota and leave
   the panel throwing MAX_WRITE_OPERATIONS_PER_MINUTE.

   So the slider paints at once — the panel and the page stay live — but
   only the value it comes to rest on is written. Switches and
   checkboxes are single events and go straight through, since a popup
   can be shut the instant one is clicked. Anything still waiting is
   written out if that happens. */
const saveNow = (patch) => chrome.storage.sync.set(patch).catch(() => {});

let waiting = null;
let timer = 0;

function flush() {
  clearTimeout(timer);
  if (!waiting) return;
  const patch = waiting;
  waiting = null;
  saveNow(patch);
}

function saveSoon(patch) {
  waiting = Object.assign(waiting || {}, patch);
  clearTimeout(timer);
  timer = setTimeout(flush, 250);
}

function drop() {
  clearTimeout(timer);
  waiting = null;
}

window.addEventListener('pagehide', flush);

chrome.storage.sync.get(DEFAULTS).then(render);

enabled.addEventListener('change', () => {
  body.dataset.disabled = String(!enabled.checked);
  saveNow({ enabled: enabled.checked });
});

intensity.addEventListener('input', () => {
  const v = Number(intensity.value);
  paint(v);
  saveSoon({ intensity: v });
});

keepMedia.addEventListener('change', () => saveNow({ keepMedia: keepMedia.checked }));

$('reset').addEventListener('click', () => {
  drop();                    /* иначе отложенное значение ползунка перезапишет сброс */
  saveNow(DEFAULTS);
  render(DEFAULTS);
});

$('shortcut').addEventListener('click', () => {
  chrome.tabs.create({ url: 'chrome://extensions/shortcuts' });
});
