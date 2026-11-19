/**
 * Безопасный доступ к Web Storage.
 * Браузеры и privacy-режимы могут запрещать чтение или запись хранилища;
 * это не должно останавливать работу страниц.
 */
const STORAGE_NAMES = new Set(['localStorage', 'sessionStorage']);

function getStorage(storageName) {
  if (!STORAGE_NAMES.has(storageName)) return null;
  try {
    return globalThis[storageName] || null;
  } catch (_) {
    return null;
  }
}

export function readStorage(key, storageName = 'localStorage', fallback = null) {
  try {
    return getStorage(storageName)?.getItem(String(key)) ?? fallback;
  } catch (_) {
    return fallback;
  }
}

export function writeStorage(key, value, storageName = 'localStorage') {
  try {
    const storage = getStorage(storageName);
    if (!storage) return false;
    storage.setItem(String(key), String(value));
    return true;
  } catch (_) {
    return false;
  }
}

export function removeStorage(key, storageName = 'localStorage') {
  try {
    const storage = getStorage(storageName);
    if (!storage) return false;
    storage.removeItem(String(key));
    return true;
  } catch (_) {
    return false;
  }
}
