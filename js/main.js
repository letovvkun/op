// --- FIREBASE: Импорт и инициализация ---
import { initializeApp } from "https://www.gstatic.com/firebasejs/9.22.1/firebase-app.js";
import { getFirestore, collection, getDocs, orderBy, query, doc, getDoc } from "https://www.gstatic.com/firebasejs/9.22.1/firebase-firestore.js";
import { getAnalytics, logEvent } from "https://www.gstatic.com/firebasejs/9.22.1/firebase-analytics.js";

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
const analytics = getAnalytics(app);
const episodesCollection = collection(db, 'episodes');

// --- Глобальные переменные ---
let episodes = [];
let currentIndex = -1;
const initialVisibleCount = 8; 
let visibleEpisodesCount = initialVisibleCount;
let watchedEpisodes = new Set();
const PLAYER_SOURCE_KEY = 'lastPlayerSource'; 
let currentSortOrder = 'desc'; 
let timerInterval = null;
let logPoseTargetDate = null; // Для хранения даты из админки

// --- DOM Элементы ---
const episodesGrid = document.getElementById('episodesGrid');
const playerEmbed = document.getElementById('playerEmbed');
const playerTitle = document.getElementById('playerTitle');
const playerSub = document.getElementById('playerSub');
const metaText = document.getElementById('metaText');
const search = document.getElementById('search');
const allBtn = document.getElementById('allBtn');
const modal = document.getElementById('modal');
const allTbody = document.getElementById('allTbody');
const modalSearch = document.getElementById('modalSearch');
const playerSourceSelect = document.getElementById('playerSource');
const themeBtn = document.getElementById('themeBtn');
const prevBtn = document.getElementById('prevBtn');
const nextBtn = document.getElementById('nextBtn');
const shareBtn = document.getElementById('shareBtn');
const closeModalBtn = document.getElementById('closeModal');
const copyrightModal = document.getElementById('copyrightModal');
const closeCopyrightModalBtn = document.getElementById('closeCopyrightModal');
const loadMoreContainer = document.getElementById('loadMoreContainer');
const loadMoreBtn = document.getElementById('loadMoreBtn');
const loadMoreText = document.getElementById('loadMoreText');
const paginationInfo = document.getElementById('paginationInfo');
const sortSelect = document.getElementById('sortOrder');
const scrollTopBtn = document.getElementById('scrollTopBtn');

// --- Функция обновления награды ---
function updateBounty() {
  const bountyElem = document.getElementById('bountyAmount');
  if (!bountyElem) return;
  const pricePerEp = 1500000; 
  const totalBounty = watchedEpisodes.size * pricePerEp;
  bountyElem.innerText = totalBounty.toLocaleString('en-US');
}

// --- Функции для работы со статусом просмотра ---
function loadWatchedStatus() {
  const saved = localStorage.getItem('watchedEpisodes');
  if (saved) {
    watchedEpisodes = new Set(JSON.parse(saved));
  }
  updateBounty(); 
}

function saveWatchedStatus() {
  localStorage.setItem('watchedEpisodes', JSON.stringify([...watchedEpisodes]));
}

// --- Функция Таймера (Log Pose) ---

// 1. Сначала загружаем дату из базы
async function initLogPoseTimer() {
  const countElem = document.getElementById('countdown');
  if(!countElem) return;

  try {
    const docRef = doc(db, 'settings', 'log_pose');
    const snap = await getDoc(docRef);
    if (snap.exists() && snap.data().targetDate) {
      logPoseTargetDate = new Date(snap.data().targetDate);
      startCountdown(); // Запускаем таймер
    } else {
      countElem.innerText = "Ждем инфо";
    }
  } catch (error) {
    console.error("Ошибка таймера:", error);
    countElem.innerText = "--:--:--";
  }
}

// 2. Сам процесс отсчета
function startCountdown() {
  const countElem = document.getElementById('countdown');
  if (!countElem || !logPoseTargetDate) return;

  function update() {
    const now = new Date();
    const diff = logPoseTargetDate - now;

    if (diff <= 0) {
      countElem.innerText = "Уже скоро!";
      if (timerInterval) clearInterval(timerInterval);
      return;
    }

    const d = Math.floor(diff / (1000 * 60 * 60 * 24));
    const h = Math.floor((diff / (1000 * 60 * 60)) % 24);
    const m = Math.floor((diff / 1000 / 60) % 60);
    
    // Форматирование для красоты (01 вместо 1)
    const hStr = h < 10 ? '0' + h : h;
    const mStr = m < 10 ? '0' + m : m;

    if (d > 0) {
        countElem.innerText = `${d}д ${hStr}ч ${mStr}м`;
    } else {
        countElem.innerText = `${hStr}ч ${mStr}м`;
    }
  }

  update(); // Обновить сразу
  timerInterval = setInterval(update, 60000); 
}

// --- Функции рендеринга скелетона ---
function renderSkeletons() {
  if (!episodesGrid) return;
  episodesGrid.innerHTML = '';
  for (let i = 0; i < initialVisibleCount; i++) {
      const el = document.createElement('div');
      el.className = 'ep';
      el.style.pointerEvents = 'none'; 
      el.innerHTML = `
        <div class="thumb skeleton-loader" style="border:none;"></div>
        <div class="meta" style="width:100%">
          <div class="skeleton-loader" style="height:14px; width:70%; margin-bottom:6px;"></div>
          <div class="skeleton-loader" style="height:12px; width:40%;"></div>
        </div>`;
      episodesGrid.appendChild(el);
  }
}

// --- Сортировка ---
function sortEpisodes() {
  if (currentSortOrder === 'desc') {
      episodes.sort((a, b) => b.id - a.id);
  } else {
      episodes.sort((a, b) => a.id - b.id);
  }
  renderList(search.value);
}

// --- Функции Загрузки ---
async function loadEpisodes() {
  renderSkeletons();
  
  try {
    const q = query(episodesCollection, orderBy("id", "desc"));
    const querySnapshot = await getDocs(q);
    episodes = querySnapshot.docs.map(doc => ({ firestoreId: doc.id, ...doc.data() }));
    
    sortEpisodes();
    
    renderList();
    renderModalTable();
    
    const savedIndex = localStorage.getItem('lastEpisodeIndex');
    const indexToLoad = (savedIndex !== null && episodes[savedIndex]) ? parseInt(savedIndex, 10) : 0;
    
    if (episodes.length > 0) {
      loadEpisode(indexToLoad, false); 
    } else {
      if(playerEmbed) playerEmbed.innerHTML = `<span>Серии пока не добавлены.</span>`;
      if(playerTitle) playerTitle.textContent = 'Нет доступных серий';
    }
  } catch (error) {
    console.error("Ошибка при загрузке серий из Firestore: ", error);
    if(episodesGrid) episodesGrid.innerHTML = `<div style="text-align:center;padding:2rem;width:100%;color:var(--accent-c);">Ошибка загрузки данных.</div>`;
  }
}

function renderList(filter = '') {
  if (!episodesGrid) return;
  const term = filter.trim().toLowerCase();
  const filteredEpisodes = episodes.filter(ep =>
      term ? ep.title.toLowerCase().includes(term) || String(ep.id).includes(term) : true
  );
  const episodesToRender = filteredEpisodes.slice(0, visibleEpisodesCount);
  episodesGrid.innerHTML = ''; 
  if (episodesToRender.length === 0) {
      episodesGrid.innerHTML = '<div style="text-align:center;padding:2rem;width:100%">Ничего не найдено.</div>';
  } else {
      episodesToRender.forEach((ep, loopIndex) => {
          const originalIndex = episodes.findIndex(e => e.firestoreId === ep.firestoreId);
          
          const el = document.createElement('div');
          el.className = 'ep';
          
          if (!term && loopIndex === 0 && currentSortOrder === 'desc') {
              el.classList.add('new-episode');
          }

          el.tabIndex = 0;
          el.setAttribute('role', 'button');
          el.dataset.firestoreId = ep.firestoreId; 
          
          if (watchedEpisodes.has(ep.firestoreId)) {
              el.classList.add('watched');
          }

          el.innerHTML = `
            <div class="thumb" aria-hidden="true">
              ${ep.thumb ? `<img src="${ep.thumb}" alt="" style="width:100%;height:100%;object-fit:cover" loading="lazy">` : `EP ${ep.id}`}
            </div>
            <div class="meta">
              <div class="t">${ep.title}</div>
              <div class="s">${ep.date} • ${ep.quality}</div>
            </div>`;
          
          const clickHandler = () => {
              if (watchedEpisodes.has(ep.firestoreId)) {
                  watchedEpisodes.delete(ep.firestoreId);
                  el.classList.remove('watched');
              } else {
                  watchedEpisodes.add(ep.firestoreId);
                  el.classList.add('watched');
              }
              saveWatchedStatus(); 
              updateBounty(); 

              if (currentIndex !== originalIndex) {
                  loadEpisode(originalIndex, true);
              }
          };

          el.onclick = clickHandler;
          el.onkeypress = (e) => { if (e.key === 'Enter' || e.key === ' ') clickHandler() };
          episodesGrid.appendChild(el);
      });
  }

  if (loadMoreContainer) {
      if (filteredEpisodes.length > visibleEpisodesCount) {
          loadMoreContainer.style.display = 'flex';
          loadMoreText.textContent = 'Показать еще';
          loadMoreBtn.classList.remove('expanded');
      } else if (visibleEpisodesCount > initialVisibleCount && filteredEpisodes.length > 0) {
          loadMoreContainer.style.display = 'flex';
          loadMoreText.textContent = 'Свернуть';
          loadMoreBtn.classList.add('expanded');
      } else {
          loadMoreContainer.style.display = 'none';
      }
  }

  if (paginationInfo) {
      const currentCount = Math.min(visibleEpisodesCount, filteredEpisodes.length);
      paginationInfo.textContent = `Показано ${currentCount} из ${filteredEpisodes.length}`;
  }

  markActive();
}

function loadEpisode(idx, shouldScroll = false) {
  if (idx < 0 || idx >= episodes.length) return;
  currentIndex = idx;
  localStorage.setItem('lastEpisodeIndex', currentIndex);
  
  const ep = episodes[idx];
  
  document.title = `EP ${ep.id} — ${ep.title} | Ван-Пис в озвучке Макс Летов & ShiYori`;

  const savedSource = localStorage.getItem(PLAYER_SOURCE_KEY) || 'dzen'; 
  if(playerSourceSelect) playerSourceSelect.value = savedSource; 
  
  const selectedPlayer = playerSourceSelect ? playerSourceSelect.value : 'dzen'; 
  
  const iframeCode = ep.players[selectedPlayer];
  if(playerEmbed) {
      playerEmbed.innerHTML = iframeCode 
        ? iframeCode 
        : `<span>Для плеера "${selectedPlayer.toUpperCase()}" видео не найдено.</span>`;
  }
  if(playerTitle) playerTitle.textContent = ep.title;
  if(playerSub) playerSub.textContent = `${ep.date} • ${ep.quality}`;
  if(metaText) metaText.textContent = `EP ${ep.id} • Загружено: ${ep.date}`;

  markActive();

  if (shouldScroll && window.innerWidth < 980) {
      const playerSection = document.getElementById('playerTitle');
      if(playerSection) {
          playerSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
  }
}

function markActive() {
  if (currentIndex < 0) return;
  const currentEpisodeId = episodes[currentIndex]?.firestoreId;
  if (!currentEpisodeId) return;
  if (!episodesGrid) return;
  
  const nodes = Array.from(episodesGrid.children);
  nodes.forEach(node => {
      if (node.dataset.firestoreId === currentEpisodeId) {
          node.classList.add('active');
      } else {
          node.classList.remove('active');
      }
  });
}

function debounce(func, timeout = 300){
  let timer;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => { func.apply(this, args); }, timeout);
  };
}

function openModal() {
  renderModalTable('');
  if(modal) {
      modal.classList.add('open');
      modal.setAttribute('aria-hidden', 'false');
  }
  if(modalSearch) modalSearch.focus();
}

function closeModal() {
  if(modal) {
      modal.classList.remove('open');
      modal.setAttribute('aria-hidden', 'true');
  }
}

function renderModalTable(filter = '') {
  if(!allTbody) return;
  allTbody.innerHTML = '';
  const q = filter.trim().toLowerCase();
  episodes.forEach((ep, idx) => {
    if (q && !(String(ep.id).includes(q) || ep.title.toLowerCase().includes(q))) return;
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td style="width:70px"><strong>${ep.id}</strong></td>
      <td>${ep.title}</td>
      <td style="width:120px">${ep.date}</td>
      <td style="width:80px">${ep.quality}</td>
      <td class="action-cell"><button class="btn" data-idx="${idx}">Смотреть</button></td>`;
    allTbody.appendChild(tr);
  });
  allTbody.querySelectorAll('button').forEach(b => {
    b.onclick = () => {
      const idx = Number(b.getAttribute('data-idx'));
      loadEpisode(idx, true);
      closeModal();
    };
  });
}

// --- Обработчики событий ---

if(prevBtn) prevBtn.addEventListener('click', () => {
  if (currentIndex < episodes.length - 1) loadEpisode(currentIndex + 1);
});
if(nextBtn) nextBtn.addEventListener('click', () => {
  if (currentIndex > 0) loadEpisode(currentIndex - 1);
});

if(playerSourceSelect) playerSourceSelect.addEventListener('change', () => {
  const newPlayer = playerSourceSelect.value;
  localStorage.setItem(PLAYER_SOURCE_KEY, newPlayer); 
  
  logEvent(analytics, 'select_player', { player_name: newPlayer });

  if (currentIndex !== -1) {
    loadEpisode(currentIndex);
  }
});

const processSearch = debounce((e) => {
  visibleEpisodesCount = initialVisibleCount;
  renderList(e.target.value);
});
if(search) search.addEventListener('input', processSearch);

if(sortSelect) sortSelect.addEventListener('change', (e) => {
  currentSortOrder = e.target.value;
  visibleEpisodesCount = initialVisibleCount; 
  sortEpisodes();
});

if(loadMoreBtn) loadMoreBtn.addEventListener('click', () => {
  const isExpanded = loadMoreBtn.classList.contains('expanded');

  if (isExpanded) {
      const episodesOnScreen = episodesGrid.querySelectorAll('.ep');
      for (let i = initialVisibleCount; i < episodesOnScreen.length; i++) {
          episodesOnScreen[i].classList.add('hiding');
      }
      setTimeout(() => {
          visibleEpisodesCount = initialVisibleCount;
          renderList(search.value);
          episodesGrid.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }, 300);
  } else {
      const term = search.value.trim().toLowerCase();
      const filteredEpisodes = episodes.filter(ep =>
          term ? ep.title.toLowerCase().includes(term) || String(ep.id).includes(term) : true
      );
      
      const nextCount = visibleEpisodesCount + 12;
      
      if (nextCount >= filteredEpisodes.length) {
           visibleEpisodesCount = filteredEpisodes.length;
      } else {
           visibleEpisodesCount = nextCount;
      }
      
      renderList(search.value);
  }
});

window.addEventListener('scroll', () => {
  if(!scrollTopBtn) return;
  if (window.scrollY > 500) {
      scrollTopBtn.classList.add('visible');
  } else {
      scrollTopBtn.classList.remove('visible');
  }
});

if(scrollTopBtn) scrollTopBtn.addEventListener('click', () => {
  window.scrollTo({ top: 0, behavior: 'smooth' });
});

if(allBtn) allBtn.addEventListener('click', openModal);
if(closeModalBtn) closeModalBtn.addEventListener('click', closeModal);
if(modal) modal.addEventListener('click', (e) => { if (e.target === modal) closeModal(); });
if(modalSearch) modalSearch.addEventListener('input', (e) => renderModalTable(e.target.value));

if(shareBtn) shareBtn.addEventListener('click', async () => {
  const shareData = {
    title: 'Ван-Пис в озвучке Макс Летов & ShiYori',
    text: 'Смотрю Ван-Пис в новой озвучке!',
    url: window.location.href
  };

  try {
    if (navigator.share) {
      await navigator.share(shareData);
    } else {
      navigator.clipboard.writeText(window.location.href).then(() => {
        alert('Ссылка на сайт скопирована!');
      }, () => {
        alert('Не удалось скопировать ссылку.');
      });
    }
  } catch (err) {
    console.log("Пользователь отменил отправку.");
  }
});

if(themeBtn) themeBtn.addEventListener('click', () => {
  const body = document.body;
  const currentTheme = body.getAttribute('data-theme');
  const newTheme = currentTheme === 'dark' ? 'light' : 'dark';
  body.setAttribute('data-theme', newTheme);
  localStorage.setItem('theme', newTheme);
});

// Кнопки для модального окна Copyright (оставим, если модалка есть в HTML)
if (copyrightModal && closeCopyrightModalBtn) {
    closeCopyrightModalBtn.addEventListener('click', () => {
        copyrightModal.classList.remove('open');
        copyrightModal.setAttribute('aria-hidden', 'true');
    });
    copyrightModal.addEventListener('click', (e) => {
        if (e.target === copyrightModal) {
            copyrightModal.classList.remove('open');
            copyrightModal.setAttribute('aria-hidden', 'true');
        }
    });
}

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    if (modal && modal.classList.contains('open')) closeModal();
    if (copyrightModal && copyrightModal.classList.contains('open')) {
      copyrightModal.classList.remove('open');
      copyrightModal.setAttribute('aria-hidden', 'true');
    }
  }
});

// --- Функция Инициализации Снега ---
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

// --- Инициализация при загрузке ---
document.addEventListener('DOMContentLoaded', () => {
  const savedTheme = localStorage.getItem('theme') || 'dark';
  document.body.setAttribute('data-theme', savedTheme);
  loadWatchedStatus();
  loadEpisodes();
  // Теперь запускаем таймер с загрузкой из базы
  initLogPoseTimer(); 
  initSnowEffect(); 
});
