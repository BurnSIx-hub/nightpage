/* Читает настройки и переводит их в классы и переменную на <html>.
   Сам стиль лежит в dark.css и подключается на document_start —
   поэтому тёмная тема появляется без белой вспышки, а скрипт лишь
   выключает её, если пользователь так решил. */

const DEFAULTS = { enabled: true, intensity: 30, keepMedia: true };

const root = document.documentElement;
let current = DEFAULTS;

/* intensity 0..100 → contrast 0.72..1.0
   0.72 — лист светло-серый (#242424), 1.0 — угольно-чёрный. */
function contrastFor(intensity) {
  const clamped = Math.min(100, Math.max(0, Number(intensity) || 0));
  return (0.72 + clamped * 0.0028).toFixed(3);
}

function apply(settings) {
  current = settings;
  root.classList.toggle('gdd-off', !settings.enabled);
  root.classList.toggle('gdd-keep-media', !!settings.keepMedia);
  root.style.setProperty('--gdd-contrast', contrastFor(settings.intensity));
}

chrome.storage.sync.get(DEFAULTS).then(apply);

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'sync') return;
  chrome.storage.sync.get(DEFAULTS).then(apply);
});

/* Docs переписывает атрибуты <html> по ходу загрузки и может снести
   наши классы. Возвращаем их на место — но только если действительно
   пропали, иначе наблюдатель сам себя разбудит. */
const observer = new MutationObserver(() => {
  const wantOff = !current.enabled;
  const wantMedia = !!current.keepMedia;
  if (root.classList.contains('gdd-off') !== wantOff ||
      root.classList.contains('gdd-keep-media') !== wantMedia ||
      !root.style.getPropertyValue('--gdd-contrast')) {
    apply(current);
  }
});
observer.observe(root, { attributes: true, attributeFilter: ['class', 'style'] });
