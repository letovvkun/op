import { getFirestoreSdk } from '../core/firebase.js';

/** Загружает один документ из settings без изменения схемы Firestore. */
export async function loadSiteSetting(settingId) {
  if (typeof settingId !== 'string' || !/^[a-zA-Z0-9_-]{1,80}$/.test(settingId)) {
    throw new TypeError('Некорректный идентификатор настройки сайта.');
  }

  const { db, doc, getDoc } = await getFirestoreSdk();
  const snapshot = await getDoc(doc(db, 'settings', settingId));
  return snapshot.exists() ? snapshot.data() : null;
}
