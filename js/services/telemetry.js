import { getFirestoreSdk, logAnalyticsEvent } from '../core/firebase.js';
import { readStorage, writeStorage } from '../core/storage.js';

const VIEW_DELAY_MS = 15000;
const PLAYER_CHANGE_DELAY_MS = 4000;

async function sendTelemetry({ isView = false, playerKey = null } = {}) {
  try {
    const { db, doc, increment, setDoc } = await getFirestoreSdk();
    const now = new Date();
    const payload = { lastActive: now.toISOString() };

    if (playerKey) payload.players = { [playerKey]: increment(1) };
    if (isView) {
      payload.totalViews = increment(1);
      payload.daily = { [now.toISOString().split('T')[0]]: increment(1) };
    }

    setDoc(doc(db, 'settings', 'telemetry'), payload, { merge: true }).catch(() => {});
  } catch (_) {
    // Сбор статистики не должен влиять на работу просмотра.
  }
}

/**
 * Создаёт трекер телеметрии для страницы с сериями.
 * getCurrentEpisodeId связывает общий механизм с состоянием конкретной страницы.
 */
export function createTelemetryTracker(getCurrentEpisodeId) {
  let viewTimer = null;
  let playerTimer = null;

  return function recordTelemetryEvent(playerKey = null) {
    if (playerKey) {
      clearTimeout(playerTimer);
      playerTimer = setTimeout(() => sendTelemetry({ playerKey }), PLAYER_CHANGE_DELAY_MS);
      return;
    }

    const episodeId = getCurrentEpisodeId?.();
    if (episodeId === null || episodeId === undefined || episodeId === '') return;

    clearTimeout(viewTimer);
    const sessionKey = `tel_view_${episodeId}`;

    if (readStorage(sessionKey, 'sessionStorage')) return;

    viewTimer = setTimeout(() => {
      writeStorage(sessionKey, '1', 'sessionStorage');
      sendTelemetry({ isView: true });
    }, VIEW_DELAY_MS);
  };
}


/** Записывает выбор видеоплеера в Firebase Analytics, если среда это поддерживает. */
export function trackPlayerSelection(playerKey) {
  if (typeof playerKey !== 'string' || !playerKey) return Promise.resolve(false);
  return logAnalyticsEvent('select_player', { player_name: playerKey });
}
