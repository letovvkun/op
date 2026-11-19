import { db, collection, doc, getDoc, getDocs, limit, orderBy, query, where } from '../core/firebase.js';
import { loadCachedResource, invalidateCachedResource } from '../core/data-cache.js';

const MAIN_EPISODES_CACHE_KEY = 'mainEpisodes';

function mapEpisodeDocuments(snapshot) {
  return snapshot.docs.map((document) => ({
    ...document.data(),
    firestoreId: document.id
  }));
}

export function loadMainEpisodes({ forceRefresh = false } = {}) {
  return loadCachedResource(MAIN_EPISODES_CACHE_KEY, async () => {
    const episodesQuery = query(
      collection(db, 'episodes'),
      orderBy('id', 'desc'),
      limit(150)
    );
    const snapshot = await getDocs(episodesQuery);
    return mapEpisodeDocuments(snapshot).filter((episode) => !episode.titleId || episode.titleId === 'one_piece');
  }, { forceRefresh, validate: Array.isArray });
}

export function loadTitleEpisodes(titleId, { forceRefresh = false } = {}) {
  if (typeof titleId !== 'string' || !titleId.trim()) {
    return Promise.reject(new TypeError('Для загрузки серий нужен идентификатор тайтла.'));
  }

  const cacheKey = `titleEpisodes:${encodeURIComponent(titleId)}`;
  return loadCachedResource(cacheKey, async () => {
    const episodesQuery = query(
      collection(db, 'episodes'),
      where('titleId', '==', titleId)
    );
    const snapshot = await getDocs(episodesQuery);
    return mapEpisodeDocuments(snapshot);
  }, { forceRefresh, validate: Array.isArray });
}

export function loadTitleRecord(titleId, { forceRefresh = false } = {}) {
  if (typeof titleId !== 'string' || !titleId.trim()) {
    return Promise.reject(new TypeError('Для загрузки тайтла нужен идентификатор.'));
  }

  const cacheKey = `titleRecord:${encodeURIComponent(titleId)}`;
  return loadCachedResource(cacheKey, async () => {
    const snapshot = await getDoc(doc(db, 'titles', titleId));
    return snapshot.exists() ? { ...snapshot.data(), id: snapshot.id } : null;
  }, { forceRefresh, validate: (value) => value === null || (typeof value === 'object' && !Array.isArray(value)) });
}

export function invalidateMainEpisodesCache() {
  return invalidateCachedResource(MAIN_EPISODES_CACHE_KEY);
}

export function invalidateTitleEpisodesCache(titleId) {
  if (typeof titleId !== 'string' || !titleId.trim()) return false;
  return invalidateCachedResource(`titleEpisodes:${encodeURIComponent(titleId)}`);
}

export function invalidateTitleRecordCache(titleId) {
  if (typeof titleId !== 'string' || !titleId.trim()) return false;
  return invalidateCachedResource(`titleRecord:${encodeURIComponent(titleId)}`);
}
