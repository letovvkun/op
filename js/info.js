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
  const body = document.body;
  body.setAttribute('data-theme', localStorage.getItem('theme') || 'dark');
  themeBtn.addEventListener('click', () => {
    const newTheme = body.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
    body.setAttribute('data-theme', newTheme);
    localStorage.setItem('theme', newTheme);
  });

  async function loadStatus() {
      try {
          const docRef = doc(db, "settings", "release_status");
          const docSnap = await getDoc(docRef);

          if (docSnap.exists()) {
              const data = docSnap.data();
              
              document.getElementById('view-ep-num').textContent = data.episode || '???';
              
              const updateBadge = (id, status) => {
                  const el = document.getElementById(id);
                  el.className = 'status-badge'; 
                  if (status === 'done') { el.classList.add('st-done'); el.textContent = 'Готово'; }
                  else if (status === 'process') { el.classList.add('st-process'); el.textContent = 'В работе'; }
                  else { el.classList.add('st-wait'); el.textContent = 'Ожидание'; }
              };

              updateBadge('view-translation', data.translation);
              updateBadge('view-dub-max', data.dub_max);
              updateBadge('view-dub-shiyori', data.dub_shiyori);
              updateBadge('view-mixing', data.mixing);
              updateBadge('view-upload', data.upload);

              if (data.updatedAt) {
                  const date = new Date(data.updatedAt);
                  document.getElementById('view-updated').textContent = date.toLocaleString('ru-RU', { day:'numeric', month:'short', hour:'2-digit', minute:'2-digit' });
              }
          }
      } catch (e) {
          console.error("Ошибка статуса:", e);
      }
  }

  function initSnowEffect() {
    const now = new Date();
    const month = now.getMonth(); 
    const day = now.getDate();
    const isSeason = (month === 11 && day >= 10) || (month === 0 && day <= 20);

    if (!isSeason) return; 

    const wrapper = document.createElement('div');
    wrapper.className = 'snow-wrapper';
    document.body.appendChild(wrapper);

    const flakesCount = 50; 
    for (let i = 0; i < flakesCount; i++) {
      const flake = document.createElement('div');
      flake.className = 'snowflake';
      const size = Math.random() * 3 + 2; 
      const left = Math.random() * 100; 
      const duration = Math.random() * 10 + 10; 
      const delay = Math.random() * -20; 
      const opacity = Math.random() * 0.4 + 0.4; 

      flake.style.width = `${size}px`;
      flake.style.height = `${size}px`;
      flake.style.left = `${left}%`;
      flake.style.animationDuration = `${duration}s`;
      flake.style.animationDelay = `${delay}s`;
      flake.style.opacity = opacity;
      wrapper.appendChild(flake);
    }
  }

  // --- Функция анимации Details (Accordion) ---
  function initDetailsAnimation() {
    const details = document.querySelectorAll('details');

    details.forEach(detail => {
      const summary = detail.querySelector('summary');
      const content = detail.querySelector('.faq-content');

      summary.addEventListener('click', (e) => {
        e.preventDefault(); 

        if (detail.open) {
          const startHeight = content.offsetHeight;
          
          const animation = content.animate(
            [
              { height: startHeight + 'px', opacity: 1, paddingBottom: '14px' },
              { height: '0px', opacity: 0, paddingBottom: '0px' }
            ], 
            { duration: 300, easing: 'ease-in-out' }
          );

          animation.onfinish = () => {
            detail.removeAttribute('open');
          };
          
        } else {
          detail.setAttribute('open', ''); 
          const endHeight = content.offsetHeight; 
          
          content.animate(
            [
              { height: '0px', opacity: 0, paddingBottom: '0px' },
              { height: endHeight + 'px', opacity: 1, paddingBottom: '14px' }
            ], 
            { duration: 300, easing: 'ease-in-out' }
          );
        }
      });
    });
  }

  // --- Логика плавающего меню ---
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