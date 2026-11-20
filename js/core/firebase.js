// Firebase SDK подключается только здесь и только по требованию.
// Главная страница, каталог и страница тайтла читают данные из статических JSON
// (см. js/core/static-data.js), поэтому Firebase не попадает в критический путь загрузки.

const firebaseConfig = {
  apiKey: 'AIzaSyBE1AkNd3bPGPr3ZPUbtqNUd2WDCB2SHHw',
  authDomain: 'letovshiyori.firebaseapp.com',
  projectId: 'letovshiyori',
  storageBucket: 'letovshiyori.appspot.com',
  messagingSenderId: '379203362104',
  appId: '1:379203362104:web:20235be9bbbbfdbd6df5cd'
};

let appPromise = null;

function getFirebaseApp() {
  if (!appPromise) {
    appPromise = import('https://www.gstatic.com/firebasejs/9.22.1/firebase-app.js')
      .then((sdk) => sdk.initializeApp(firebaseConfig))
      .catch((error) => {
        appPromise = null;
        throw error;
      });
  }
  return appPromise;
}

// Firestore загружается по требованию: страницам, которым хватает статических данных,
// он не нужен вообще.
let firestoreSdkPromise = null;

export function getFirestoreSdk() {
  if (!firestoreSdkPromise) {
    firestoreSdkPromise = Promise.all([
      getFirebaseApp(),
      import('https://www.gstatic.com/firebasejs/9.22.1/firebase-firestore.js')
    ])
      .then(([app, sdk]) => ({ ...sdk, db: sdk.getFirestore(app) }))
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
    analyticsClientPromise = Promise.all([
      getFirebaseApp(),
      import('https://www.gstatic.com/firebasejs/9.22.1/firebase-analytics.js')
    ])
      .then(async ([app, analyticsSdk]) => {
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
