import { db, collection, getDocs } from '../core/firebase.js';
import { toTimestampMillis } from '../core/safe-dom.js';
import { loadCachedResource, invalidateCachedResource } from '../core/data-cache.js';

const TRACKER_CACHE_KEY = 'trackerData';

export function loadTrackerEntries({ forceRefresh = false } = {}) {
  return loadCachedResource(TRACKER_CACHE_KEY, async () => {
    const [packsSnapshot, episodesSnapshot] = await Promise.all([
      getDocs(collection(db, 'torrent_packs')),
      getDocs(collection(db, 'episodes'))
    ]);

    const entries = [];

    packsSnapshot.forEach((document) => {
      const pack = document.data();
      if (!pack.magnet && !pack.torrentUrl) return;

      const timestamp = toTimestampMillis(pack.createdAt);
      let dateIso = '';
      if (timestamp) {
        try { dateIso = new Date(timestamp).toISOString(); } catch (_) {}
      }
      entries.push({
        id: document.id,
        type: 'pack',
        title: pack.title,
        dateStr: dateIso ? dateIso.split('T')[0] : 'Неизвестно',
        timestamp,
        magnet: pack.magnet,
        torrentUrl: pack.torrentUrl
      });
    });

    episodesSnapshot.forEach((document) => {
      const episode = document.data();
      if (!episode.magnet && !episode.torrentUrl) return;

      entries.push({
        id: episode.id,
        type: 'episode',
        title: `Серия ${episode.id} — ${episode.title} [${episode.quality || '1080p'}]`,
        dateStr: episode.date || 'Неизвестно',
        timestamp: toTimestampMillis(episode.date),
        magnet: episode.magnet,
        torrentUrl: episode.torrentUrl
      });
    });

    return entries;
  }, { forceRefresh, validate: Array.isArray });
}

export function invalidateTrackerCache() {
  return invalidateCachedResource(TRACKER_CACHE_KEY);
}
