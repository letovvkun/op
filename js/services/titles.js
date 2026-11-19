import { db, collection, getDocs } from '../core/firebase.js';
import { loadCachedResource, invalidateCachedResource } from '../core/data-cache.js';

const TITLES_CACHE_KEY = 'catalogTitles';

/** Возвращает общий каталог из session-кэша или Firestore. */
export function loadTitles({ forceRefresh = false } = {}) {
  return loadCachedResource(TITLES_CACHE_KEY, async () => {
    const snapshot = await getDocs(collection(db, 'titles'));
    return snapshot.docs.map((document) => ({ ...document.data(), id: document.id }));
  }, { forceRefresh, validate: Array.isArray });
}

export function invalidateTitlesCache() {
  return invalidateCachedResource(TITLES_CACHE_KEY);
}
