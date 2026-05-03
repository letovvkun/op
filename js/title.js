import { initializeApp } from "https://www.gstatic.com/firebasejs/9.22.1/firebase-app.js";
  import { getFirestore, collection, getDocs, doc, getDoc, query, where } from "https://www.gstatic.com/firebasejs/9.22.1/firebase-firestore.js";

  const firebaseConfig = {
    apiKey: "AIzaSyBE1AkNd3bPGPr3ZPUbtqNUd2WDCB2SHHw",
    authDomain: "letovshiyori.firebaseapp.com",
    projectId: "letovshiyori"
  };

  const app = initializeApp(firebaseConfig);
  const db = getFirestore(app);

  const urlParams = new URLSearchParams(window.location.search);
  const currentTitleId = urlParams.get('id');

  if (!currentTitleId) {
      window.location.href = 'catalog.html'; 
  }

  // --- Глобальные переменные ---
  let episodes = [];
  let currentIndex = -1;
  const initialVisibleCount = 8; 
  let visibleEpisodesCount = initialVisibleCount;
  let watchedEpisodes = new Set();
  const PLAYER_SOURCE_KEY = 'lastPlayerSource'; 
  let currentSortOrder = 'desc'; 
  let plyrInstance = null;

  // --- Названия плееров для выпадающего списка ---
  const playerNames = {
      'hf': 'Без сжатия | Бета',
      'dzen': 'Dzen | 4K',
      'mega': 'Moon Player | 1080p',
      'kodik': 'Kodik | 720p',
      'subtitles': 'Dzen | Субтитры'
  };

  // --- DOM Элементы ---
  const episodesGrid = document.getElementById('episodesGrid');
  const playerEmbed = document.getElementById('playerEmbed');
  const playerTitle = document.getElementById('playerTitle');
  const playerSub = document.getElementById('playerSub');
  const search = document.getElementById('search');
  const allBtn = document.getElementById('allBtn');
  const modal = document.getElementById('modal');
  const allTbody = document.getElementById('allTbody');
  const modalSearch = document.getElementById('modalSearch');
  const playerSourceSelect = document.getElementById('playerSource');
  const prevBtn = document.getElementById('prevBtn');
  const nextBtn = document.getElementById('nextBtn');
  const shareBtn = document.getElementById('shareBtn');
  const loadMoreContainer = document.getElementById('loadMoreContainer');
  const loadMoreBtn = document.getElementById('loadMoreBtn');
  const loadMoreText = document.getElementById('loadMoreText');
  const paginationInfo = document.getElementById('paginationInfo');
  const sortSelect = document.getElementById('sortOrder');

  function updateBounty() {
    const bountyElem = document.getElementById('bountyAmount');
    if (!bountyElem) return;
    bountyElem.innerText = (watchedEpisodes.size * 1500000).toLocaleString('en-US');
  }

  function loadWatchedStatus() {
    const saved = localStorage.getItem('watchedEpisodes');
    if (saved) watchedEpisodes = new Set(JSON.parse(saved));
    updateBounty(); 
  }

  function saveWatchedStatus() {
    localStorage.setItem('watchedEpisodes', JSON.stringify([...watchedEpisodes]));
  }

  async function loadTitleData() {
      try {
          const docRef = doc(db, "titles", currentTitleId);
          const snap = await getDoc(docRef);
          
          if (snap.exists()) {
              const data = snap.data();
              document.title = `${data.name} | Макс Летов & ShiYori`;
              document.getElementById('headerTitleName').textContent = data.name;
              document.getElementById('sidebarTitleName').textContent = data.name;
              
              document.getElementById('titlePosterImg').src = data.poster || 'https://via.placeholder.com/300x450?text=No+Poster';
              document.getElementById('titleGenresInfo').textContent = data.genres || 'Не указаны';
              document.getElementById('titleVoiceInfo').textContent = data.voice || 'Макс Летов & ShiYori';
              document.getElementById('titleDescInfo').textContent = data.desc || 'Описание отсутствует.';
          } else {
              document.getElementById('headerTitleName').textContent = "Тайтл не найден";
          }
      } catch (err) {
          console.error("Ошибка загрузки тайтла:", err);
      }
  }

  async function loadEpisodes() {
    episodesGrid.innerHTML = '<div style="text-align:center;padding:2rem;width:100%;color:var(--muted);">Загрузка серий...</div>';
    try {
      const q = query(collection(db, "episodes"), where("titleId", "==", currentTitleId));
      const snap = await getDocs(q);
      
      episodes = snap.docs.map(d => ({ firestoreId: d.id, ...d.data() }));
      
      sortEpisodes();
      renderModalTable(''); 
      
      if (episodes.length > 0) {
        loadEpisode(0, false); 
      } else {
        playerEmbed.innerHTML = `<span>Для этого тайтла пока нет добавленных серий.</span>`;
        playerTitle.textContent = 'Ожидание эпизодов...';
      }
    } catch (error) {
      console.error(error);
      episodesGrid.innerHTML = `<div style="text-align:center;padding:2rem;width:100%;color:var(--error);">Ошибка загрузки серий.</div>`;
    }
  }

  function sortEpisodes() {
    if (currentSortOrder === 'desc') episodes.sort((a, b) => b.id - a.id);
    else episodes.sort((a, b) => a.id - b.id);
    renderList(search.value);
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
        // Оптимизация с помощью DocumentFragment
        const fragment = document.createDocumentFragment();

        episodesToRender.forEach((ep, loopIndex) => {
            const originalIndex = episodes.findIndex(e => e.firestoreId === ep.firestoreId);
            const el = document.createElement('div');
            el.className = 'ep';
            if (!term && loopIndex === 0 && currentSortOrder === 'desc') el.classList.add('new-episode');
            
            el.dataset.firestoreId = ep.firestoreId; 
            if (watchedEpisodes.has(ep.firestoreId)) el.classList.add('watched');

            el.innerHTML = `
              <div class="thumb" aria-hidden="true">
                ${ep.thumb ? `<img src="${ep.thumb}" alt="" style="width:100%;height:100%;object-fit:cover" loading="lazy">` : `EP ${ep.id}`}
              </div>
              <div class="meta">
                <div class="t">${ep.title}</div>
                <div class="s">${ep.date} • ${ep.quality}</div>
              </div>`;
            
            el.onclick = () => {
                if (watchedEpisodes.has(ep.firestoreId)) { watchedEpisodes.delete(ep.firestoreId); el.classList.remove('watched'); } 
                else { watchedEpisodes.add(ep.firestoreId); el.classList.add('watched'); }
                saveWatchedStatus(); updateBounty(); 
                if (currentIndex !== originalIndex) loadEpisode(originalIndex, true);
            };
            fragment.appendChild(el);
        });

        // Вставляем все узлы за один раз
        episodesGrid.appendChild(fragment);
    }

    if (filteredEpisodes.length > visibleEpisodesCount) {
        loadMoreContainer.style.display = 'flex'; loadMoreText.textContent = 'Показать еще'; loadMoreBtn.classList.remove('expanded');
    } else if (visibleEpisodesCount > initialVisibleCount && filteredEpisodes.length > 0) {
        loadMoreContainer.style.display = 'flex'; loadMoreText.textContent = 'Свернуть'; loadMoreBtn.classList.add('expanded');
    } else {
        loadMoreContainer.style.display = 'none';
    }
    
    if (paginationInfo) paginationInfo.textContent = `Показано ${Math.min(visibleEpisodesCount, filteredEpisodes.length)} из ${filteredEpisodes.length}`;
    markActive();
  }

  function loadEpisode(idx, shouldScroll = false) {
    if (idx < 0 || idx >= episodes.length) return;
    currentIndex = idx;
    const ep = episodes[idx];
    
    if (playerSourceSelect) {
        playerSourceSelect.innerHTML = '';
        // Достаем все плееры из базы, которые реально заполнены
        const availablePlayers = Object.keys(ep.players || {}).filter(k => ep.players[k]);

        if (availablePlayers.length === 0) {
            playerSourceSelect.innerHTML = `<option value="">Нет плееров</option>`;
            playerEmbed.innerHTML = `<span style="color:var(--muted);">Для этой серии видео пока недоступно.</span>`;
            if (plyrInstance) { plyrInstance.destroy(); plyrInstance = null; }
        } else {
            availablePlayers.forEach(key => {
                const name = playerNames[key] || key.toUpperCase();
                playerSourceSelect.innerHTML += `<option value="${key}">${name}</option>`;
            });

            const savedSource = localStorage.getItem(PLAYER_SOURCE_KEY) || 'hf';
            const selectedPlayer = availablePlayers.includes(savedSource) ? savedSource : availablePlayers[0];
            playerSourceSelect.value = selectedPlayer;

            if (plyrInstance) { plyrInstance.destroy(); plyrInstance = null; }

            if (selectedPlayer === 'hf') {
                const fileName = ep.players.hf;
                const videoUrl = `https://huggingface.co/datasets/letovvkun/op_archive/resolve/main/${fileName}?download=true`;
                playerEmbed.innerHTML = `<video id="plyr-hf-player" playsinline controls><source src="${videoUrl}" type="video/mp4" size="1080"></video>`;
                setTimeout(() => {
                    plyrInstance = new Plyr('#plyr-hf-player', {
                        title: ep.title, controls: ['play-large', 'play', 'progress', 'current-time', 'duration', 'mute', 'volume', 'settings', 'fullscreen'],
                        settings: ['quality', 'speed'], quality: { default: 1080, options: [1080, 720, 480] }
                    });
                }, 50);
            } else {
                playerEmbed.innerHTML = ep.players[selectedPlayer];
            }
        }
    }

    playerTitle.textContent = ep.title;
    playerSub.textContent = `${ep.date} • ${ep.quality}`;
    markActive();

    if (shouldScroll && window.innerWidth < 980) {
        document.getElementById('playerTitle').scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }

  function markActive() {
    if (currentIndex < 0) return;
    const currentEpId = episodes[currentIndex]?.firestoreId;
    Array.from(episodesGrid.children).forEach(node => {
        if (node.dataset.firestoreId === currentEpId) node.classList.add('active');
        else node.classList.remove('active');
    });
  }

  // --- ОБРАБОТЧИКИ ---
  playerSourceSelect.addEventListener('change', () => {
    localStorage.setItem(PLAYER_SOURCE_KEY, playerSourceSelect.value); 
    if (currentIndex !== -1) loadEpisode(currentIndex);
  });

  let searchTimeout;
  search.addEventListener('input', (e) => {
    clearTimeout(searchTimeout);
    searchTimeout = setTimeout(() => { visibleEpisodesCount = initialVisibleCount; renderList(e.target.value); }, 300);
  });

  sortSelect.addEventListener('change', (e) => {
    currentSortOrder = e.target.value; visibleEpisodesCount = initialVisibleCount; sortEpisodes();
  });

  loadMoreBtn.addEventListener('click', () => {
    if (loadMoreBtn.classList.contains('expanded')) {
        visibleEpisodesCount = initialVisibleCount; renderList(search.value);
        episodesGrid.scrollIntoView({ behavior: 'smooth', block: 'start' });
    } else {
        visibleEpisodesCount += 12; renderList(search.value);
    }
  });

  prevBtn.addEventListener('click', () => { if (currentIndex < episodes.length - 1) loadEpisode(currentIndex + 1, true); });
  nextBtn.addEventListener('click', () => { if (currentIndex > 0) loadEpisode(currentIndex - 1, true); });
  
  allBtn.addEventListener('click', () => { renderModalTable(''); modal.classList.add('open'); });
  document.getElementById('closeModal').addEventListener('click', () => modal.classList.remove('open'));
  modalSearch.addEventListener('input', (e) => renderModalTable(e.target.value));

  function renderModalTable(filter) {
    allTbody.innerHTML = '';
    const q = filter.trim().toLowerCase();
    
    // Оптимизация рендера модальной таблицы
    const fragment = document.createDocumentFragment();

    episodes.forEach((ep, idx) => {
      if (q && !(String(ep.id).includes(q) || ep.title.toLowerCase().includes(q))) return;
      const tr = document.createElement('tr');
      tr.innerHTML = `<td><strong>${ep.id}</strong></td><td>${ep.title}</td><td>${ep.date}</td><td>${ep.quality}</td><td class="action-cell"><button class="btn" data-idx="${idx}">Смотреть</button></td>`;
      fragment.appendChild(tr);
    });
    
    allTbody.appendChild(fragment);

    allTbody.querySelectorAll('button').forEach(b => b.onclick = () => { loadEpisode(Number(b.getAttribute('data-idx')), true); modal.classList.remove('open'); });
  }

  shareBtn.addEventListener('click', async () => {
    try {
      if (navigator.share) await navigator.share({ title: document.title, url: window.location.href });
      else navigator.clipboard.writeText(window.location.href).then(() => alert('Ссылка скопирована!'));
    } catch (err) {}
  });

  const floatingMenuBtn = document.getElementById('floatingMenuBtn');
  const floatingMenu = document.getElementById('floatingMenu');
  if (floatingMenuBtn && floatingMenu) {
      floatingMenuBtn.addEventListener('click', (e) => { e.stopPropagation(); floatingMenu.classList.toggle('active'); floatingMenuBtn.classList.toggle('is-open'); });
      document.addEventListener('click', (e) => { if (!floatingMenu.contains(e.target) && e.target !== floatingMenuBtn) { floatingMenu.classList.remove('active'); floatingMenuBtn.classList.remove('is-open'); } });
  }
  
  const themeBtn = document.getElementById('themeBtn');
  if(themeBtn) themeBtn.addEventListener('click', () => {
      const newTheme = document.body.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
      document.body.setAttribute('data-theme', newTheme);
      localStorage.setItem('theme', newTheme);
  });

  document.addEventListener('DOMContentLoaded', () => {
      document.body.setAttribute('data-theme', localStorage.getItem('theme') || 'dark');
      loadWatchedStatus();
      loadTitleData().then(() => loadEpisodes());
  });

  const scrollTopBtn = document.getElementById('scrollTopBtn');
  window.addEventListener('scroll', () => { if(scrollTopBtn) scrollTopBtn.classList.toggle('visible', window.scrollY > 500); });
  if(scrollTopBtn) scrollTopBtn.addEventListener('click', () => window.scrollTo({ top: 0, behavior: 'smooth' }));