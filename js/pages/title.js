import { NO_POSTER_URL, safeHttpsUrl } from '../core/safe-dom.js';
import { initFloatingMenu, initThemeToggle, initScrollToTop, initShareButton } from '../core/ui.js';
import { initLazyQuickTitleSearch } from '../components/lazy-quick-title-search.js';
import { isEpisodeDisplayable } from '../services/episodes.js';
import { createWatchedEpisodeManager } from '../components/watched-episodes.js';
import { createTelemetryTracker } from '../services/telemetry.js';
import { loadTitleEpisodes, loadTitleRecord } from '../services/episode-data.js';
import { createEpisodePlayerController, PLAYER_SOURCE_KEY } from '../services/episode-player.js';
import { readStorage, writeStorage } from '../core/storage.js';
import { getDataErrorMessage, logDataError } from '../core/errors.js';
import { clearSkeletonState, createDescriptionSkeleton, createEpisodeGridSkeleton, createTextSkeleton, setSkeletonContent } from '../core/skeletons.js';

const urlParams = new URLSearchParams(window.location.search);
// Идентификатор берётся из ?id=..., а на готовых страницах /title/<id>/ из meta-тега.
const currentTitleId = urlParams.get('id') || document.querySelector('meta[name="title-id"]')?.content || null;

if (!currentTitleId) {
  window.location.replace('catalog.html');
}

// --- Состояние ---
let currentEpisode = null;
const LAST_EP_TITLE_KEY = `lastEp_${currentTitleId}`;


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
const episodePlayer = createEpisodePlayerController({ container: playerEmbed, selector: playerSourceSelect });

const watchedEpisodeManager = createWatchedEpisodeManager({ grid: episodesGrid });
const recordTelemetryEvent = createTelemetryTracker(() => currentEpisode?.firestoreId ?? null);

let episodeBrowser = null;

async function loadTitleData() {
  const headerName = document.getElementById('headerTitleName');
  const sidebarName = document.getElementById('sidebarTitleName');
  const genresInfo = document.getElementById('titleGenresInfo');
  const voiceInfo = document.getElementById('titleVoiceInfo');
  const descInfo = document.getElementById('titleDescInfo');
  setSkeletonContent(headerName, createTextSkeleton('skeleton-line--title-detail'));
  setSkeletonContent(sidebarName, createTextSkeleton('skeleton-line--sidebar-title'));
  setSkeletonContent(genresInfo, createTextSkeleton('skeleton-line--meta'));
  setSkeletonContent(voiceInfo, createTextSkeleton('skeleton-line--meta'));
  setSkeletonContent(descInfo, createDescriptionSkeleton());
  try {
    const data = await loadTitleRecord(currentTitleId);
    if (data) {
      document.title = `${data.name} | Макс Летов & ShiYori`;
      const posterImg = document.getElementById('titlePosterImg');

      if (headerName) { headerName.textContent = data.name; clearSkeletonState(headerName); }
      if (sidebarName) { sidebarName.textContent = data.name; clearSkeletonState(sidebarName); }
      if (posterImg) posterImg.src = safeHttpsUrl(data.poster, NO_POSTER_URL);
      if (genresInfo) { genresInfo.textContent = data.genres || 'Не указаны'; clearSkeletonState(genresInfo); }
      if (voiceInfo) { voiceInfo.textContent = data.voice || 'Макс Летов & ShiYori'; clearSkeletonState(voiceInfo); }
      if (descInfo) { descInfo.textContent = data.desc || 'Описание отсутствует.'; clearSkeletonState(descInfo); }
    } else {
      if (headerName) { headerName.textContent = 'Тайтл не найден'; clearSkeletonState(headerName); }
      if (sidebarName) { sidebarName.textContent = 'Тайтл не найден'; clearSkeletonState(sidebarName); }
      if (genresInfo) { genresInfo.textContent = '—'; clearSkeletonState(genresInfo); }
      if (voiceInfo) { voiceInfo.textContent = '—'; clearSkeletonState(voiceInfo); }
      if (descInfo) { descInfo.textContent = 'Информация об этом тайтле пока недоступна.'; clearSkeletonState(descInfo); }
    }
  } catch (err) {
    logDataError('Ошибка загрузки тайтла', err);
    if (headerName) { headerName.textContent = 'Не удалось загрузить тайтл'; clearSkeletonState(headerName); }
    if (sidebarName) { sidebarName.textContent = 'Не удалось загрузить тайтл'; clearSkeletonState(sidebarName); }
    if (genresInfo) { genresInfo.textContent = '—'; clearSkeletonState(genresInfo); }
    if (voiceInfo) { voiceInfo.textContent = '—'; clearSkeletonState(voiceInfo); }
    if (descInfo) { descInfo.textContent = 'Не удалось загрузить описание.'; clearSkeletonState(descInfo); }
  }
}

async function loadEpisodes() {
  setSkeletonContent(episodesGrid, createEpisodeGridSkeleton(8));
  setSkeletonContent(playerTitle, createTextSkeleton('skeleton-line--title'));
  setSkeletonContent(playerEmbed, '<div class="skeleton-loader skeleton-player-frame" aria-hidden="true"></div>');
  try {
    const [rawEpisodes, browserModule] = await Promise.all([
      loadTitleEpisodes(currentTitleId),
      import('../components/episode-browser.js')
    ]);

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
      navigationScroll: true,
      onSelect: (episode, index, shouldScroll) => {
        currentEpisode = episode;
        writeStorage(LAST_EP_TITLE_KEY, episode.firestoreId);
        recordTelemetryEvent();
        episodePlayer.render(episode);

        if (playerTitle) {
          playerTitle.textContent = episode.title;
          clearSkeletonState(playerTitle);
        }
        if (playerSub) playerSub.textContent = `${episode.date || ''} • ${episode.quality || ''}`;

        if (shouldScroll && window.innerWidth < 980 && playerTitle) {
          playerTitle.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }
      }
    });
    episodeBrowser.setEpisodes(episodes, readStorage(LAST_EP_TITLE_KEY));
    clearSkeletonState(episodesGrid);

    if (!episodes.length) {
      episodePlayer.showNoSources('Нет доступных источников');
      if (playerEmbed) {
        playerEmbed.textContent = 'Для этого тайтла пока нет добавленных серий.';
        clearSkeletonState(playerEmbed);
      }
      if (playerTitle) {
        playerTitle.textContent = 'Ожидание новых эпизодов';
        clearSkeletonState(playerTitle);
      }
    }
  } catch (error) {
    episodePlayer.showNoSources('Недоступно');
    logDataError('Ошибка загрузки серий тайтла', error);
    if (episodesGrid) {
      episodesGrid.textContent = getDataErrorMessage(error, 'Ошибка загрузки серий.');
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
    recordTelemetryEvent(newPlayer);
    if (episodeBrowser && episodeBrowser.currentIndex !== -1) {
      episodeBrowser.select(episodeBrowser.currentIndex);
    }
  });
}

initShareButton(shareBtn, () => ({ title: document.title, url: window.location.href }));

initScrollToTop();

initThemeToggle();
initFloatingMenu();

document.addEventListener('DOMContentLoaded', () => {
  if (!currentTitleId) return;
  watchedEpisodeManager.load();
  initLazyQuickTitleSearch();
  Promise.all([loadTitleData(), loadEpisodes()]);
});
