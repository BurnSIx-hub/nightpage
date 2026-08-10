/* Фиксирует значения по умолчанию при установке и обрабатывает
   горячую клавишу. Всё остальное состояние живёт в chrome.storage,
   так что воркеру можно спокойно засыпать. */

const DEFAULTS = { enabled: true, intensity: 30, keepMedia: true };

chrome.runtime.onInstalled.addListener(async () => {
  const settings = await chrome.storage.sync.get(DEFAULTS);
  await chrome.storage.sync.set(settings);
});

chrome.commands.onCommand.addListener(async (command) => {
  if (command !== 'toggle-dark') return;
  const { enabled } = await chrome.storage.sync.get(DEFAULTS);
  await chrome.storage.sync.set({ enabled: !enabled });
});
