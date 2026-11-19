import { initializeApp } from 'https://www.gstatic.com/firebasejs/9.22.1/firebase-app.js';

const firebaseConfig = {
  apiKey: 'AIzaSyBE1AkNd3bPGPr3ZPUbtqNUd2WDCB2SHHw',
  authDomain: 'letovshiyori.firebaseapp.com',
  projectId: 'letovshiyori',
  storageBucket: 'letovshiyori.appspot.com',
  messagingSenderId: '379203362104',
  appId: '1:379203362104:web:20235be9bbbbfdbd6df5cd'
};

export const app = initializeApp(firebaseConfig);
// Firestore is loaded on demand instead of being part of every page's
// initial module graph. Session-cached pages can avoid downloading it entirely.
let firestoreSdkPromise = null;

export function getFirestoreSdk() {
  if (!firestoreSdkPromise) {
    firestoreSdkPromise = import('https://www.gstatic.com/firebasejs/9.22.1/firebase-firestore.js')
      .then((sdk) => ({ ...sdk, db: sdk.getFirestore(app) }))
      .catch((error) => {
        firestoreSdkPromise = null;
        throw error;
      });
  }
  return firestoreSdkPromise;
}

// Firebase Analytics загружается только при первом событии и отдельным
// динамическим импортом. Если SDK заблокирован, основной интерфейс продолжает работать.
let analyticsClientPromise = null;

function getAnalyticsClient() {
  if (!analyticsClientPromise) {
    analyticsClientPromise = import('https://www.gstatic.com/firebasejs/9.22.1/firebase-analytics.js')
      .then(async (analyticsSdk) => {
        if (!(await analyticsSdk.isSupported())) return null;
        return {
          instance: analyticsSdk.getAnalytics(app),
          logEvent: analyticsSdk.logEvent
        };
      })
      .catch(() => null);
  }
  return analyticsClientPromise;
}

export async function logAnalyticsEvent(eventName, parameters = {}) {
  try {
    const analyticsClient = await getAnalyticsClient();
    if (!analyticsClient) return false;
    analyticsClient.logEvent(analyticsClient.instance, eventName, parameters);
    return true;
  } catch (_) {
    return false;
  }
}
