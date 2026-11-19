import { createSafePlayerIframe, buildHuggingFaceVideoUrl } from '../core/safe-dom.js';
import { readStorage } from '../core/storage.js';

export const PLAYER_SOURCE_KEY = 'lastPlayerSource';

export const PLAYER_NAMES = Object.freeze({
  hf: 'Без сжатия | Бета',
  dzen: 'Dzen | 4K',
  mega: 'Moon Player | 1080p',
  kodik: 'Kodik | 720p',
  subtitles: 'Dzen | Субтитры'
});

const PLYR_SCRIPT_URL = 'https://cdn.plyr.io/3.7.8/plyr.js';
const PLYR_STYLESHEET_URL = 'https://cdn.plyr.io/3.7.8/plyr.css';
let plyrScriptPromise = null;
let plyrStylesheetPromise = null;

function loadPlyrScript() {
  if (typeof globalThis.Plyr === 'function') return Promise.resolve(globalThis.Plyr);
  if (plyrScriptPromise) return plyrScriptPromise;
  if (typeof document === 'undefined' || !document.head) {
    return Promise.reject(new Error('Документ недоступен для загрузки Plyr.'));
  }

  plyrScriptPromise = new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = PLYR_SCRIPT_URL;
    script.async = true;
    script.dataset.letovshiyoriPlyr = 'true';
    script.onload = () => {
      if (typeof globalThis.Plyr === 'function') resolve(globalThis.Plyr);
      else reject(new Error('Plyr загрузился без доступного конструктора.'));
    };
    script.onerror = () => reject(new Error('Не удалось загрузить библиотеку Plyr.'));
    document.head.appendChild(script);
  }).catch((error) => {
    plyrScriptPromise = null;
    throw error;
  });

  return plyrScriptPromise;
}

function loadPlyrStylesheet() {
  if (plyrStylesheetPromise) return plyrStylesheetPromise;
  if (typeof document === 'undefined' || !document.head) return Promise.resolve();

  plyrStylesheetPromise = new Promise((resolve, reject) => {
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = PLYR_STYLESHEET_URL;
    link.dataset.letovshiyoriPlyr = 'true';
    link.onload = () => resolve();
    link.onerror = () => reject(new Error('Не удалось загрузить стили Plyr.'));
    document.head.appendChild(link);
  }).catch((error) => {
    plyrStylesheetPromise = null;
    throw error;
  });

  return plyrStylesheetPromise;
}

function loadPlyrAssets() {
  return Promise.all([loadPlyrScript(), loadPlyrStylesheet()]).then(([PlyrConstructor]) => PlyrConstructor);
}

const PLYR_CONTROLS = [
  'play-large', 'play', 'progress', 'current-time', 'duration',
  'mute', 'volume', 'settings', 'fullscreen'
];

/**
 * Общий жизненный цикл видеоплеера для главной и страниц отдельных тайтлов.
 * Содержимое внешнего плеера по-прежнему может приходить с любого HTTPS-хоста.
 */
export function createEpisodePlayerController({ container, selector, playerNames = PLAYER_NAMES } = {}) {
  let plyrInstance = null;
  let renderVersion = 0;

  function destroyCurrentPlayer() {
    if (!plyrInstance) return;
    try {
      plyrInstance.destroy();
    } catch (error) {
      console.warn('[LetovShiyori] Не удалось корректно закрыть Plyr:', error);
    } finally {
      plyrInstance = null;
    }
  }

  function showMessage(message) {
    if (!container) return;
    const element = document.createElement('span');
    element.style.color = 'var(--muted)';
    element.textContent = message;
    container.replaceChildren(element);
    container.removeAttribute?.('aria-busy');
  }

  function createPlayerLoadingOverlay(hidden = false) {
    const overlay = document.createElement('div');
    overlay.className = 'player-loading-overlay';
    if (overlay.dataset) overlay.dataset.playerLoading = 'true';
    overlay.setAttribute?.('aria-hidden', 'true');
    overlay.hidden = hidden;

    const shimmer = document.createElement('span');
    shimmer.className = 'skeleton-loader skeleton-player-frame';
    overlay.appendChild(shimmer);
    return overlay;
  }

  function render(episode) {
    renderVersion += 1;
    const currentRenderVersion = renderVersion;
    destroyCurrentPlayer();
    if (!container || !episode) return { availablePlayers: [], selectedPlayer: '' };
    container.removeAttribute?.('aria-busy');

    const sourceSkeleton = selector?.parentElement?.querySelector?.('.player-source-skeleton');
    if (selector) {
      selector.replaceChildren();
      selector.disabled = true;
      selector.setAttribute?.('aria-busy', 'true');
    }
    if (sourceSkeleton) sourceSkeleton.hidden = false;

    const finishSourceLoading = () => {
      if (selector) {
        selector.disabled = false;
        selector.removeAttribute?.('aria-busy');
      }
      if (sourceSkeleton) sourceSkeleton.hidden = true;
    };

    const sources = episode.players && typeof episode.players === 'object' ? episode.players : {};
    const availablePlayers = Object.keys(sources).filter((key) => (
      sources[key] && /^[a-zA-Z0-9_-]{1,32}$/.test(key)
    ));

    if (!availablePlayers.length) {
      if (selector) {
        const option = document.createElement('option');
        option.value = '';
        option.textContent = 'Нет плееров';
        selector.appendChild(option);
      }
      finishSourceLoading();
      container.replaceChildren();
      showMessage('Для этой серии видео пока недоступно.');
      return { availablePlayers, selectedPlayer: '' };
    }

    if (selector) {
      availablePlayers.forEach((key) => {
        const option = document.createElement('option');
        option.value = key;
        option.textContent = playerNames[key] || key.toUpperCase();
        selector.appendChild(option);
      });
    }
    finishSourceLoading();

    const savedSource = readStorage(PLAYER_SOURCE_KEY) || 'hf';
    const selectedPlayer = availablePlayers.includes(savedSource) ? savedSource : availablePlayers[0];
    if (selector) selector.value = selectedPlayer;

    container.replaceChildren();

    if (selectedPlayer === 'hf') {
      const videoUrl = buildHuggingFaceVideoUrl(sources.hf);
      if (!videoUrl) {
        showMessage('Некорректный адрес видеофайла.');
        return { availablePlayers, selectedPlayer };
      }

      const video = document.createElement('video');
      video.id = 'plyr-hf-player';
      video.playsInline = true;
      video.controls = true;
      video.preload = 'none';

      const source = document.createElement('source');
      source.src = videoUrl;
      source.type = 'video/mp4';
      video.appendChild(source);
      const loadingOverlay = createPlayerLoadingOverlay(true);
      container.replaceChildren(video, loadingOverlay);
      const setBufferingState = (isBuffering) => {
        if (renderVersion !== currentRenderVersion) return;
        loadingOverlay.hidden = !isBuffering;
        if (isBuffering) container.setAttribute?.('aria-busy', 'true');
        else container.removeAttribute?.('aria-busy');
      };
      video.addEventListener?.('waiting', () => setBufferingState(true));
      video.addEventListener?.('stalled', () => setBufferingState(true));
      video.addEventListener?.('playing', () => setBufferingState(false));
      video.addEventListener?.('canplay', () => {
        if (!video.paused) setBufferingState(false);
      });
      video.addEventListener?.('error', () => setBufferingState(false));

      // Plyr загружается только для MP4-источника. До этого момента работает
      // нативный video, поэтому блокировка CDN не лишает пользователя просмотра.
      loadPlyrAssets().then((PlyrConstructor) => {
        const stillCurrent = renderVersion === currentRenderVersion
          && (typeof container.contains !== 'function' || container.contains(video));
        if (!stillCurrent) return;

        try {
          plyrInstance = new PlyrConstructor(video, {
            title: episode.title || 'Видеоплеер',
            controls: PLYR_CONTROLS,
            settings: ['quality', 'speed'],
            quality: { default: 1080, options: [1080, 720, 480] },
            fullscreen: { iosNative: true }
          });
        } catch (error) {
          // Нативные controls остаются доступны, если библиотека не смогла запуститься.
          console.warn('[LetovShiyori] Plyr не запустился, используется нативный плеер:', error);
        }
      }).catch((error) => {
        // Видео остаётся доступным через встроенные controls браузера.
        console.warn('[LetovShiyori] Plyr недоступен, используется нативный плеер:', error);
      });
    } else {
      const iframe = createSafePlayerIframe(sources[selectedPlayer], episode.title || 'Видеоплеер');
      if (iframe) {
        const loadingOverlay = createPlayerLoadingOverlay();
        const finishLoading = () => {
          if (renderVersion !== currentRenderVersion) return;
          loadingOverlay.remove();
          container.removeAttribute?.('aria-busy');
        };
        iframe.addEventListener?.('load', finishLoading, { once: true });
        iframe.addEventListener?.('error', finishLoading, { once: true });
        container.replaceChildren(iframe, loadingOverlay);
        container.setAttribute?.('aria-busy', 'true');
      } else {
        showMessage('Источник видео имеет недопустимый формат.');
      }
    }

    return { availablePlayers, selectedPlayer };
  }

  function showNoSources(label = 'Нет доступных источников') {
    if (selector) {
      const option = document.createElement('option');
      option.value = '';
      option.textContent = label;
      selector.replaceChildren(option);
      selector.disabled = true;
      selector.removeAttribute?.('aria-busy');
    }
    container?.removeAttribute?.('aria-busy');
    const sourceSkeleton = selector?.parentElement?.querySelector?.('.player-source-skeleton');
    if (sourceSkeleton) sourceSkeleton.hidden = true;
  }

  return {
    render,
    showNoSources,
    destroy() {
      renderVersion += 1;
      destroyCurrentPlayer();
    }
  };
}
