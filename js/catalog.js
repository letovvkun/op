import { initializeApp } from "https://www.gstatic.com/firebasejs/9.22.1/firebase-app.js";
import { getFirestore, collection, getDocs } from "https://www.gstatic.com/firebasejs/9.22.1/firebase-firestore.js";

const firebaseConfig = {
  apiKey: "AIzaSyBE1AkNd3bPGPr3ZPUbtqNUd2WDCB2SHHw",
  authDomain: "letovshiyori.firebaseapp.com",
  projectId: "letovshiyori"
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

let allTitles = [];

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

function debounce(fn, delay = 250) {
  let timer;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), delay);
  };
}

async function initCatalog() {
  if (!catalogGrid) return;

  catalogGrid.innerHTML = Array.from({ length: 6 }, () => `
    <div class="catalog-card">
      <div class="catalog-card-img skeleton-loader" style="aspect-ratio: 2/3;"></div>
      <div class="catalog-card-info">
        <div class="skeleton-loader" style="height: 15px; width: 80%; border-radius: 4px; margin-bottom: 6px;"></div>
      </div>
    </div>
  `).join('');

  try {
    const cachedTitles = sessionStorage.getItem('catalogTitles');

    if (cachedTitles) {
      allTitles = JSON.parse(cachedTitles);
    } else {
      const snap = await getDocs(collection(db, "titles"));
      allTitles = snap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      sessionStorage.setItem('catalogTitles', JSON.stringify(allTitles));
    }

    buildFilters();
    renderCatalog();
  } catch (error) {
    console.error("Ошибка загрузки каталога:", error);
    catalogGrid.innerHTML = '<div class="empty-state" style="color: var(--error);">Ошибка подключения к базе данных.</div>';
  }
}

function buildFilters() {
  const genresSet = new Set();
  const voiceSet = new Set();

  allTitles.forEach(t => {
    if (t.genres) {
      t.genres.split(',').forEach(g => {
        const clean = g.trim();
        if (clean) genresSet.add(clean);
      });
    }
    if (t.voice) {
      t.voice.split(',').forEach(v => {
        const clean = v.trim();
        if (clean) voiceSet.add(clean);
      });
    }
  });

  if (genresContainer) {
    genresContainer.innerHTML = Array.from(genresSet).sort((a, b) => a.localeCompare(b, 'ru')).map(genre => `
      <label class="checkbox-container">
        <input type="checkbox" value="${genre}" class="genre-filter">
        <span class="checkmark"></span>
        ${genre}
      </label>
    `).join('');
    genresContainer.addEventListener('change', renderCatalog);
  }

  if (voiceContainer) {
    voiceContainer.innerHTML = Array.from(voiceSet).sort((a, b) => a.localeCompare(b, 'ru')).map(voice => `
      <label class="checkbox-container">
        <input type="checkbox" value="${voice}" class="voice-filter">
        <span class="checkmark"></span>
        ${voice}
      </label>
    `).join('');
    voiceContainer.addEventListener('change', renderCatalog);
  }

  if (catalogSortOrder) {
    catalogSortOrder.addEventListener('change', renderCatalog);
  }
}

function renderCatalog() {
  if (!catalogGrid) return;

  const searchTerm = searchInput ? searchInput.value.toLowerCase().trim() : '';
  const selectedGenres = Array.from(document.querySelectorAll('.genre-filter:checked')).map(cb => cb.value);
  const selectedVoices = Array.from(document.querySelectorAll('.voice-filter:checked')).map(cb => cb.value);
  const sortVal = catalogSortOrder ? catalogSortOrder.value : 'newest';

  const filteredTitles = allTitles.filter(t => {
    const nameStr = (t.name || '').toLowerCase();
    const matchSearch = !searchTerm || nameStr.includes(searchTerm);

    const tGenres = t.genres ? t.genres.split(',').map(g => g.trim()) : [];
    const matchGenres = selectedGenres.length === 0 || selectedGenres.some(g => tGenres.includes(g));

    const tVoices = t.voice ? t.voice.split(',').map(v => v.trim()) : [];
    const matchVoices = selectedVoices.length === 0 || selectedVoices.some(v => tVoices.includes(v));

    return matchSearch && matchGenres && matchVoices;
  });

  filteredTitles.sort((a, b) => {
    if (sortVal === 'name-asc') return (a.name || '').localeCompare(b.name || '', 'ru');
    if (sortVal === 'name-desc') return (b.name || '').localeCompare(a.name || '', 'ru');

    const dateA = a.updatedAt ? new Date(a.updatedAt).getTime() : 0;
    const dateB = b.updatedAt ? new Date(b.updatedAt).getTime() : 0;

    if (sortVal === 'newest') return dateB - dateA;
    if (sortVal === 'oldest') return dateA - dateB;
    return 0;
  });

  if (filteredTitles.length === 0) {
    catalogGrid.innerHTML = '<div class="empty-state">По вашему запросу ничего не найдено</div>';
    return;
  }

  catalogGrid.innerHTML = filteredTitles.map(t => {
    const link = t.id === 'one_piece' ? 'index.html' : `title.html?id=${encodeURIComponent(t.id)}`;
    const poster = t.poster || 'https://via.placeholder.com/300x450?text=No+Poster';
    return `
      <a href="${link}" class="catalog-card">
        <div class="catalog-card-img">
          <img src="${poster}" alt="${t.name}" loading="lazy">
        </div>
        <div class="catalog-card-info">
          <h3>${t.name}</h3>
        </div>
      </a>
    `;
  }).join('');
}

if (searchInput) {
  searchInput.addEventListener('input', debounce(renderCatalog, 250));
}

// Оптимизированный перенос сайдбара через matchMedia (срабатывает только при пересечении 980px)
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
    document.body.style.overflow = '';
  }
}
mobileQuery.addEventListener('change', handleViewportChange);
handleViewportChange(mobileQuery);

function toggleMobileFilter() {
  if (!catalogSidebar || !filterOverlay) return;
  const isOpen = catalogSidebar.classList.toggle('open');
  filterOverlay.classList.toggle('open', isOpen);
  document.body.style.overflow = isOpen ? 'hidden' : '';
}

if (mobileFilterBtn) mobileFilterBtn.addEventListener('click', toggleMobileFilter);
if (closeFilterBtn) closeFilterBtn.addEventListener('click', toggleMobileFilter);
if (filterOverlay) filterOverlay.addEventListener('click', toggleMobileFilter);

const floatingMenuBtn = document.getElementById('floatingMenuBtn');
const floatingMenu = document.getElementById('floatingMenu');
if (floatingMenuBtn && floatingMenu) {
  floatingMenuBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    floatingMenu.classList.toggle('active');
    floatingMenuBtn.classList.toggle('is-open');
  });
  document.addEventListener('click', (e) => {
    if (!floatingMenu.contains(e.target) && e.target !== floatingMenuBtn) {
      floatingMenu.classList.remove('active');
      floatingMenuBtn.classList.remove('is-open');
    }
  });
}

const themeBtn = document.getElementById('themeBtn');
if (themeBtn) {
  themeBtn.addEventListener('click', () => {
    const newTheme = document.body.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
    document.body.setAttribute('data-theme', newTheme);
    localStorage.setItem('theme', newTheme);
  });
}

document.addEventListener('DOMContentLoaded', () => {
  document.body.setAttribute('data-theme', localStorage.getItem('theme') || 'dark');
  initCatalog();
});
