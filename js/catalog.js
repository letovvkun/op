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

async function initCatalog() {
    catalogGrid.innerHTML = '';
    // Рисуем скелетоны загрузки
    let skeletons = '';
    for(let i=0; i<4; i++) {
        skeletons += `<div class="catalog-card"><div class="catalog-card-img" style="background: rgba(255,255,255,0.05); animation: pulse 1.5s infinite;"></div><div class="catalog-card-info"><div style="height: 14px; background: rgba(255,255,255,0.05); border-radius: 4px; margin-bottom: 6px;"></div></div></div>`;
    }
    catalogGrid.innerHTML = skeletons;

    try {
        // Проверяем, есть ли тайтлы в кэше
        const cachedTitles = sessionStorage.getItem('catalogTitles');
        
        if (cachedTitles) {
            allTitles = JSON.parse(cachedTitles); // Берем из кэша (0 запросов к базе)
        } else {
            const snap = await getDocs(collection(db, "titles"));
            allTitles = snap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
            // Сохраняем в кэш
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
        if (t.genres) t.genres.split(',').forEach(g => { const clean = g.trim(); if(clean) genresSet.add(clean); });
        if (t.voice) t.voice.split(',').forEach(v => { const clean = v.trim(); if(clean) voiceSet.add(clean); });
    });

    genresContainer.innerHTML = '';
    Array.from(genresSet).sort().forEach(genre => {
        genresContainer.innerHTML += `
            <label class="checkbox-container">
                <input type="checkbox" value="${genre}" class="genre-filter">
                <span class="checkmark"></span>
                ${genre}
            </label>
        `;
    });

    voiceContainer.innerHTML = '';
    Array.from(voiceSet).sort().forEach(voice => {
        voiceContainer.innerHTML += `
            <label class="checkbox-container">
                <input type="checkbox" value="${voice}" class="voice-filter">
                <span class="checkmark"></span>
                ${voice}
            </label>
        `;
    });

    document.querySelectorAll('.genre-filter, .voice-filter').forEach(cb => {
        cb.addEventListener('change', renderCatalog);
    });
    
    catalogSortOrder.addEventListener('change', renderCatalog);
}

function renderCatalog() {
    const searchTerm = searchInput.value.toLowerCase().trim();
    const selectedGenres = Array.from(document.querySelectorAll('.genre-filter:checked')).map(cb => cb.value);
    const selectedVoices = Array.from(document.querySelectorAll('.voice-filter:checked')).map(cb => cb.value);
    const sortVal = catalogSortOrder.value;

    let filteredTitles = allTitles.filter(t => {
        const matchSearch = t.name.toLowerCase().includes(searchTerm);
        const tGenres = t.genres ? t.genres.split(',').map(g => g.trim()) : [];
        const matchGenres = selectedGenres.length === 0 || selectedGenres.some(g => tGenres.includes(g));
        const tVoices = t.voice ? t.voice.split(',').map(v => v.trim()) : [];
        const matchVoices = selectedVoices.length === 0 || selectedVoices.some(v => tVoices.includes(v));

        return matchSearch && matchGenres && matchVoices;
    });
    
    // Сортировка
    filteredTitles.sort((a, b) => {
        if (sortVal === 'name-asc') return a.name.localeCompare(b.name, 'ru');
        if (sortVal === 'name-desc') return b.name.localeCompare(a.name, 'ru');
        
        const dateA = a.updatedAt ? new Date(a.updatedAt).getTime() : 0;
        const dateB = b.updatedAt ? new Date(b.updatedAt).getTime() : 0;
        
        if (sortVal === 'newest') return dateB - dateA;
        if (sortVal === 'oldest') return dateA - dateB;
        
        return 0;
    });

    if (filteredTitles.length === 0) {
        catalogGrid.innerHTML = '<div class="empty-state">По вашему запросу ничего не найдено 💔</div>';
        return;
    }

    // СОБИРАЕМ HTML В СТРОКУ, ВМЕСТО innerHTML +=
    let htmlString = "";
    filteredTitles.forEach(t => {
        const link = t.id === 'one_piece' ? 'index.html' : `title.html?id=${t.id}`;
        htmlString += `
            <a href="${link}" class="catalog-card">
                <div class="catalog-card-img">
                    <img src="${t.poster || 'https://via.placeholder.com/300x450?text=No+Poster'}" alt="${t.name}" loading="lazy">
                </div>
                <div class="catalog-card-info">
                    <h3>${t.name}</h3>
                </div>
            </a>
        `;
    });
    
    // Вставляем всё на страницу за 1 раз
    catalogGrid.innerHTML = htmlString;
}

let searchTimeout;
searchInput.addEventListener('input', () => {
    clearTimeout(searchTimeout);
    searchTimeout = setTimeout(renderCatalog, 300);
});

function adaptSidebar() {
    if (window.innerWidth <= 980) {
        if (catalogSidebar.parentNode !== document.body) {
            document.body.appendChild(catalogSidebar);
        }
    } else {
        if (catalogSidebar.parentNode !== catalogLayout) {
            catalogLayout.appendChild(catalogSidebar);
        }
    }
}
window.addEventListener('resize', adaptSidebar);
adaptSidebar();

function toggleMobileFilter() {
    catalogSidebar.classList.toggle('open');
    filterOverlay.classList.toggle('open');
    if (catalogSidebar.classList.contains('open')) {
        document.body.style.overflow = 'hidden'; 
    } else {
        document.body.style.overflow = '';
    }
}

mobileFilterBtn.addEventListener('click', toggleMobileFilter);
closeFilterBtn.addEventListener('click', toggleMobileFilter);
filterOverlay.addEventListener('click', toggleMobileFilter);

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
if(themeBtn) themeBtn.addEventListener('click', () => {
    const body = document.body;
    const currentTheme = body.getAttribute('data-theme');
    const newTheme = currentTheme === 'dark' ? 'light' : 'dark';
    body.setAttribute('data-theme', newTheme);
    localStorage.setItem('theme', newTheme);
});

document.addEventListener('DOMContentLoaded', () => {
    const savedTheme = localStorage.getItem('theme') || 'dark';
    document.body.setAttribute('data-theme', savedTheme);
    initCatalog();
});