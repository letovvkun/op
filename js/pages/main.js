import { showToast, initFloatingMenu, initThemeToggle, initSeasonalSnowEffect, initScrollToTop } from '../core/ui.js';
import { initLazyQuickTitleSearch } from '../components/lazy-quick-title-search.js';
import { createLazyGiscusLoader } from '../components/lazy-giscus.js';
import { isEpisodeDisplayable } from '../services/episodes.js';
import { createWatchedEpisodeManager } from '../components/watched-episodes.js';
import { createTelemetryTracker, trackPlayerSelection } from '../services/telemetry.js';
import { loadMainEpisodes } from '../services/episode-data.js';
import { createEpisodePlayerController, PLAYER_SOURCE_KEY } from '../services/episode-player.js';
import { readStorage, writeStorage } from '../core/storage.js';
import { getDataErrorMessage, logDataError } from '../core/errors.js';
import { loadSiteSetting } from '../services/site-settings.js';
import { clearSkeletonState, createEpisodeGridSkeleton, createTextSkeleton, setSkeletonContent } from '../core/skeletons.js';

initThemeToggle();
initFloatingMenu();

// --- Состояние ---
let currentEpisode = null;
const LAST_EPISODE_ID_KEY = 'lastEpisodeFirestoreId';
const INITIAL_VISIBLE_COUNT = 8;
let timerInterval = null;
let logPoseConfig = null;


// --- DOM Элементы ---
const episodesGrid = document.getElementById('episodesGrid');
const playerEmbed = document.getElementById('playerEmbed');
const playerTitle = document.getElementById('playerTitle');
const playerSub = document.getElementById('playerSub');
const metaText = document.getElementById('metaText');
const search = document.getElementById('search');
const playerSourceSelect = document.getElementById('playerSource');
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
const episodePlayer = createEpisodePlayerController({ container: playerEmbed, selector: playerSourceSelect });

const watchedEpisodeManager = createWatchedEpisodeManager({ grid: episodesGrid });
const recordTelemetryEvent = createTelemetryTracker(() => currentEpisode?.firestoreId ?? null);

let episodeBrowser = null;

// --- Умный Лог-пос Таймер ---
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

  const configuredDay = cfg && cfg.dayOfWeek !== undefined ? Number(cfg.dayOfWeek) : 0;
  const targetDay = Number.isInteger(configuredDay) && configuredDay >= 0 && configuredDay <= 6
    ? configuredDay
    : 0;
  let hours = 23;
  let minutes = 0;

  if (cfg && typeof cfg.time === 'string' && cfg.time.includes(':')) {
    const parts = cfg.time.split(':');
    const parsedHours = Number(parts[0]);
    const parsedMinutes = Number(parts[1]);
    hours = Number.isInteger(parsedHours) && parsedHours >= 0 && parsedHours <= 23 ? parsedHours : 23;
    minutes = Number.isInteger(parsedMinutes) && parsedMinutes >= 0 && parsedMinutes <= 59 ? parsedMinutes : 0;
  } else if (cfg && cfg.hour !== undefined) {
    const configuredHours = Number(cfg.hour);
    const configuredMinutes = Number(cfg.minute ?? 0);
    hours = Number.isInteger(configuredHours) && configuredHours >= 0 && configuredHours <= 23 ? configuredHours : 23;
    minutes = Number.isInteger(configuredMinutes) && configuredMinutes >= 0 && configuredMinutes <= 59 ? configuredMinutes : 0;
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

  setSkeletonContent(countElem, createTextSkeleton('skeleton-line--text'));
  try {
    logPoseConfig = await loadSiteSetting('log_pose')
      || { isWeekly: true, dayOfWeek: 0, time: '23:00' };
    startCountdown();
  } catch (error) {
    logDataError('Ошибка таймера', error);
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
  clearSkeletonState(countElem);
  if (timerInterval) clearInterval(timerInterval);
  timerInterval = setInterval(update, 30000);
}

// --- Загрузка и рендер серий ---
function renderSkeletons() {
  setSkeletonContent(episodesGrid, createEpisodeGridSkeleton(INITIAL_VISIBLE_COUNT));
  setSkeletonContent(playerTitle, createTextSkeleton('skeleton-line--title'));
  setSkeletonContent(playerEmbed, '<div class="skeleton-loader skeleton-player-frame" aria-hidden="true"></div>');
}

async function loadEpisodes() {
  renderSkeletons();

  try {
    const [rawEpisodes, browserModule] = await Promise.all([
      loadMainEpisodes(),
      import('../components/episode-browser.js')
    ]);

    // Фильтруем черновики и отложенные серии
    const episodes = rawEpisodes.filter(isEpisodeDisplayable);
    episodeBrowser = browserModule.createEpisodeBrowser({
      grid: episodesGrid,
      searchInput: search,
      sortSelect,
      loadMoreContainer,
      loadMoreButton: loadMoreBtn,
      loadMoreText,
      paginationInfo,
      previousButton: prevBtn,
      nextButton: nextBtn,
      watchedManager: watchedEpisodeManager,
      animatedCollapse: true,
      onSelect: (episode, index, shouldScroll) => {
        currentEpisode = episode;
        writeStorage(LAST_EPISODE_ID_KEY, episode.firestoreId);
        document.title = `EP ${episode.id} — ${episode.title} | Ван-Пис в озвучке Макс Летов & ShiYori`;
        recordTelemetryEvent();
        episodePlayer.render(episode);

        if (playerTitle) {
          playerTitle.textContent = episode.title;
          clearSkeletonState(playerTitle);
        }
        if (playerSub) playerSub.textContent = `${episode.date || ''} • ${episode.quality || ''}`;
        if (metaText) metaText.textContent = `EP ${episode.id} • Загружено: ${episode.date || ''}`;

        if (shouldScroll && window.innerWidth < 980 && playerTitle) {
          playerTitle.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }
      }
    });
    episodeBrowser.setEpisodes(episodes, readStorage(LAST_EPISODE_ID_KEY));
    clearSkeletonState(episodesGrid);

    if (!episodes.length) {
      episodePlayer.showNoSources('Нет доступных источников');
      if (playerEmbed) {
        playerEmbed.textContent = 'Серии пока не добавлены.';
        clearSkeletonState(playerEmbed);
      }
      if (playerTitle) {
        playerTitle.textContent = 'Нет доступных серий';
        clearSkeletonState(playerTitle);
      }
    }
  } catch (error) {
    episodePlayer.showNoSources('Недоступно');
    logDataError('Ошибка загрузки серий', error);
    if (episodesGrid) {
      episodesGrid.textContent = getDataErrorMessage(error, 'Ошибка загрузки данных.');
      episodesGrid.style.color = 'var(--error)';
      clearSkeletonState(episodesGrid);
    }
    if (playerTitle) {
      playerTitle.textContent = 'Не удалось загрузить серии';
      clearSkeletonState(playerTitle);
    }
    if (playerEmbed) {
      playerEmbed.textContent = 'Не удалось загрузить видео';
      clearSkeletonState(playerEmbed);
    }
  }
}

if (playerSourceSelect) {
  playerSourceSelect.addEventListener('change', () => {
    const newPlayer = playerSourceSelect.value;
    writeStorage(PLAYER_SOURCE_KEY, newPlayer);
    void trackPlayerSelection(newPlayer);
    recordTelemetryEvent(newPlayer);
    if (episodeBrowser && episodeBrowser.currentIndex !== -1) {
      episodeBrowser.select(episodeBrowser.currentIndex);
    }
  });
}

initScrollToTop();

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

function initChatWidget() {
  const chatBtn = document.getElementById('chat-floating-button');
  const chatPopup = document.getElementById('chat-widget-popup');
  const closeBtn = document.getElementById('chat-close-btn');
  const chatContent = chatPopup?.querySelector('.chat-widget-content');
  if (!chatBtn || !chatPopup || !closeBtn || !chatContent) return;

  const loadChatWidget = createLazyGiscusLoader(chatContent);

  chatBtn.addEventListener('click', () => {
    const isHidden = chatPopup.classList.contains('chat-popup-hidden');
    chatPopup.classList.toggle('chat-popup-hidden', !isHidden);
    chatPopup.classList.toggle('chat-popup-visible', isHidden);
    if (isHidden) loadChatWidget();
  });

  closeBtn.addEventListener('click', () => {
    chatPopup.classList.remove('chat-popup-visible');
    chatPopup.classList.add('chat-popup-hidden');
  });
}

document.addEventListener('DOMContentLoaded', () => {
  watchedEpisodeManager.load();
  loadEpisodes();
  initLogPoseTimer();
  initSeasonalSnowEffect();
  initChatWidget();
  initLazyQuickTitleSearch();
});
