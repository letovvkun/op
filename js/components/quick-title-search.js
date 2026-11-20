import { NO_POSTER_URL, escapeHTML, safeHttpsUrl } from '../core/safe-dom.js';
import { debounce } from '../core/ui.js';
import { loadTitles } from '../services/titles.js';
import { logDataError } from '../core/errors.js';
import { clearSkeletonState, createTitleSearchSkeleton, setSkeletonContent } from '../core/skeletons.js';

const initializedSearchButtons = new WeakSet();

/** Инициализирует поиск тайтлов в шапке. Отдельный экземпляр для каждой страницы. */
export function initQuickTitleSearch() {
  const button = document.getElementById('titleSearchBtn');
  const popup = document.getElementById('titleSearchPopup');
  const input = document.getElementById('quickTitleInput');
  const results = document.getElementById('quickTitleResults');
  if (!button || !popup || initializedSearchButtons.has(button)) return;
  initializedSearchButtons.add(button);

  let titles = [];
  let isLoaded = false;
  let loadingPromise = null;

  const closePopup = () => {
    popup.classList.remove('open');
    button.classList.remove('active');
    button.setAttribute('aria-expanded', 'false');
  };

  const renderResults = (queryText = '') => {
    if (!results) return;
    const query = String(queryText).trim().toLocaleLowerCase('ru');
    const filtered = titles.filter((title) => {
      const name = String(title.name || '').toLocaleLowerCase('ru');
      const genres = String(title.genres || '').toLocaleLowerCase('ru');
      return !query || name.includes(query) || genres.includes(query);
    }).slice(0, 12);

    if (!filtered.length) {
      results.innerHTML = '<div class="title-search-empty">Тайтлы не найдены</div>';
      return;
    }

    results.innerHTML = filtered.map((title) => {
      const id = String(title.id || '');
      const href = id === 'one_piece' ? 'index.html' : `title/${encodeURIComponent(id)}/`;
      const poster = escapeHTML(safeHttpsUrl(title.poster, NO_POSTER_URL));
      const name = escapeHTML(title.name || 'Без названия');
      const meta = escapeHTML(title.genres || 'Аниме');
      return `
        <a href="${href}" class="title-search-item">
          <img src="${poster}" alt="${name}" loading="lazy" decoding="async">
          <div class="title-search-item-info">
            <div class="title-search-item-name">${name}</div>
            <div class="title-search-item-meta">${meta}</div>
          </div>
        </a>
      `;
    }).join('');
  };

  const ensureTitlesLoaded = async () => {
    if (isLoaded) {
      renderResults(input?.value || '');
      return;
    }
    if (loadingPromise) return loadingPromise;

    setSkeletonContent(results, createTitleSearchSkeleton(3));
    loadingPromise = loadTitles()
      .then((loadedTitles) => {
        titles = Array.isArray(loadedTitles) ? loadedTitles : [];
        isLoaded = true;
        renderResults(input?.value || '');
        clearSkeletonState(results);
      })
      .catch((error) => {
        logDataError('Ошибка загрузки списка тайтлов', error);
        if (results) {
          results.innerHTML = '<div class="title-search-empty">Ошибка загрузки каталога</div>';
          clearSkeletonState(results);
        }
      })
      .finally(() => {
        loadingPromise = null;
      });

    return loadingPromise;
  };

  button.addEventListener('click', (event) => {
    event.stopPropagation();
    const willOpen = !popup.classList.contains('open');
    popup.classList.toggle('open', willOpen);
    button.classList.toggle('active', willOpen);
    button.setAttribute('aria-expanded', String(willOpen));

    if (willOpen) {
      ensureTitlesLoaded();
      if (input && window.innerWidth > 768) setTimeout(() => input.focus(), 50);
    }
  });

  if (input) {
    input.addEventListener('input', debounce((event) => renderResults(event.target.value), 150));
  }

  document.addEventListener('click', (event) => {
    if (!popup.contains(event.target) && !button.contains(event.target)) closePopup();
  });

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && popup.classList.contains('open')) closePopup();
  });
}
