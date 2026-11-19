import { toTimestampMillis } from '../core/safe-dom.js';
import { readStorage, writeStorage } from '../core/storage.js';

export function isEpisodePublic(episode) {
  if (!episode) return false;
  if (episode.status === 'draft' || episode.isDraft === true) return false;

  if (episode.status === 'scheduled') {
    const publishTime = toTimestampMillis(episode.publishAt);
    // Скрываем запланированные публикации с некорректной датой и будущим временем.
    if (!publishTime || publishTime > Date.now()) return false;
  }

  return true;
}

/** Проверяет, можно ли показывать эпизод в публичных списках. */
export function isEpisodeDisplayable(episode) {
  return isEpisodePublic(episode)
    && typeof episode.firestoreId === 'string'
    && episode.firestoreId.length > 0
    && episode.id !== null
    && episode.id !== undefined
    && String(episode.id).trim().length > 0
    && typeof episode.title === 'string'
    && episode.title.trim().length > 0;
}

export function loadWatchedEpisodes(storageKey = 'watchedEpisodes') {
  try {
    const saved = readStorage(storageKey);
    if (!saved) return new Set();
    const parsed = JSON.parse(saved);
    return Array.isArray(parsed)
      ? new Set(parsed.filter((value) => typeof value === 'string' && value.trim()))
      : new Set();
  } catch (_) {
    return new Set();
  }
}

export function saveWatchedEpisodes(episodes, storageKey = 'watchedEpisodes') {
  try {
    return writeStorage(storageKey, JSON.stringify([...episodes]));
  } catch (_) {
    return false;
  }
}
