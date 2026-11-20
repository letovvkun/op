import { getFirestoreSdk } from '../core/firebase.js';
import { loadCachedResource, invalidateCachedResource } from '../core/data-cache.js';
import { tryLoadStaticData } from '../core/static-data.js';

const TITLES_CACHE_KEY = 'catalogTitles';

/** Возвращает общий каталог из session-кэша, статического снимка или Firestore. */
export function loadTitles({ forceRefresh = false } = {}) {
  return loadCachedResource(TITLES_CACHE_KEY, async () => {
    const snapshot = await tryLoadStaticData('titles', Array.isArray);
    if (snapshot) return snapshot;

    const { db, collection, getDocs } = await getFirestoreSdk();
    const firestoreSnapshot = await getDocs(collection(db, 'titles'));
    return firestoreSnapshot.docs.map((document) => ({ ...document.data(), id: document.id }));
  }, { forceRefresh, validate: Array.isArray });
}

export function invalidateTitlesCache() {
  return invalidateCachedResource(TITLES_CACHE_KEY);
}
