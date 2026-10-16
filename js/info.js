import { initializeApp } from "https://www.gstatic.com/firebasejs/9.22.1/firebase-app.js";
import { getFirestore, doc, getDoc } from "https://www.gstatic.com/firebasejs/9.22.1/firebase-firestore.js";

const firebaseConfig = {
  apiKey: "AIzaSyBE1AkNd3bPGPr3ZPUbtqNUd2WDCB2SHHw",
  authDomain: "letovshiyori.firebaseapp.com",
  projectId: "letovshiyori",
  storageBucket: "letovshiyori.appspot.com",
  messagingSenderId: "379203362104",
  appId: "1:379203362104:web:20235be9bbbbfdbd6df5cd"
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

const themeBtn = document.getElementById('themeBtn');
document.body.setAttribute('data-theme', localStorage.getItem('theme') || 'dark');

if (themeBtn) {
  themeBtn.addEventListener('click', () => {
    const newTheme = document.body.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
    document.body.setAttribute('data-theme', newTheme);
    localStorage.setItem('theme', newTheme);
  });
}

async function loadStatus() {
  try {
    const docSnap = await getDoc(doc(db, "settings", "release_status"));
    if (!docSnap.exists()) return;

    const data = docSnap.data();
    const epNumEl = document.getElementById('view-ep-num');
    if (epNumEl) epNumEl.textContent = data.episode || '???';

    const statusMap = {
      done: { cls: 'st-done', text: 'Готово' },
      process: { cls: 'st-process', text: 'В работе' },
      wait: { cls: 'st-wait', text: 'Ожидание' }
    };

    const updateBadge = (id, status) => {
      const el = document.getElementById(id);
      if (!el) return;
      const cfg = statusMap[status] || statusMap.wait;
      el.className = `status-badge ${cfg.cls}`;
      el.textContent = cfg.text;
    };

    updateBadge('view-translation', data.translation);
    updateBadge('view-dub-max', data.dub_max);
    updateBadge('view-dub-shiyori', data.dub_shiyori);
    updateBadge('view-mixing', data.mixing);
    updateBadge('view-upload', data.upload);

    if (data.updatedAt) {
      const updatedEl = document.getElementById('view-updated');
      if (updatedEl) {
        const date = new Date(data.updatedAt);
        updatedEl.textContent = date.toLocaleString('ru-RU', {
          day: 'numeric',
          month: 'short',
          hour: '2-digit',
          minute: '2-digit'
        });
      }
    }
  } catch (e) {
    console.error("Ошибка загрузки статуса:", e);
  }
}

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

function initDetailsAnimation() {
  document.querySelectorAll('details').forEach(detail => {
    const summary = detail.querySelector('summary');
    const content = detail.querySelector('.faq-content');
    if (!summary || !content) return;

    let currentAnimation = null;

    summary.addEventListener('click', (e) => {
      e.preventDefault();
      if (currentAnimation) currentAnimation.cancel();

      if (detail.open) {
        const startHeight = content.offsetHeight;
        currentAnimation = content.animate(
          [
            { height: `${startHeight}px`, opacity: 1, paddingBottom: '14px' },
            { height: '0px', opacity: 0, paddingBottom: '0px' }
          ],
          { duration: 260, easing: 'cubic-bezier(0.22, 1, 0.36, 1)' }
        );
        currentAnimation.onfinish = () => {
          detail.removeAttribute('open');
          currentAnimation = null;
        };
      } else {
        detail.setAttribute('open', '');
        const endHeight = content.offsetHeight;
        currentAnimation = content.animate(
          [
            { height: '0px', opacity: 0, paddingBottom: '0px' },
            { height: `${endHeight}px`, opacity: 1, paddingBottom: '14px' }
          ],
          { duration: 260, easing: 'cubic-bezier(0.22, 1, 0.36, 1)' }
        );
        currentAnimation.onfinish = () => {
          currentAnimation = null;
        };
      }
    });
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

document.addEventListener('DOMContentLoaded', () => {
  loadStatus();
  initSnowEffect();
  initDetailsAnimation();
});
