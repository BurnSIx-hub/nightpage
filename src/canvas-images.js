/* Возврат картинкам исходного вида — в мире страницы (world: MAIN).

   В Chromium Google Docs рисует в <canvas> всё, включая картинки:
   отдельных <img> для них в DOM нет, и CSS до них не дотянуться.
   Поэтому здесь перехватывается сам вызов drawImage: источник заранее
   прогоняется через преобразование, обратное фильтру темы. Когда сверху
   ляжет фильтр страницы, картинка вернётся к исходному виду.

   Тайлы текста Docs тоже переносит через drawImage, но источником там
   служит canvas — по типу источника они и отсеиваются. Трогаем только
   настоящие изображения. */

(() => {
  const CANVAS_DRAW = CanvasRenderingContext2D.prototype.drawImage;
  const root = document.documentElement;

  /* Состояние читаем прямо с <html>: классы и переменную туда пишет
     content.js. Пересчитываем по мутации, а не на каждый drawImage —
     Docs зовёт его сотни раз за перерисовку. */
  const state = { contrast: null };

  function refresh() {
    const on = !root.classList.contains('gdd-off') &&
               root.classList.contains('gdd-keep-media');
    const prev = state.contrast;

    if (!on) {
      state.contrast = null;
    } else {
      const raw = parseFloat(root.style.getPropertyValue('--gdd-contrast'));
      state.contrast = raw > 0 ? raw : 0.804;
    }

    /* Уже нарисованные тайлы сами не обновятся. Docs перерисовывает их
       по изменению размеров окна — этим и пользуемся. */
    if (prev !== state.contrast) {
      window.dispatchEvent(new Event('resize'));
    }
  }

  refresh();
  new MutationObserver(refresh).observe(root, {
    attributes: true,
    attributeFilter: ['class', 'style']
  });

  /* Преобразование, обратное фильтру темы contrast(c) invert(1) hue-rotate(180deg):
     тот же набор в обратном порядке, contrast компенсируется множителем 1/c.

     Точность неполная. hue-rotate выносит насыщенные цвета за пределы
     гаммы, и там они обрезаются — это свойство самого фильтра, а не ошибка
     компенсации. Средние тона, зелёный, синий и телесные оттенки
     возвращаются практически точно; яркие красный и жёлтый остаются
     приглушёнными. Чем выше «глубина чёрного», тем меньше расхождение. */
  const filterFor = (c) =>
    'hue-rotate(180deg) invert(1) contrast(' + (1 / c).toFixed(4) + ')';

  const cache = new WeakMap();   // источник → { contrast, canvas }

  function preInverted(source, contrast) {
    const cached = cache.get(source);
    if (cached && cached.contrast === contrast) return cached.canvas;

    const w = source.naturalWidth || source.width;
    const h = source.naturalHeight || source.height;
    if (!w || !h) return null;               // ещё не загрузилось

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

  /* Каждый контекст патчится своим оригиналом: подсунуть методу
     OffscreenCanvas функцию от обычного canvas нельзя — упадёт. */
  function wrap(original) {
    return function drawImage(source, ...rest) {
      const contrast = state.contrast;
      if (contrast !== null && isImage(source)) {
        try {
          const pre = preInverted(source, contrast);
          if (pre) return original.call(this, pre, ...rest);
        } catch (e) {
          /* Что угодно пошло не так — рисуем как рисовалось.
             Сломать документ хуже, чем показать картинку в негативе. */
        }
      }
      return original.call(this, source, ...rest);
    };
  }

  CanvasRenderingContext2D.prototype.drawImage = wrap(CANVAS_DRAW);

  /* На случай, если Docs рисует через OffscreenCanvas в основном потоке. */
  if (typeof OffscreenCanvasRenderingContext2D !== 'undefined') {
    const offscreen = OffscreenCanvasRenderingContext2D.prototype;
    offscreen.drawImage = wrap(offscreen.drawImage);
  }
})();
