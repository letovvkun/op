import { escapeHTML, safeHttpsUrl } from '../core/safe-dom.js';
import { debounce } from '../core/ui.js';

const CHECK_ICON_SVG = '<svg viewBox="0 0 24 24" aria-hidden="true"><polyline points="20 6 9 17 4 12"></polyline></svg>';
export const INITIAL_VISIBLE_COUNT = 8;
const PAGE_SIZE = 12;

/**
 * Общая логика каталога эпизодов для главной страницы и страниц тайтлов.
 * Загрузка данных, плеер, телеметрия и заголовки остаются ответственностью страницы.
 */
export function createEpisodeBrowser({
  grid,
  searchInput,
  sortSelect,
  loadMoreContainer,
  loadMoreButton,
  loadMoreText,
  paginationInfo,
  previousButton,
  nextButton,
  watchedManager,
  onSelect = () => {},
  navigationScroll = false,
  animatedCollapse = false
} = {}) {
  let episodes = [];
  let currentIndex = -1;
  let visibleCount = INITIAL_VISIBLE_COUNT;
  let sortOrder = 'desc';
  let collapseTimer = null;
  let searchIndex = new WeakMap();

  const currentSearch = () => searchInput?.value || '';
  const watched = () => watchedManager?.episodes || new Set();

  function getFilteredEpisodes(filter = currentSearch()) {
    const term = String(filter).trim().toLowerCase();
    if (!term) return episodes;

    return episodes.filter((episode) => {
      const searchable = searchIndex.get(episode);
      return searchable && (searchable.title.includes(term) || searchable.id.includes(term));
    });
  }

  function markActive() {
    if (!grid || currentIndex < 0) return;
    const activeId = episodes[currentIndex]?.firestoreId;
    for (const node of grid.children) {
      const isActive = node.dataset.firestoreId === activeId;
      node.classList.toggle('active', isActive);
      const opener = node.querySelector?.('.ep-open');
      if (opener) {
        if (isActive) opener.setAttribute('aria-current', 'true');
        else opener.removeAttribute('aria-current');
      }
    }
  }

  function renderList(filter = currentSearch()) {
    if (!grid) return;
    const term = String(filter).trim().toLowerCase();
    const filtered = getFilteredEpisodes(filter);
    const visible = filtered.slice(0, visibleCount);

    grid.replaceChildren();

    if (!visible.length) {
      const empty = document.createElement('div');
      empty.style.cssText = 'text-align:center;padding:2rem;width:100%;color:var(--muted);';
      empty.textContent = 'Ничего не найдено.';
      grid.appendChild(empty);
    } else {
      const fragment = document.createDocumentFragment();
      const watchedIds = watched();

      visible.forEach((episode, index) => {
        const card = document.createElement('div');
        const isWatched = watchedIds.has(episode.firestoreId);
        card.className = 'ep';
        if (!term && index === 0 && sortOrder === 'desc') card.classList.add('new-episode');
        if (isWatched) card.classList.add('watched');

        card.dataset.firestoreId = episode.firestoreId;

        const thumbnailUrl = safeHttpsUrl(episode.thumb);
        const thumbnail = thumbnailUrl
          ? `<img src="${escapeHTML(thumbnailUrl)}" alt="" loading="lazy" decoding="async">`
          : `EP ${escapeHTML(episode.id)}`;

        card.innerHTML = `
          <div class="thumb" aria-hidden="true">${thumbnail}</div>
          <div class="meta">
            <div class="t">${escapeHTML(episode.title)}</div>
            <div class="s">${escapeHTML(episode.date || '')} • ${escapeHTML(episode.quality || '')}</div>
          </div>
          <button type="button" class="ep-open" aria-label="Смотреть: ${escapeHTML(episode.title)}"></button>
          <button type="button" class="ep-watch-toggle" title="${isWatched ? 'Отметить непросмотренным' : 'Отметить просмотренным'}" aria-label="${isWatched ? 'Отметить непросмотренным' : 'Отметить просмотренным'}" aria-pressed="${isWatched}">${CHECK_ICON_SVG}</button>
        `;
        fragment.appendChild(card);
      });

      grid.appendChild(fragment);
    }

    if (loadMoreContainer) {
      const hasMore = filtered.length > visibleCount;
      const canCollapse = visibleCount > INITIAL_VISIBLE_COUNT && filtered.length > 0;
      loadMoreContainer.style.display = hasMore || canCollapse ? 'flex' : 'none';
      if (loadMoreText) loadMoreText.textContent = hasMore ? 'Показать еще' : 'Свернуть';
      loadMoreButton?.classList.toggle('expanded', !hasMore && canCollapse);
      if (hasMore) loadMoreButton?.classList.remove('expanded');
    }

    if (paginationInfo) {
      paginationInfo.textContent = `Показано ${Math.min(visibleCount, filtered.length)} из ${filtered.length}`;
    }

    markActive();
  }

  function sortEpisodes() {
    const activeId = episodes[currentIndex]?.firestoreId;
    episodes.sort((a, b) => sortOrder === 'desc' ? b.id - a.id : a.id - b.id);
    if (activeId) currentIndex = episodes.findIndex((episode) => episode.firestoreId === activeId);
    renderList();
  }

  function ensureEpisodeVisible(episode) {
    if (!episode) return;
    const filtered = getFilteredEpisodes();
    const position = filtered.findIndex((item) => item.firestoreId === episode.firestoreId);
    if (position < visibleCount) return;

    const extraNeeded = position + 1 - visibleCount;
    visibleCount = Math.min(visibleCount + Math.ceil(extraNeeded / PAGE_SIZE) * PAGE_SIZE, filtered.length);
    renderList();
  }

  function select(index, shouldScroll = false) {
    if (!Number.isInteger(index) || index < 0 || index >= episodes.length) return false;
    currentIndex = index;
    const episode = episodes[index];

    ensureEpisodeVisible(episode);
    onSelect(episode, index, shouldScroll);
    markActive();
    return true;
  }

  function setEpisodes(nextEpisodes, preferredEpisodeId = null) {
    if (collapseTimer !== null) {
      clearTimeout(collapseTimer);
      collapseTimer = null;
    }

    episodes = Array.isArray(nextEpisodes) ? nextEpisodes : [];
    currentIndex = -1;
    visibleCount = INITIAL_VISIBLE_COUNT;
    searchIndex = new WeakMap();
    for (const episode of episodes) {
      searchIndex.set(episode, {
        title: String(episode.title || '').toLowerCase(),
        id: String(episode.id)
      });
    }

    sortOrder = sortSelect?.value === 'asc' ? 'asc' : 'desc';
    sortEpisodes();

    if (!episodes.length) return episodes;
    const preferredIndex = preferredEpisodeId
      ? episodes.findIndex((episode) => episode.firestoreId === preferredEpisodeId)
      : -1;
    select(preferredIndex >= 0 ? preferredIndex : 0, false);
    return episodes;
  }

  function handleGridAction(event) {
    const target = event.target;
    if (!target || typeof target.closest !== 'function') return;
    const toggleButton = target.closest('.ep-watch-toggle');
    const card = target.closest('.ep');
    const episodeId = card?.dataset.firestoreId;
    if (!episodeId) return;

    if (toggleButton) {
      event.stopPropagation();
      event.preventDefault();
      watchedManager?.mark(episodeId, !watched().has(episodeId));
      return;
    }

    const targetIndex = episodes.findIndex((episode) => episode.firestoreId === episodeId);
    if (!watched().has(episodeId)) watchedManager?.mark(episodeId, true);
    if (targetIndex !== -1 && targetIndex !== currentIndex) select(targetIndex, true);
  }

  if (grid) {
    grid.addEventListener('click', handleGridAction);
  }

  searchInput?.addEventListener('input', debounce(() => {
    visibleCount = INITIAL_VISIBLE_COUNT;
    renderList();
  }));

  sortSelect?.addEventListener('change', () => {
    sortOrder = sortSelect.value === 'asc' ? 'asc' : 'desc';
    visibleCount = INITIAL_VISIBLE_COUNT;
    sortEpisodes();
  });

  loadMoreButton?.addEventListener('click', () => {
    const filter = currentSearch();
    if (loadMoreButton.classList.contains('expanded')) {
      const collapse = () => {
        visibleCount = INITIAL_VISIBLE_COUNT;
        renderList(filter);
        grid?.scrollIntoView({ behavior: 'smooth', block: 'start' });
        collapseTimer = null;
      };

      if (animatedCollapse) {
        for (const [index, card] of Array.from(grid?.querySelectorAll('.ep') || []).entries()) {
          if (index >= INITIAL_VISIBLE_COUNT) card.classList.add('hiding');
        }
        if (collapseTimer !== null) clearTimeout(collapseTimer);
        collapseTimer = setTimeout(collapse, 250);
      } else {
        collapse();
      }
      return;
    }

    visibleCount = Math.min(visibleCount + PAGE_SIZE, getFilteredEpisodes(filter).length);
    renderList(filter);
  });

  // «Назад» ведёт к более ранней серии, «Вперёд» к более поздней при любой сортировке:
  // при сортировке «сначала новые» ранняя серия лежит правее в списке, при «сначала старые» левее.
  function stepEpisode(direction) {
    const olderOffset = sortOrder === 'desc' ? 1 : -1;
    const target = currentIndex + direction * olderOffset;
    if (target >= 0 && target < episodes.length) select(target, navigationScroll);
  }

  previousButton?.addEventListener('click', () => stepEpisode(1));
  nextButton?.addEventListener('click', () => stepEpisode(-1));

  return {
    setEpisodes,
    select,
    render: renderList,
    get episodes() { return episodes; },
    get currentIndex() { return currentIndex; }
  };
}
