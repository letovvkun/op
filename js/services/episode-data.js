import { getFirestoreSdk } from '../core/firebase.js';
import { loadCachedResource, invalidateCachedResource } from '../core/data-cache.js';
import { tryLoadStaticData } from '../core/static-data.js';

const MAIN_EPISODES_CACHE_KEY = 'mainEpisodes';
const MAIN_TITLE_ID = 'one_piece';
const MAIN_EPISODES_LIMIT = 150;

function mapEpisodeDocuments(snapshot) {
  return snapshot.docs.map((document) => ({
    ...document.data(),
    firestoreId: document.id
  }));
}

function compareEpisodeIdsDesc(a, b) {
  const first = Number(a?.id);
  const second = Number(b?.id);
  if (Number.isFinite(first) && Number.isFinite(second)) return second - first;
  return String(b?.id ?? '').localeCompare(String(a?.id ?? ''), 'ru', { numeric: true });
}

/** Серии основного тайтла из общего снимка: те же правила, что и у запроса к Firestore. */
export function selectMainEpisodes(allEpisodes, limit = MAIN_EPISODES_LIMIT) {
  return allEpisodes
    .filter((episode) => episode && (!episode.titleId || episode.titleId === MAIN_TITLE_ID))
    .sort(compareEpisodeIdsDesc)
    .slice(0, limit);
}

export function loadMainEpisodes({ forceRefresh = false } = {}) {
  return loadCachedResource(MAIN_EPISODES_CACHE_KEY, async () => {
    const snapshot = await tryLoadStaticData('episodes', Array.isArray);
    if (snapshot) return selectMainEpisodes(snapshot);

    const { db, collection, getDocs, limit, orderBy, query } = await getFirestoreSdk();
    const episodesQuery = query(
      collection(db, 'episodes'),
      orderBy('id', 'desc'),
      limit(MAIN_EPISODES_LIMIT)
    );
    const firestoreSnapshot = await getDocs(episodesQuery);
    return mapEpisodeDocuments(firestoreSnapshot).filter((episode) => !episode.titleId || episode.titleId === MAIN_TITLE_ID);
  }, { forceRefresh, validate: Array.isArray });
}

export function loadTitleEpisodes(titleId, { forceRefresh = false } = {}) {
  if (typeof titleId !== 'string' || !titleId.trim()) {
    return Promise.reject(new TypeError('Для загрузки серий нужен идентификатор тайтла.'));
  }

  const cacheKey = `titleEpisodes:${encodeURIComponent(titleId)}`;
  return loadCachedResource(cacheKey, async () => {
    const snapshot = await tryLoadStaticData('episodes', Array.isArray);
    if (snapshot) return snapshot.filter((episode) => episode && episode.titleId === titleId);

    const { db, collection, getDocs, query, where } = await getFirestoreSdk();
    const episodesQuery = query(
      collection(db, 'episodes'),
      where('titleId', '==', titleId)
    );
    const firestoreSnapshot = await getDocs(episodesQuery);
    return mapEpisodeDocuments(firestoreSnapshot);
  }, { forceRefresh, validate: Array.isArray });
}

export function loadTitleRecord(titleId, { forceRefresh = false } = {}) {
  if (typeof titleId !== 'string' || !titleId.trim()) {
    return Promise.reject(new TypeError('Для загрузки тайтла нужен идентификатор.'));
  }

  const cacheKey = `titleRecord:${encodeURIComponent(titleId)}`;
  return loadCachedResource(cacheKey, async () => {
    const snapshot = await tryLoadStaticData('titles', Array.isArray);
    const fromSnapshot = snapshot?.find((title) => title && title.id === titleId);
    // Новый тайтл мог появиться позже последней сборки, поэтому «не найден» перепроверяем в Firestore.
    if (fromSnapshot) return fromSnapshot;

    const { db, doc, getDoc } = await getFirestoreSdk();
    const firestoreSnapshot = await getDoc(doc(db, 'titles', titleId));
    return firestoreSnapshot.exists() ? { ...firestoreSnapshot.data(), id: firestoreSnapshot.id } : null;
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
