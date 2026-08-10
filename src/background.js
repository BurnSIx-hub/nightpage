/* Pins the defaults on install and handles the keyboard shortcut.
   Every other piece of state lives in chrome.storage, so the worker
   is free to go to sleep. */

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
