import { getFirestoreSdk } from '../core/firebase.js';
import { toTimestampMillis } from '../core/safe-dom.js';
import { loadCachedResource, invalidateCachedResource } from '../core/data-cache.js';
import { tryLoadStaticData } from '../core/static-data.js';

const TRACKER_CACHE_KEY = 'trackerData';

/**
 * Собирает строки трекера из обычных объектов (не зависит от Firestore SDK).
 * packs: документы torrent_packs вместе с полем id; episodes: документы episodes.
 */
export function buildTrackerEntries(packs, episodes) {
  const entries = [];

  for (const pack of packs) {
    if (!pack || (!pack.magnet && !pack.torrentUrl)) continue;

    const timestamp = toTimestampMillis(pack.createdAt);
    let dateIso = '';
    if (timestamp) {
      try { dateIso = new Date(timestamp).toISOString(); } catch (_) {}
    }
    entries.push({
      id: pack.id,
      type: 'pack',
      title: pack.title,
      dateStr: dateIso ? dateIso.split('T')[0] : 'Неизвестно',
      timestamp,
      magnet: pack.magnet,
      torrentUrl: pack.torrentUrl
    });
  }

  for (const episode of episodes) {
    if (!episode || (!episode.magnet && !episode.torrentUrl)) continue;

    entries.push({
      id: episode.id,
      type: 'episode',
      title: `Серия ${episode.id} — ${episode.title} [${episode.quality || '1080p'}]`,
      dateStr: episode.date || 'Неизвестно',
      timestamp: toTimestampMillis(episode.date),
      magnet: episode.magnet,
      torrentUrl: episode.torrentUrl
    });
  }

  return entries;
}

export function loadTrackerEntries({ forceRefresh = false } = {}) {
  return loadCachedResource(TRACKER_CACHE_KEY, async () => {
    const [packsSnapshot, episodesSnapshot] = await Promise.all([
      tryLoadStaticData('torrent_packs', Array.isArray),
      tryLoadStaticData('episodes', Array.isArray)
    ]);
    if (packsSnapshot && episodesSnapshot) return buildTrackerEntries(packsSnapshot, episodesSnapshot);

    const { db, collection, getDocs } = await getFirestoreSdk();
    const [packsResult, episodesResult] = await Promise.all([
      getDocs(collection(db, 'torrent_packs')),
      getDocs(collection(db, 'episodes'))
    ]);
    const packs = packsResult.docs.map((document) => ({ ...document.data(), id: document.id }));
    const episodes = episodesResult.docs.map((document) => document.data());
    return buildTrackerEntries(packs, episodes);
  }, { forceRefresh, validate: Array.isArray });
}

export function invalidateTrackerCache() {
  return invalidateCachedResource(TRACKER_CACHE_KEY);
}
