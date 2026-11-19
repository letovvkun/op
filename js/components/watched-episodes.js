import { loadWatchedEpisodes, saveWatchedEpisodes } from '../services/episodes.js';

/**
 * Общее состояние отметок просмотра для страниц с эпизодами.
 * Разметка остаётся у страницы, а сохранение, счётчик и синхронизация карточки — общими.
 */
export function createWatchedEpisodeManager({
  grid = null,
  storageKey = 'watchedEpisodes',
  counterId = 'bountyAmount',
  rewardPerEpisode = 1500000
} = {}) {
  let watched = new Set();

  function updateCounter() {
    const counter = document.getElementById(counterId);
    if (counter) counter.textContent = (watched.size * rewardPerEpisode).toLocaleString('en-US');
  }

  function load() {
    watched = loadWatchedEpisodes(storageKey);
    updateCounter();
    return watched;
  }

  function mark(episodeId, isWatched = true) {
    if (!episodeId) return;
    if (isWatched) watched.add(episodeId);
    else watched.delete(episodeId);

    saveWatchedEpisodes(watched, storageKey);
    updateCounter();

    if (grid) {
      const card = Array.from(grid.querySelectorAll('.ep'))
        .find(node => node.dataset.firestoreId === episodeId);
      if (card) {
        card.classList.toggle('watched', isWatched);
        const button = card.querySelector('.ep-watch-toggle');
        if (button) {
          button.setAttribute('aria-pressed', String(isWatched));
          const label = isWatched ? 'Отметить непросмотренным' : 'Отметить просмотренным';
          button.setAttribute('aria-label', label);
          button.title = label;
        }
      }
    }
  }

  return {
    load,
    mark,
    get episodes() {
      return watched;
    }
  };
}
