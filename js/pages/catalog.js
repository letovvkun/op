import { escapeHTML, safeHttpsUrl, toTimestampMillis } from '../core/safe-dom.js';
import { debounce, initFloatingMenu, initThemeToggle } from '../core/ui.js';
import { loadTitles } from '../services/titles.js';
import { getDataErrorMessage, logDataError } from '../core/errors.js';
import { clearSkeletonState, createCatalogGridSkeleton, createFilterSkeleton, setSkeletonContent } from '../core/skeletons.js';

let allTitles = [];
const catalogTitleIndex = new WeakMap();

function createCatalogTitleIndex(title) {
  return {
    normalizedName: String(title?.name || '').toLowerCase(),
    genres: typeof title?.genres === 'string'
      ? title.genres.split(',').map((genre) => genre.trim())
      : [],
    voices: typeof title?.voice === 'string'
      ? title.voice.split(',').map((voice) => voice.trim())
      : [],
    updatedAt: toTimestampMillis(title?.updatedAt)
  };
}

const catalogGrid = document.getElementById('catalogGrid');
const genresContainer = document.getElementById('genresContainer');
const voiceContainer = document.getElementById('voiceContainer');
const searchInput = document.getElementById('searchInput');
const catalogSortOrder = document.getElementById('catalogSortOrder');
const mobileFilterBtn = document.getElementById('mobileFilterBtn');
const catalogSidebar = document.getElementById('catalogSidebar');
const catalogLayout = document.querySelector('.catalog-layout');
const filterOverlay = document.getElementById('filterOverlay');
const closeFilterBtn = document.getElementById('closeFilterBtn');


async function initCatalog() {
  if (!catalogGrid) return;

  setSkeletonContent(catalogGrid, createCatalogGridSkeleton(6));
  setSkeletonContent(genresContainer, createFilterSkeleton(4));
  setSkeletonContent(voiceContainer, createFilterSkeleton(4));

  try {
    allTitles = await loadTitles();
    allTitles.forEach((title) => catalogTitleIndex.set(title, createCatalogTitleIndex(title)));

    buildFilters();
    renderCatalog();
  } catch (error) {
    logDataError('Ошибка загрузки каталога', error);
    catalogGrid.textContent = getDataErrorMessage(error, 'Ошибка подключения к базе данных.');
    catalogGrid.classList.add('empty-state');
    catalogGrid.style.color = 'var(--error)';
    clearSkeletonState(catalogGrid);
    for (const filterContainer of [genresContainer, voiceContainer]) {
      if (!filterContainer) continue;
      filterContainer.textContent = 'Не удалось загрузить фильтры.';
      clearSkeletonState(filterContainer);
    }
  }
}

function buildFilters() {
  const genresSet = new Set();
  const voiceSet = new Set();

  allTitles.forEach((title) => {
    const index = catalogTitleIndex.get(title);
    if (!index) return;
    index.genres.forEach((genre) => {
      if (genre) genresSet.add(genre);
    });
    index.voices.forEach((voice) => {
      if (voice) voiceSet.add(voice);
    });
  });

  if (genresContainer) {
    genresContainer.innerHTML = Array.from(genresSet).sort((a, b) => a.localeCompare(b, 'ru')).map(genre => `
      <label class="checkbox-container">
        <input type="checkbox" value="${escapeHTML(genre)}" class="genre-filter">
        <span class="checkmark"></span>
        ${escapeHTML(genre)}
      </label>
    `).join('');
    clearSkeletonState(genresContainer);
    genresContainer.addEventListener('change', renderCatalog);
  }

  if (voiceContainer) {
    voiceContainer.innerHTML = Array.from(voiceSet).sort((a, b) => a.localeCompare(b, 'ru')).map(voice => `
      <label class="checkbox-container">
        <input type="checkbox" value="${escapeHTML(voice)}" class="voice-filter">
        <span class="checkmark"></span>
        ${escapeHTML(voice)}
      </label>
    `).join('');
    clearSkeletonState(voiceContainer);
    voiceContainer.addEventListener('change', renderCatalog);
  }

  if (catalogSortOrder) {
    catalogSortOrder.addEventListener('change', renderCatalog);
  }
}

function renderCatalog() {
  if (!catalogGrid) return;
  clearSkeletonState(catalogGrid);

  const searchTerm = searchInput ? searchInput.value.toLowerCase().trim() : '';
  const selectedGenres = Array.from(document.querySelectorAll('.genre-filter:checked')).map(cb => cb.value);
  const selectedVoices = Array.from(document.querySelectorAll('.voice-filter:checked')).map(cb => cb.value);
  const sortVal = catalogSortOrder ? catalogSortOrder.value : 'newest';

  const filteredTitles = allTitles.filter((title) => {
    const index = catalogTitleIndex.get(title);
    const matchSearch = !searchTerm || index.normalizedName.includes(searchTerm);
    const matchGenres = selectedGenres.length === 0
      || selectedGenres.some((genre) => index.genres.includes(genre));
    const matchVoices = selectedVoices.length === 0
      || selectedVoices.some((voice) => index.voices.includes(voice));

    return matchSearch && matchGenres && matchVoices;
  });

  filteredTitles.sort((a, b) => {
    const indexA = catalogTitleIndex.get(a);
    const indexB = catalogTitleIndex.get(b);
    if (sortVal === 'name-asc') return String(a.name ?? '').localeCompare(String(b.name ?? ''), 'ru');
    if (sortVal === 'name-desc') return String(b.name ?? '').localeCompare(String(a.name ?? ''), 'ru');
    if (sortVal === 'newest') return indexB.updatedAt - indexA.updatedAt;
    if (sortVal === 'oldest') return indexA.updatedAt - indexB.updatedAt;
    return 0;
  });

  if (filteredTitles.length === 0) {
    catalogGrid.innerHTML = '<div class="empty-state">По вашему запросу ничего не найдено</div>';
    return;
  }

  catalogGrid.innerHTML = filteredTitles.map(t => {
    const link = t.id === 'one_piece' ? 'index.html' : `title.html?id=${encodeURIComponent(t.id)}`;
    const poster = safeHttpsUrl(t.poster, 'https://via.placeholder.com/300x450?text=No+Poster');
    const name = escapeHTML(t.name || 'Без названия');
    return `
      <a href="${link}" class="catalog-card">
        <div class="catalog-card-img">
          <img src="${escapeHTML(poster)}" alt="${name}" loading="lazy" decoding="async">
        </div>
        <div class="catalog-card-info">
          <h3>${name}</h3>
        </div>
      </a>
    `;
  }).join('');
}

if (searchInput) {
  searchInput.addEventListener('input', debounce(renderCatalog, 250));
}

const mobileQuery = window.matchMedia('(max-width: 980px)');
function handleViewportChange(e) {
  if (!catalogSidebar || !catalogLayout) return;
  if (e.matches) {
    if (catalogSidebar.parentNode !== document.body) {
      document.body.appendChild(catalogSidebar);
    }
  } else {
    if (catalogSidebar.parentNode !== catalogLayout) {
      catalogLayout.appendChild(catalogSidebar);
    }
    catalogSidebar.classList.remove('open');
    if (filterOverlay) filterOverlay.classList.remove('open');
    if (mobileFilterBtn) mobileFilterBtn.setAttribute('aria-expanded', 'false');
    document.body.style.overflow = '';
  }
}
if (typeof mobileQuery.addEventListener === 'function') {
  mobileQuery.addEventListener('change', handleViewportChange);
} else if (typeof mobileQuery.addListener === 'function') {
  mobileQuery.addListener(handleViewportChange);
}
handleViewportChange(mobileQuery);

function toggleMobileFilter() {
  if (!catalogSidebar || !filterOverlay) return;
  const isOpen = catalogSidebar.classList.toggle('open');
  filterOverlay.classList.toggle('open', isOpen);
  if (mobileFilterBtn) mobileFilterBtn.setAttribute('aria-expanded', String(isOpen));
  document.body.style.overflow = isOpen ? 'hidden' : '';
}

if (mobileFilterBtn) mobileFilterBtn.addEventListener('click', toggleMobileFilter);
const closeMobileFilter = () => {
  if (!catalogSidebar || !filterOverlay) return;
  catalogSidebar.classList.remove('open');
  filterOverlay.classList.remove('open');
  if (mobileFilterBtn) mobileFilterBtn.setAttribute('aria-expanded', 'false');
  document.body.style.overflow = '';
};

if (closeFilterBtn) closeFilterBtn.addEventListener('click', closeMobileFilter);
if (filterOverlay) filterOverlay.addEventListener('click', closeMobileFilter);
document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') closeMobileFilter();
});

initFloatingMenu();
initThemeToggle();

document.addEventListener('DOMContentLoaded', () => {
  initCatalog();
});
