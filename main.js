// --- FIREBASE: Импорт и инициализация ---
  import { initializeApp } from "https://www.gstatic.com/firebasejs/9.22.1/firebase-app.js";
  import { getFirestore, collection, getDocs, orderBy, query } from "https://www.gstatic.com/firebasejs/9.22.1/firebase-firestore.js";

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
  const episodesCollection = collection(db, 'episodes');

  // --- Глобальные переменные ---
  let episodes = [];
  let currentIndex = -1;
  const initialVisibleCount = 4;
  let visibleEpisodesCount = initialVisibleCount;
  let watchedEpisodes = new Set();

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
  const copyrightBtn = document.getElementById('copyrightBtn');
  const copyrightModal = document.getElementById('copyrightModal');
  const closeCopyrightModalBtn = document.getElementById('closeCopyrightModal');
  const loadMoreContainer = document.getElementById('loadMoreContainer');
  const loadMoreBtn = document.getElementById('loadMoreBtn');

  // --- Функция обновления награды ---
  function updateBounty() {
    const bountyElem = document.getElementById('bountyAmount');
    if (!bountyElem) return;

    // СТОИМОСТЬ ОДНОЙ СЕРИИ (1.5 млн белли)
    const pricePerEp = 1500000; 
    
    // Считаем общую сумму
    const totalBounty = watchedEpisodes.size * pricePerEp;

    // Форматируем число с разделителями (1,500,000)
    bountyElem.innerText = totalBounty.toLocaleString('en-US');
  }

  // --- Функции для работы со статусом просмотра ---
  function loadWatchedStatus() {
    const saved = localStorage.getItem('watchedEpisodes');
    if (saved) {
      watchedEpisodes = new Set(JSON.parse(saved));
    }
    updateBounty(); // Обновляем награду при загрузке
  }

  function saveWatchedStatus() {
    localStorage.setItem('watchedEpisodes', JSON.stringify([...watchedEpisodes]));
  }
  
  // --- Функция Таймера (Log Pose) ---
  function startCountdown() {
    const countElem = document.getElementById('countdown');
    if (!countElem) return;

    function update() {
      const now = new Date();
      // Вычисляем следующее воскресенье
      const nextRelease = new Date();
      nextRelease.setDate(now.getDate() + (7 - now.getDay()) % 7);
      nextRelease.setHours(23, 0, 0, 0); // <-- ВРЕМЯ УСТАНОВЛЕНО НА 23:00
      
      // Если сегодня воскресенье и время уже прошло, ставим на след. неделю
      if (now > nextRelease) {
        nextRelease.setDate(nextRelease.getDate() + 7);
      }

      const diff = nextRelease - now;
      
      const d = Math.floor(diff / (1000 * 60 * 60 * 24));
      const h = Math.floor((diff / (1000 * 60 * 60)) % 24);
      const m = Math.floor((diff / 1000 / 60) % 60);

      // Красивый формат с ведущими нулями (если нужно)
      countElem.innerText = `${d}д ${h}ч ${m}м`;
    }

    setInterval(update, 60000); // Обновляем раз в минуту
    update();
  }

  // --- Функции рендеринга скелетона ---
  function renderSkeletons() {
    episodesGrid.innerHTML = '';
    // Генерируем столько скелетов, сколько серий показываем по умолчанию
    for (let i = 0; i < initialVisibleCount; i++) {
        const el = document.createElement('div');
        el.className = 'ep';
        el.style.pointerEvents = 'none'; // Чтобы нельзя было нажать во время загрузки
        el.innerHTML = `
          <div class="thumb skeleton-loader" style="border:none;"></div>
          <div class="meta" style="width:100%">
            <div class="skeleton-loader" style="height:14px; width:70%; margin-bottom:6px;"></div>
            <div class="skeleton-loader" style="height:12px; width:40%;"></div>
          </div>`;
        episodesGrid.appendChild(el);
    }
  }

  // --- Функции ---
  async function loadEpisodes() {
    // Включаем скелетон перед загрузкой
    renderSkeletons();
    
    try {
      const q = query(episodesCollection, orderBy("id", "desc"));
      const querySnapshot = await getDocs(q);
      episodes = querySnapshot.docs.map(doc => ({ firestoreId: doc.id, ...doc.data() }));
      renderList();
      renderModalTable();
      
      const savedIndex = localStorage.getItem('lastEpisodeIndex');
      const indexToLoad = (savedIndex !== null && episodes[savedIndex]) ? parseInt(savedIndex, 10) : 0;
      
      if (episodes.length > 0) {
        loadEpisode(indexToLoad); 
      } else {
        playerEmbed.innerHTML = `<span>Серии пока не добавлены.</span>`;
        playerTitle.textContent = 'Нет доступных серий';
      }
    } catch (error) {
      console.error("Ошибка при загрузке серий из Firestore: ", error);
      episodesGrid.innerHTML = `<div style="text-align:center;padding:2rem;width:100%;color:var(--accent-c);">Ошибка загрузки данных.</div>`;
    }
  }

  function renderList(filter = '') {
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
            
            // Если это самый первый элемент в списке (и нет поиска), добавляем класс NEW
            if (!term && loopIndex === 0) {
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
                updateBounty(); // Обновляем награду при клике

                if (currentIndex !== originalIndex) {
                    loadEpisode(originalIndex);
                }
            };

            el.onclick = clickHandler;
            el.onkeypress = (e) => { if (e.key === 'Enter' || e.key === ' ') clickHandler() };
            episodesGrid.appendChild(el);
        });
    }

    if (filteredEpisodes.length > initialVisibleCount) {
        loadMoreContainer.style.display = 'flex';
        if (visibleEpisodesCount >= filteredEpisodes.length && filteredEpisodes.length > 0) {
            loadMoreBtn.classList.add('expanded');
        } else {
            loadMoreBtn.classList.remove('expanded');
        }
    } else {
        loadMoreContainer.style.display = 'none';
    }
    markActive();
  }

  function loadEpisode(idx) {
    if (idx < 0 || idx >= episodes.length) return;
    currentIndex = idx;
    localStorage.setItem('lastEpisodeIndex', currentIndex);
    
    const ep = episodes[idx];
    
    const selectedPlayer = playerSourceSelect.value;
    const iframeCode = ep.players[selectedPlayer];
    playerEmbed.innerHTML = iframeCode 
      ? iframeCode 
      : `<span>Для плеера "${selectedPlayer.toUpperCase()}" видео не найдено.</span>`;
    playerTitle.textContent = ep.title;
    playerSub.textContent = `${ep.date} • ${ep.quality}`;
    metaText.textContent = `EP ${ep.id} • Загружено: ${ep.date}`;
    markActive();

    // Плавный скролл к плееру на мобильных (если экран меньше 980px)
    if (window.innerWidth < 980) {
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
    const nodes = Array.from(episodesGrid.children);
    nodes.forEach(node => {
        if (node.dataset.firestoreId === currentEpisodeId) {
            node.classList.add('active');
            // scrollIntoView здесь убран, так как он может мешать при клике. 
            // Мы используем скролл только при загрузке эпизода (loadEpisode).
        } else {
            node.classList.remove('active');
        }
    });
  }

  function openModal() {
    renderModalTable('');
    modal.classList.add('open');
    modal.setAttribute('aria-hidden', 'false');
    modalSearch.focus();
  }
  function closeModal() {
    modal.classList.remove('open');
    modal.setAttribute('aria-hidden', 'true');
  }

  function renderModalTable(filter = '') {
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
        loadEpisode(idx);
        closeModal();
      };
    });
  }
  
  // --- Обработчики событий ---

  prevBtn.addEventListener('click', () => {
    if (currentIndex < episodes.length - 1) loadEpisode(currentIndex + 1);
  });
  nextBtn.addEventListener('click', () => {
    if (currentIndex > 0) loadEpisode(currentIndex - 1);
  });
  playerSourceSelect.addEventListener('change', () => {
    if (currentIndex !== -1) {
      loadEpisode(currentIndex);
    }
  });
  search.addEventListener('input', (e) => {
    visibleEpisodesCount = initialVisibleCount;
    renderList(e.target.value);
  });

  loadMoreBtn.addEventListener('click', () => {
    const isExpanded = loadMoreBtn.classList.contains('expanded');

    if (isExpanded) {
        const episodesOnScreen = episodesGrid.querySelectorAll('.ep');
        for (let i = initialVisibleCount; i < episodesOnScreen.length; i++) {
            episodesOnScreen[i].classList.add('hiding');
        }
        setTimeout(() => {
            visibleEpisodesCount = initialVisibleCount;
            renderList(search.value);
        }, 300);
    } else {
        const term = search.value.trim().toLowerCase();
        const filteredEpisodes = episodes.filter(ep =>
            term ? ep.title.toLowerCase().includes(term) || String(ep.id).includes(term) : true
        );
        visibleEpisodesCount = filteredEpisodes.length;
        renderList(search.value);
    }
  });

  allBtn.addEventListener('click', openModal);
  closeModalBtn.addEventListener('click', closeModal);
  modal.addEventListener('click', (e) => { if (e.target === modal) closeModal(); });
  modalSearch.addEventListener('input', (e) => renderModalTable(e.target.value));
  
  shareBtn.addEventListener('click', async () => {
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

  themeBtn.addEventListener('click', () => {
    const body = document.body;
    const currentTheme = body.getAttribute('data-theme');
    const newTheme = currentTheme === 'dark' ? 'light' : 'dark';
    body.setAttribute('data-theme', newTheme);
    localStorage.setItem('theme', newTheme);
  });

  copyrightBtn.addEventListener('click', () => {
    copyrightModal.classList.add('open');
    copyrightModal.setAttribute('aria-hidden', 'false');
  });
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

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      if (modal.classList.contains('open')) closeModal();
      if (copyrightModal.classList.contains('open')) {
        copyrightModal.classList.remove('open');
        copyrightModal.setAttribute('aria-hidden', 'true');
      }
    }
  });

  // --- Инициализация при загрузке ---
  document.addEventListener('DOMContentLoaded', () => {
    const savedTheme = localStorage.getItem('theme') || 'dark';
    document.body.setAttribute('data-theme', savedTheme);
    loadWatchedStatus();
    loadEpisodes();
    startCountdown(); // Запуск таймера
  });