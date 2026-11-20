import { getFirestoreSdk } from '../core/firebase.js';
import { tryLoadStaticData } from '../core/static-data.js';

// Только эти настройки попадают в статический снимок. Остальные (например, статус
// выпуска на странице info) всегда читаются из Firestore, чтобы быть актуальными.
const STATIC_SETTING_IDS = new Set(['log_pose']);

const isSettingsMap = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);

/** Загружает один документ из settings без изменения схемы Firestore. */
export async function loadSiteSetting(settingId) {
  if (typeof settingId !== 'string' || !/^[a-zA-Z0-9_-]{1,80}$/.test(settingId)) {
    throw new TypeError('Некорректный идентификатор настройки сайта.');
  }

  if (STATIC_SETTING_IDS.has(settingId)) {
    const snapshot = await tryLoadStaticData('settings', isSettingsMap);
    const value = snapshot?.[settingId];
    if (isSettingsMap(value)) return value;
  }

  const { db, doc, getDoc } = await getFirestoreSdk();
  const snapshot = await getDoc(doc(db, 'settings', settingId));
  return snapshot.exists() ? snapshot.data() : null;
}
