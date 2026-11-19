import { readSessionCacheEntry, writeSessionCache, removeSessionCache } from './safe-dom.js';

const DEFAULT_TTL_MS = 5 * 60 * 1000;
const inFlightRequests = new Map();
const cacheGenerations = new Map();

/**
 * Общая точка получения кэшируемых данных.
 * Параллельные вызовы с одним ключом объединяются в один запрос.
 */
export async function loadCachedResource(
  key,
  loader,
  { forceRefresh = false, ttlMs = DEFAULT_TTL_MS, validate = () => true } = {}
) {
  if (typeof key !== 'string' || !key.trim()) {
    throw new TypeError('Для кэшируемого ресурса нужен непустой ключ.');
  }
  if (typeof loader !== 'function') {
    throw new TypeError('Загрузчик ресурса должен быть функцией.');
  }

  if (!forceRefresh) {
    const pending = inFlightRequests.get(key);
    if (pending) return pending;

    const cachedEntry = readSessionCacheEntry(key, ttlMs);
    if (cachedEntry && validate(cachedEntry.data)) return cachedEntry.data;
    if (cachedEntry) removeSessionCache(key);
  } else {
    // Принудительное обновление не должно присоединяться к старому запросу.
    // Увеличение поколения также не даёт старому ответу перезаписать свежий кэш.
    cacheGenerations.set(key, (cacheGenerations.get(key) || 0) + 1);
  }

  const generation = cacheGenerations.get(key) || 0;
  const request = Promise.resolve()
    .then(loader)
    .then((data) => {
      if ((cacheGenerations.get(key) || 0) === generation && validate(data)) {
        writeSessionCache(key, data);
      }
      return data;
    });

  inFlightRequests.set(key, request);
  try {
    return await request;
  } finally {
    if (inFlightRequests.get(key) === request) inFlightRequests.delete(key);
  }
}

export function invalidateCachedResource(key) {
  if (typeof key !== 'string' || !key.trim()) return false;
  cacheGenerations.set(key, (cacheGenerations.get(key) || 0) + 1);
  inFlightRequests.delete(key);
  removeSessionCache(key);
  return true;
}
