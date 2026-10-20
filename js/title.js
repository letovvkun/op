import { db } from "./firebase.js";
import { collection, getDocs, doc, getDoc, setDoc, increment, query, where } from "https://www.gstatic.com/firebasejs/9.22.1/firebase-firestore.js";

const urlParams = new URLSearchParams(window.location.search);
const currentTitleId = urlParams.get('id');

if (!currentTitleId) {
  window.location.replace('catalog.html');
}

// Чистая векторная SVG-галочка (не превращается в эмодзи на iOS)
const CHECK_ICON_SVG = `<svg viewBox="0 0 24 24" aria-hidden="true"><polyline points="20 6 9 17 4 12"></polyline></svg>`;

// --- Состояние ---
let episodes = [];
let currentIndex = -1;
const INITIAL_VISIBLE_COUNT = 8;
let visibleEpisodesCount = INITIAL_VISIBLE_COUNT;
let watchedEpisodes = new Set();
const PLAYER_SOURCE_KEY = 'lastPlayerSource';
const LAST_EP_TITLE_KEY = `lastEp_${currentTitleId}`;
let currentSortOrder = 'desc';
let plyrInstance = null;

// Данные для быстрого поиска по тайтлам
let quickSearchTitles = [];
let isQuickTitlesLoaded = false;

const playerNames = {
  hf: 'Без сжатия | Бета',
  dzen: 'Dzen | 4K',
  mega: 'Moon Player | 1080p',
  kodik: 'Kodik | 720p',
  subtitles: 'Dzen | Субтитры'
};

// --- DOM Элементы ---
const episodesGrid = document.getElementById('episodesGrid');
const playerEmbed = document.getElementById('playerEmbed');
const playerTitle = document.getElementById('playerTitle');
const playerSub = document.getElementById('playerSub');
const search = document.getElementById('search');
const playerSourceSelect = document.getElementById('playerSource');
const prevBtn = document.getElementById('prevBtn');
const nextBtn = document.getElementById('nextBtn');
const shareBtn = document.getElementById('shareBtn');
const loadMoreContainer = document.getElementById('loadMoreContainer');
const loadMoreBtn = document.getElementById('loadMoreBtn');
const loadMoreText = document.getElementById('loadMoreText');
const paginationInfo = document.getElementById('paginationInfo');
const sortSelect = document.getElementById('sortOrder');
const scrollTopBtn = document.getElementById('scrollTopBtn');

// Элементы поиска по тайтлам
const titleSearchBtn = document.getElementById('titleSearchBtn');
const titleSearchPopup = document.getElementById('titleSearchPopup');
const quickTitleInput = document.getElementById('quickTitleInput');
const quickTitleResults = document.getElementById('quickTitleResults');

function debounce(fn, delay = 250) {
  let timer;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), delay);
  };
}

function showToast(message) {
  let toast = document.querySelector('.toast-notification');
  if (!toast) {
    toast = document.createElement('div');
    toast.className = 'toast-notification';
    document.body.appendChild(toast);
  }
  toast.textContent = message;
  toast.classList.add('show');
  clearTimeout(toast._hideTimer);
  toast._hideTimer = setTimeout(() => toast.classList.remove('show'), 2600);
}

// --- Неблокирующая отправка телеметрии для Дашборда админки ---
function recordTelemetryEvent(playerKey = null) {
  try {
    const todayKey = new Date().toISOString().split('T')[0];
    const payload = {
      lastActive: new Date().toISOString()
    };
    if (playerKey) {
      payload.players = { [playerKey]: increment(1) };
    } else {
      payload.totalViews = increment(1);
      payload.daily = { [todayKey]: increment(1) };
    }
    setDoc(doc(db, 'settings', 'telemetry'), payload, { merge: true }).catch(() => {});
  } catch (_) {}
}

// --- Проверка: доступна ли серия зрителям (фильтр черновиков и отложенных серий) ---
function isEpisodePublic(ep) {
  if (!ep) return false;
  if (ep.status === 'draft' || ep.isDraft === true) return false;
  if (ep.status === 'scheduled' && ep.publishAt) {
    const publishTime = new Date(ep.publishAt).getTime();
    if (!isNaN(publishTime) && publishTime > Date.now()) {
      return false;
    }
  }
  return true;
}

// --- Быстрый поиск по тайтлам в шапке ---
async function ensureQuickTitlesLoaded() {
  if (isQuickTitlesLoaded) return;
  try {
    const cached = sessionStorage.getItem('catalogTitles');
    if (cached) {
      quickSearchTitles = JSON.parse(cached);
    } else {
      const snap = await getDocs(collection(db, "titles"));
      quickSearchTitles = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      sessionStorage.setItem('catalogTitles', JSON.stringify(quickSearchTitles));
    }
    isQuickTitlesLoaded = true;
    renderQuickTitleResults(quickTitleInput ? quickTitleInput.value : '');
  } catch (err) {
    console.error("Ошибка загрузки списка тайтлов:", err);
    if (quickTitleResults) {
      quickTitleResults.innerHTML = `<div class="title-search-empty">Ошибка загрузки каталога</div>`;
    }
  }
}

function renderQuickTitleResults(queryText = '') {
  if (!quickTitleResults) return;
  const q = queryText.trim().toLowerCase();

  const filtered = quickSearchTitles.filter(t => {
    const name = (t.name || '').toLowerCase();
    const genres = (t.genres || '').toLowerCase();
    return !q || name.includes(q) || genres.includes(q);
  }).slice(0, 12);

  if (filtered.length === 0) {
    quickTitleResults.innerHTML = `<div class="title-search-empty">Тайтлы не найдены</div>`;
    return;
  }

  quickTitleResults.innerHTML = filtered.map(t => {
    const link = t.id === 'one_piece' ? 'index.html' : `title.html?id=${encodeURIComponent(t.id)}`;
    const poster = t.poster || 'https://via.placeholder.com/120x180?text=No+Poster';
    const meta = t.genres || 'Аниме';
    return `
      <a href="${link}" class="title-search-item">
        <img src="${poster}" alt="${t.name}" loading="lazy">
        <div class="title-search-item-info">
          <div class="title-search-item-name">${t.name}</div>
          <div class="title-search-item-meta">${meta}</div>
        </div>
      </a>
    `;
  }).join('');
}

function initQuickTitleSearch() {
  if (!titleSearchBtn || !titleSearchPopup) return;

  const closeSearchPopup = () => {
    titleSearchPopup.classList.remove('open');
    titleSearchBtn.classList.remove('active');
    titleSearchBtn.setAttribute('aria-expanded', 'false');
  };

  titleSearchBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    const willOpen = !titleSearchPopup.classList.contains('open');
    titleSearchPopup.classList.toggle('open', willOpen);
    titleSearchBtn.classList.toggle('active', willOpen);
    titleSearchBtn.setAttribute('aria-expanded', String(willOpen));

    if (willOpen) {
      ensureQuickTitlesLoaded();
      if (quickTitleInput && window.innerWidth > 768) {
        setTimeout(() => quickTitleInput.focus(), 50);
      }
    }
  });

  if (quickTitleInput) {
    quickTitleInput.addEventListener('input', debounce((e) => {
      renderQuickTitleResults(e.target.value);
    }, 150));
  }

  document.addEventListener('click', (e) => {
    if (!titleSearchPopup.contains(e.target) && !titleSearchBtn.contains(e.target)) {
      closeSearchPopup();
    }
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && titleSearchPopup.classList.contains('open')) {
      closeSearchPopup();
    }
  });
}

function updateBounty() {
  const bountyElem = document.getElementById('bountyAmount');
  if (!bountyElem) return;
  bountyElem.textContent = (watchedEpisodes.size * 1500000).toLocaleString('en-US');
}

function loadWatchedStatus() {
  try {
    const saved = localStorage.getItem('watchedEpisodes');
    if (saved) watchedEpisodes = new Set(JSON.parse(saved));
  } catch (e) {
    watchedEpisodes = new Set();
  }
  updateBounty();
}

function saveWatchedStatus() {
  localStorage.setItem('watchedEpisodes', JSON.stringify([...watchedEpisodes]));
}

function markEpisodeWatched(epId, watched = true) {
  if (!epId) return;
  if (watched) watchedEpisodes.add(epId);
  else watchedEpisodes.delete(epId);

  saveWatchedStatus();
  updateBounty();

  if (episodesGrid) {
    const card = episodesGrid.querySelector(`.ep[data-firestore-id="${epId}"]`);
    if (card) {
      card.classList.toggle('watched', watched);
      const btn = card.querySelector('.ep-watch-toggle');
      if (btn) btn.setAttribute('aria-pressed', String(watched));
    }
  }
}

async function loadTitleData() {
  try {
    const snap = await getDoc(doc(db, "titles", currentTitleId));
    if (snap.exists()) {
      const data = snap.data();
      document.title = `${data.name} | Макс Летов & ShiYori`;
      const headerName = document.getElementById('headerTitleName');
      const sidebarName = document.getElementById('sidebarTitleName');
      const posterImg = document.getElementById('titlePosterImg');
      const genresInfo = document.getElementById('titleGenresInfo');
      const voiceInfo = document.getElementById('titleVoiceInfo');
      const descInfo = document.getElementById('titleDescInfo');

      if (headerName) headerName.textContent = data.name;
      if (sidebarName) sidebarName.textContent = data.name;
      if (posterImg) posterImg.src = data.poster || 'https://via.placeholder.com/300x450?text=No+Poster';
      if (genresInfo) genresInfo.textContent = data.genres || 'Не указаны';
      if (voiceInfo) voiceInfo.textContent = data.voice || 'Макс Летов & ShiYori';
      if (descInfo) descInfo.textContent = data.desc || 'Описание отсутствует.';
    } else {
      const headerName = document.getElementById('headerTitleName');
      if (headerName) headerName.textContent = "Тайтл не найден";
    }
  } catch (err) {
    console.error("Ошибка загрузки тайтла:", err);
  }
}

async function loadEpisodes() {
  if (episodesGrid) {
    episodesGrid.innerHTML = '<div style="text-align:center;padding:2rem;width:100%;color:var(--muted);">Загрузка серий...</div>';
  }
  try {
    const q = query(collection(db, "episodes"), where("titleId", "==", currentTitleId));
    const snap = await getDocs(q);

    episodes = snap.docs
      .map(d => ({ firestoreId: d.id, ...d.data() }))
      .filter(isEpisodePublic);

    sortEpisodes();

    if (episodes.length > 0) {
      const savedEpId = localStorage.getItem(LAST_EP_TITLE_KEY);
      const savedIdx = savedEpId ? episodes.findIndex(e => e.firestoreId === savedEpId) : -1;
      loadEpisode(savedIdx !== -1 ? savedIdx : 0, false);
    } else {
      if (playerEmbed) playerEmbed.innerHTML = `<span>Для этого тайтла пока нет добавленных серий.</span>`;
      if (playerTitle) playerTitle.textContent = 'Ожидание эпизодов...';
    }
  } catch (error) {
    console.error("Ошибка загрузки серий:", error);
    if (episodesGrid) {
      episodesGrid.innerHTML = `<div style="text-align:center;padding:2rem;width:100%;color:var(--error);">Ошибка загрузки серий.</div>`;
    }
  }
}

function getFilteredEpisodes(filter = '') {
  const term = filter.trim().toLowerCase();
  return episodes.filter(ep =>
    term ? ep.title.toLowerCase().includes(term) || String(ep.id).includes(term) : true
  );
}

function sortEpisodes() {
  episodes.sort((a, b) => currentSortOrder === 'desc' ? b.id - a.id : a.id - b.id);
  renderList(search ? search.value : '');
}

function renderList(filter = '') {
  if (!episodesGrid) return;
  const term = filter.trim().toLowerCase();
  const filteredEpisodes = getFilteredEpisodes(filter);
  const episodesToRender = filteredEpisodes.slice(0, visibleEpisodesCount);

  episodesGrid.innerHTML = '';

  if (episodesToRender.length === 0) {
    episodesGrid.innerHTML = '<div style="text-align:center;padding:2rem;width:100%;color:var(--muted);">Ничего не найдено.</div>';
  } else {
    const fragment = document.createDocumentFragment();

    episodesToRender.forEach((ep, loopIndex) => {
      const el = document.createElement('div');
      el.className = 'ep';
      if (!term && loopIndex === 0 && currentSortOrder === 'desc') {
        el.classList.add('new-episode');
      }

      const isWatched = watchedEpisodes.has(ep.firestoreId);
      if (isWatched) el.classList.add('watched');

      el.tabIndex = 0;
      el.setAttribute('role', 'button');
      el.dataset.firestoreId = ep.firestoreId;

      el.innerHTML = `
        <div class="thumb" aria-hidden="true">
          ${ep.thumb ? `<img src="${ep.thumb}" alt="" loading="lazy">` : `EP ${ep.id}`}
        </div>
        <div class="meta">
          <div class="t">${ep.title}</div>
          <div class="s">${ep.date} • ${ep.quality}</div>
        </div>
        <button type="button" class="ep-watch-toggle" title="Отметить просмотренным" aria-label="Отметить просмотренным" aria-pressed="${isWatched}">${CHECK_ICON_SVG}</button>
      `;

      fragment.appendChild(el);
    });

    episodesGrid.appendChild(fragment);
  }

  if (loadMoreContainer) {
    if (filteredEpisodes.length > visibleEpisodesCount) {
      loadMoreContainer.style.display = 'flex';
      loadMoreText.textContent = 'Показать еще';
      loadMoreBtn.classList.remove('expanded');
    } else if (visibleEpisodesCount > INITIAL_VISIBLE_COUNT && filteredEpisodes.length > 0) {
      loadMoreContainer.style.display = 'flex';
      loadMoreText.textContent = 'Свернуть';
      loadMoreBtn.classList.add('expanded');
    } else {
      loadMoreContainer.style.display = 'none';
    }
  }

  if (paginationInfo) {
    paginationInfo.textContent = `Показано ${Math.min(visibleEpisodesCount, filteredEpisodes.length)} из ${filteredEpisodes.length}`;
  }

  markActive();
}

if (episodesGrid) {
  const handleGridAction = (e) => {
    const toggleBtn = e.target.closest('.ep-watch-toggle');
    const card = e.target.closest('.ep');
    if (!card || !card.dataset.firestoreId) return;

    const epId = card.dataset.firestoreId;

    if (toggleBtn) {
      e.stopPropagation();
      e.preventDefault();
      markEpisodeWatched(epId, !watchedEpisodes.has(epId));
      return;
    }

    const targetIdx = episodes.findIndex(item => item.firestoreId === epId);
    if (!watchedEpisodes.has(epId)) {
      markEpisodeWatched(epId, true);
    }
    if (targetIdx !== -1 && currentIndex !== targetIdx) {
      loadEpisode(targetIdx, true);
    }
  };

  episodesGrid.addEventListener('click', handleGridAction);
  episodesGrid.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      handleGridAction(e);
    }
  });
}

function ensureEpisodeVisibleInList(ep) {
  if (!ep) return;
  const currentSearch = search ? search.value : '';
  const filtered = getFilteredEpisodes(currentSearch);
  const posInFiltered = filtered.findIndex(item => item.firestoreId === ep.firestoreId);

  if (posInFiltered !== -1 && posInFiltered >= visibleEpisodesCount) {
    const extraNeeded = posInFiltered + 1 - visibleEpisodesCount;
    const steps = Math.ceil(extraNeeded / 12) * 12;
    visibleEpisodesCount = Math.min(visibleEpisodesCount + steps, filtered.length);
    renderList(currentSearch);
  }
}

// Безопасный рендер видеоплеера (Защита от XSS)
function setSafePlayerEmbed(rawContent, episodeTitle = '') {
  playerEmbed.innerHTML = '';
  if (!rawContent) {
    playerEmbed.innerHTML = `<span style="color:var(--muted);">Видео пока недоступно.</span>`;
    return;
  }

  const trimmed = rawContent.trim();
  if (trimmed.startsWith('http://') || trimmed.startsWith('https://')) {
    const iframe = document.createElement('iframe');
    iframe.src = trimmed;
    iframe.title = episodeTitle || 'Плеер';
    iframe.allow = "autoplay; fullscreen; picture-in-picture";
    iframe.allowFullscreen = true;
    playerEmbed.appendChild(iframe);
  } else if (trimmed.startsWith('<iframe')) {
    const parser = new DOMParser();
    const docParsed = parser.parseFromString(trimmed, 'text/html');
    const srcIframe = docParsed.querySelector('iframe');
    if (srcIframe && srcIframe.src) {
      const iframe = document.createElement('iframe');
      iframe.src = srcIframe.src;
      iframe.title = episodeTitle || 'Плеер';
      iframe.allow = "autoplay; fullscreen; picture-in-picture";
      iframe.allowFullscreen = true;
      playerEmbed.appendChild(iframe);
    } else {
      playerEmbed.innerHTML = trimmed;
    }
  } else {
    playerEmbed.innerHTML = trimmed;
  }
}

function loadEpisode(idx, shouldScroll = false) {
  if (idx < 0 || idx >= episodes.length) return;
  currentIndex = idx;
  const ep = episodes[idx];

  localStorage.setItem(LAST_EP_TITLE_KEY, ep.firestoreId);

  ensureEpisodeVisibleInList(ep);
  recordTelemetryEvent();

  if (playerSourceSelect) {
    playerSourceSelect.innerHTML = '';
    const availablePlayers = Object.keys(ep.players || {}).filter(k => ep.players[k]);

    if (plyrInstance) {
      plyrInstance.destroy();
      plyrInstance = null;
    }

    if (availablePlayers.length === 0) {
      playerSourceSelect.innerHTML = `<option value="">Нет плееров</option>`;
      playerEmbed.innerHTML = `<span style="color:var(--muted);">Для этой серии видео пока недоступно.</span>`;
    } else {
      playerSourceSelect.innerHTML = availablePlayers.map(key => {
        const name = playerNames[key] || key.toUpperCase();
        return `<option value="${key}">${name}</option>`;
      }).join('');

      const savedSource = localStorage.getItem(PLAYER_SOURCE_KEY) || 'hf';
      const selectedPlayer = availablePlayers.includes(savedSource) ? savedSource : availablePlayers[0];
      playerSourceSelect.value = selectedPlayer;

      if (selectedPlayer === 'hf') {
        const fileName = ep.players.hf;
        const videoUrl = `https://huggingface.co/datasets/letovvkun/op_archive/resolve/main/${fileName}?download=true`;
        playerEmbed.innerHTML = `<video id="plyr-hf-player" playsinline controls><source src="${videoUrl}" type="video/mp4" size="1080"></video>`;
        if (typeof Plyr !== 'undefined') {
          plyrInstance = new Plyr('#plyr-hf-player', {
            title: ep.title,
            controls: ['play-large', 'play', 'progress', 'current-time', 'duration', 'mute', 'volume', 'settings', 'fullscreen'],
            settings: ['quality', 'speed'],
            quality: { default: 1080, options: [1080, 720, 480] },
            fullscreen: { iosNative: true }
          });
        }
      } else {
        setSafePlayerEmbed(ep.players[selectedPlayer], ep.title);
      }
    }
  }

  if (playerTitle) playerTitle.textContent = ep.title;
  if (playerSub) playerSub.textContent = `${ep.date} • ${ep.quality}`;
  markActive();

  if (shouldScroll && window.innerWidth < 980 && playerTitle) {
    playerTitle.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
}

function markActive() {
  if (currentIndex < 0 || !episodesGrid) return;
  const currentEpId = episodes[currentIndex]?.firestoreId;
  Array.from(episodesGrid.children).forEach(node => {
    node.classList.toggle('active', node.dataset.firestoreId === currentEpId);
  });
}

// --- Обработчики ---
if (playerSourceSelect) {
  playerSourceSelect.addEventListener('change', () => {
    const newPlayer = playerSourceSelect.value;
    localStorage.setItem(PLAYER_SOURCE_KEY, newPlayer);
    recordTelemetryEvent(newPlayer);
    if (currentIndex !== -1) loadEpisode(currentIndex);
  });
}

if (search) {
  search.addEventListener('input', debounce((e) => {
    visibleEpisodesCount = INITIAL_VISIBLE_COUNT;
    renderList(e.target.value);
  }));
}

if (sortSelect) {
  sortSelect.addEventListener('change', (e) => {
    currentSortOrder = e.target.value;
    visibleEpisodesCount = INITIAL_VISIBLE_COUNT;
    sortEpisodes();
  });
}

if (loadMoreBtn) {
  loadMoreBtn.addEventListener('click', () => {
    const currentSearch = search ? search.value : '';
    if (loadMoreBtn.classList.contains('expanded')) {
      visibleEpisodesCount = INITIAL_VISIBLE_COUNT;
      renderList(currentSearch);
      episodesGrid.scrollIntoView({ behavior: 'smooth', block: 'start' });
    } else {
      visibleEpisodesCount += 12;
      renderList(currentSearch);
    }
  });
}

if (prevBtn) {
  prevBtn.addEventListener('click', () => {
    if (currentIndex < episodes.length - 1) loadEpisode(currentIndex + 1, true);
  });
}
if (nextBtn) {
  nextBtn.addEventListener('click', () => {
    if (currentIndex > 0) loadEpisode(currentIndex - 1, true);
  });
}

if (shareBtn) {
  shareBtn.addEventListener('click', async () => {
    try {
      if (navigator.share) {
        await navigator.share({ title: document.title, url: window.location.href });
      } else {
        await navigator.clipboard.writeText(window.location.href);
        showToast('Ссылка скопирована!');
      }
    } catch (err) {}
  });
}

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

window.addEventListener('scroll', () => {
  if (scrollTopBtn) scrollTopBtn.classList.toggle('visible', window.scrollY > 500);
}, { passive: true });

if (scrollTopBtn) {
  scrollTopBtn.addEventListener('click', () => window.scrollTo({ top: 0, behavior: 'smooth' }));
}

document.addEventListener('DOMContentLoaded', () => {
  document.body.setAttribute('data-theme', localStorage.getItem('theme') || 'dark');
  loadWatchedStatus();
  initQuickTitleSearch();
  Promise.all([loadTitleData(), loadEpisodes()]);
});
