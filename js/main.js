import { db, analytics } from "./firebase.js";
import { collection, getDocs, orderBy, query, doc, getDoc, setDoc, increment, limit } from "https://www.gstatic.com/firebasejs/9.22.1/firebase-firestore.js";
import { logEvent } from "https://www.gstatic.com/firebasejs/9.22.1/firebase-analytics.js";

const episodesCollection = collection(db, 'episodes');

// Чистая векторная SVG-галочка (не превращается в эмодзи на iOS)
const CHECK_ICON_SVG = `<svg viewBox="0 0 24 24" aria-hidden="true"><polyline points="20 6 9 17 4 12"></polyline></svg>`;

// --- Состояние ---
let episodes = [];
let currentIndex = -1;
const INITIAL_VISIBLE_COUNT = 8;
let visibleEpisodesCount = INITIAL_VISIBLE_COUNT;
let watchedEpisodes = new Set();
const PLAYER_SOURCE_KEY = 'lastPlayerSource';
const LAST_EPISODE_ID_KEY = 'lastEpisodeFirestoreId';
let currentSortOrder = 'desc';
let timerInterval = null;
let logPoseConfig = null;
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
const metaText = document.getElementById('metaText');
const search = document.getElementById('search');
const playerSourceSelect = document.getElementById('playerSource');
const themeBtn = document.getElementById('themeBtn');
const prevBtn = document.getElementById('prevBtn');
const nextBtn = document.getElementById('nextBtn');
const shareBtn = document.getElementById('shareBtn');
const copyrightModal = document.getElementById('copyrightModal');
const closeCopyrightModalBtn = document.getElementById('closeCopyrightModal');
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

// --- Утилиты ---
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

// --- Награда и прогресс просмотра ---
function updateBounty() {
  const bountyElem = document.getElementById('bountyAmount');
  if (!bountyElem) return;
  const totalBounty = watchedEpisodes.size * 1500000;
  bountyElem.textContent = totalBounty.toLocaleString('en-US');
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

// --- Лог-пос Таймер ---
function computeNextTargetDate(cfg) {
  const now = new Date();

  if (cfg && cfg.targetDate) {
    const rawDate = new Date(cfg.targetDate);
    if (!isNaN(rawDate.getTime())) {
      if (rawDate > now) return rawDate;

      if (cfg.isWeekly !== false && cfg.mode !== 'once') {
        const nextDate = new Date(rawDate.getTime());
        const weekMs = 7 * 24 * 60 * 60 * 1000;
        const weeksPassed = Math.floor((now.getTime() - nextDate.getTime()) / weekMs) + 1;
        nextDate.setTime(nextDate.getTime() + weeksPassed * weekMs);
        return nextDate;
      }
      return rawDate;
    }
  }

  const targetDay = (cfg && cfg.dayOfWeek !== undefined) ? Number(cfg.dayOfWeek) : 0;
  let hours = 23;
  let minutes = 0;

  if (cfg && typeof cfg.time === 'string' && cfg.time.includes(':')) {
    const parts = cfg.time.split(':');
    hours = parseInt(parts[0], 10) || 23;
    minutes = parseInt(parts[1], 10) || 0;
  } else if (cfg && cfg.hour !== undefined) {
    hours = Number(cfg.hour);
    minutes = Number(cfg.minute || 0);
  }

  const mskOffsetMs = 3 * 60 * 60 * 1000;
  const nowMsk = new Date(now.getTime() + mskOffsetMs);
  const currentDay = nowMsk.getUTCDay();

  let daysUntil = (targetDay - currentDay + 7) % 7;
  const candidateMsk = new Date(nowMsk.getTime());
  candidateMsk.setUTCDate(nowMsk.getUTCDate() + daysUntil);
  candidateMsk.setUTCHours(hours, minutes, 0, 0);

  if (candidateMsk <= nowMsk) {
    candidateMsk.setUTCDate(candidateMsk.getUTCDate() + 7);
  }

  return new Date(candidateMsk.getTime() - mskOffsetMs);
}

async function initLogPoseTimer() {
  const countElem = document.getElementById('countdown');
  if (!countElem) return;

  try {
    const snap = await getDoc(doc(db, 'settings', 'log_pose'));
    if (snap.exists()) {
      logPoseConfig = snap.data();
    } else {
      logPoseConfig = { isWeekly: true, dayOfWeek: 0, time: '23:00' };
    }
    startCountdown();
  } catch (error) {
    console.error("Ошибка таймера:", error);
    logPoseConfig = { isWeekly: true, dayOfWeek: 0, time: '23:00' };
    startCountdown();
  }
}

function startCountdown() {
  const countElem = document.getElementById('countdown');
  if (!countElem) return;

  const update = () => {
    const targetDate = computeNextTargetDate(logPoseConfig);
    const diff = targetDate - new Date();

    if (diff <= 0) {
      countElem.textContent = "Уже скоро!";
      return;
    }

    const d = Math.floor(diff / (1000 * 60 * 60 * 24));
    const h = String(Math.floor((diff / (1000 * 60 * 60)) % 24)).padStart(2, '0');
    const m = String(Math.floor((diff / 1000 / 60) % 60)).padStart(2, '0');

    countElem.textContent = d > 0 ? `${d}д ${h}ч ${m}м` : `${h}ч ${m}м`;
  };

  update();
  if (timerInterval) clearInterval(timerInterval);
  timerInterval = setInterval(update, 30000);
}

// --- Загрузка и рендер серий ---
function renderSkeletons() {
  if (!episodesGrid) return;
  episodesGrid.innerHTML = Array.from({ length: INITIAL_VISIBLE_COUNT }, () => `
    <div class="ep" style="pointer-events: none;">
      <div class="thumb skeleton-loader" style="border:none;"></div>
      <div class="meta" style="width:100%">
        <div class="skeleton-loader" style="height:14px; width:70%; margin-bottom:6px;"></div>
        <div class="skeleton-loader" style="height:12px; width:40%;"></div>
      </div>
    </div>
  `).join('');
}

function sortEpisodes() {
  episodes.sort((a, b) => currentSortOrder === 'desc' ? b.id - a.id : a.id - b.id);
  renderList(search ? search.value : '');
}

async function loadEpisodes() {
  renderSkeletons();

  try {
    let rawEpisodes = [];
    const cached = sessionStorage.getItem('mainEpisodes');
    if (cached) {
      rawEpisodes = JSON.parse(cached);
    } else {
      const q = query(episodesCollection, orderBy("id", "desc"), limit(150));
      const snap = await getDocs(q);
      rawEpisodes = snap.docs
        .map(d => ({ firestoreId: d.id, ...d.data() }))
        .filter(ep => !ep.titleId || ep.titleId === 'one_piece');

      sessionStorage.setItem('mainEpisodes', JSON.stringify(rawEpisodes));
    }

    // Отсеиваем черновики и серии, время открытия которых по таймеру ещё не наступило
    episodes = rawEpisodes.filter(isEpisodePublic);

    sortEpisodes();

    if (episodes.length > 0) {
      const savedId = localStorage.getItem(LAST_EPISODE_ID_KEY);
      const foundIdx = savedId ? episodes.findIndex(e => e.firestoreId === savedId) : -1;
      loadEpisode(foundIdx !== -1 ? foundIdx : 0, false);
    } else {
      if (playerEmbed) playerEmbed.innerHTML = `<span>Серии пока не добавлены.</span>`;
      if (playerTitle) playerTitle.textContent = 'Нет доступных серий';
    }
  } catch (error) {
    console.error("Ошибка при загрузке серий из Firestore:", error);
    if (episodesGrid) {
      episodesGrid.innerHTML = `<div style="text-align:center;padding:2rem;width:100%;color:var(--error);">Ошибка загрузки данных.</div>`;
    }
  }
}

function getFilteredEpisodes(filter = '') {
  const term = filter.trim().toLowerCase();
  return episodes.filter(ep =>
    term ? ep.title.toLowerCase().includes(term) || String(ep.id).includes(term) : true
  );
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
    const currentCount = Math.min(visibleEpisodesCount, filteredEpisodes.length);
    paginationInfo.textContent = `Показано ${currentCount} из ${filteredEpisodes.length}`;
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

  localStorage.setItem(LAST_EPISODE_ID_KEY, ep.firestoreId);
  document.title = `EP ${ep.id} — ${ep.title} | Ван-Пис в озвучке Макс Летов & ShiYori`;

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
  if (metaText) metaText.textContent = `EP ${ep.id} • Загружено: ${ep.date}`;

  markActive();

  if (shouldScroll && window.innerWidth < 980 && playerTitle) {
    playerTitle.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
}

function markActive() {
  if (currentIndex < 0 || !episodesGrid) return;
  const currentEpisodeId = episodes[currentIndex]?.firestoreId;
  Array.from(episodesGrid.children).forEach(node => {
    node.classList.toggle('active', node.dataset.firestoreId === currentEpisodeId);
  });
}

// --- Обработчики событий ---
if (prevBtn) {
  prevBtn.addEventListener('click', () => {
    if (currentIndex < episodes.length - 1) {
      loadEpisode(currentIndex + 1);
    }
  });
}
if (nextBtn) {
  nextBtn.addEventListener('click', () => {
    if (currentIndex > 0) {
      loadEpisode(currentIndex - 1);
    }
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

if (playerSourceSelect) {
  playerSourceSelect.addEventListener('change', () => {
    const newPlayer = playerSourceSelect.value;
    localStorage.setItem(PLAYER_SOURCE_KEY, newPlayer);
    logEvent(analytics, 'select_player', { player_name: newPlayer });
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
    const isExpanded = loadMoreBtn.classList.contains('expanded');
    const currentSearch = search ? search.value : '';

    if (isExpanded) {
      const episodesOnScreen = episodesGrid.querySelectorAll('.ep');
      for (let i = INITIAL_VISIBLE_COUNT; i < episodesOnScreen.length; i++) {
        episodesOnScreen[i].classList.add('hiding');
      }
      setTimeout(() => {
        visibleEpisodesCount = INITIAL_VISIBLE_COUNT;
        renderList(currentSearch);
        episodesGrid.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }, 250);
    } else {
      const totalFiltered = getFilteredEpisodes(currentSearch).length;
      visibleEpisodesCount = Math.min(visibleEpisodesCount + 12, totalFiltered);
      renderList(currentSearch);
    }
  });
}

window.addEventListener('scroll', () => {
  if (scrollTopBtn) scrollTopBtn.classList.toggle('visible', window.scrollY > 500);
}, { passive: true });

if (scrollTopBtn) {
  scrollTopBtn.addEventListener('click', () => {
    window.scrollTo({ top: 0, behavior: 'smooth' });
  });
}

if (shareBtn) {
  shareBtn.addEventListener('click', async () => {
    const shareData = {
      title: 'Ван-Пис в озвучке Макс Летов & ShiYori',
      text: 'Смотрю Ван-Пис в новой озвучке!',
      url: window.location.href
    };

    try {
      if (navigator.share) {
        await navigator.share(shareData);
      } else {
        await navigator.clipboard.writeText(window.location.href);
        showToast('Ссылка на сайт скопирована!');
      }
    } catch (err) {}
  });
}

if (themeBtn) {
  themeBtn.addEventListener('click', () => {
    const newTheme = document.body.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
    document.body.setAttribute('data-theme', newTheme);
    localStorage.setItem('theme', newTheme);
  });
}

if (copyrightModal && closeCopyrightModalBtn) {
  const closeCopy = () => {
    copyrightModal.classList.remove('open');
    copyrightModal.setAttribute('aria-hidden', 'true');
  };
  closeCopyrightModalBtn.addEventListener('click', closeCopy);
  copyrightModal.addEventListener('click', (e) => { if (e.target === copyrightModal) closeCopy(); });
}

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    if (copyrightModal && copyrightModal.classList.contains('open')) {
      copyrightModal.classList.remove('open');
      copyrightModal.setAttribute('aria-hidden', 'true');
    }
  }
});

function initSnowEffect() {
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const now = new Date();
  const month = now.getMonth();
  const day = now.getDate();
  const isSeason = (month === 11 && day >= 10) || (month === 0 && day <= 20);
  if (!isSeason) return;

  const wrapper = document.createElement('div');
  wrapper.className = 'snow-wrapper';
  const fragment = document.createDocumentFragment();

  for (let i = 0; i < 45; i++) {
    const flake = document.createElement('div');
    flake.className = 'snowflake';
    const size = (Math.random() * 3 + 2).toFixed(1);
    flake.style.width = `${size}px`;
    flake.style.height = `${size}px`;
    flake.style.left = `${(Math.random() * 100).toFixed(1)}%`;
    flake.style.animationDuration = `${(Math.random() * 10 + 10).toFixed(1)}s`;
    flake.style.animationDelay = `${(Math.random() * -20).toFixed(1)}s`;
    flake.style.opacity = (Math.random() * 0.4 + 0.4).toFixed(2);
    fragment.appendChild(flake);
  }

  wrapper.appendChild(fragment);
  document.body.appendChild(wrapper);
}

function initChatWidget() {
  const chatBtn = document.getElementById('chat-floating-button');
  const chatPopup = document.getElementById('chat-widget-popup');
  const closeBtn = document.getElementById('chat-close-btn');
  if (!chatBtn || !chatPopup || !closeBtn) return;

  chatBtn.addEventListener('click', () => {
    const isHidden = chatPopup.classList.contains('chat-popup-hidden');
    chatPopup.classList.toggle('chat-popup-hidden', !isHidden);
    chatPopup.classList.toggle('chat-popup-visible', isHidden);
  });

  closeBtn.addEventListener('click', () => {
    chatPopup.classList.remove('chat-popup-visible');
    chatPopup.classList.add('chat-popup-hidden');
  });
}

document.addEventListener('DOMContentLoaded', () => {
  document.body.setAttribute('data-theme', localStorage.getItem('theme') || 'dark');
  loadWatchedStatus();
  loadEpisodes();
  initLogPoseTimer();
  initSnowEffect();
  initChatWidget();
  initQuickTitleSearch();
});
