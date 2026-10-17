import { initializeApp } from "https://www.gstatic.com/firebasejs/9.22.1/firebase-app.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/9.22.1/firebase-firestore.js";
import { getAnalytics } from "https://www.gstatic.com/firebasejs/9.22.1/firebase-analytics.js";

const firebaseConfig = {
  apiKey: "AIzaSyBE1AkNd3bPGPr3ZPUbtqNUd2WDCB2SHHw",
  authDomain: "letovshiyori.firebaseapp.com",
  projectId: "letovshiyori",
  storageBucket: "letovshiyori.appspot.com",
  messagingSenderId: "379203362104",
  appId: "1:379203362104:web:20235be9bbbbfdbd6df5cd"
};

export const app = initializeApp(firebaseConfig);
export const db = getFirestore(app);
export const analytics = getAnalytics(app);