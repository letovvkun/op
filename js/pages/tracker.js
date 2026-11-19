import { escapeHTML, safeHttpsUrl, safeMagnetUrl } from '../core/safe-dom.js';
import { loadTrackerEntries } from '../services/tracker-data.js';
import { initThemeToggle, initFloatingMenu, showToast } from '../core/ui.js';
import { getDataErrorMessage, logDataError } from '../core/errors.js';
import { clearSkeletonState, createTrackerTableSkeleton, setSkeletonContent } from '../core/skeletons.js';
initThemeToggle();
initFloatingMenu();

const iconPack = `<svg viewBox="0 0 24 24" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"><polygon points="12 2 2 7 12 12 22 7 12 2"></polygon><polyline points="2 17 12 22 22 17"></polyline><polyline points="2 12 12 17 22 12"></polyline></svg>`;
const iconEpisode = `<svg viewBox="0 0 24 24" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"><polygon points="5 3 19 12 5 21 5 3"></polygon></svg>`;
const iconTorrent = `<svg viewBox="0 0 24 24" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="7 10 12 15 17 10"></polyline><line x1="12" y1="15" x2="12" y2="3"></line></svg>`;
const iconMagnet = `<svg viewBox="0 0 24 24" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"><path d="m6 15-4-4 6.75-6.77a7.79 7.79 0 0 1 11 11L13 22l-4-4 6.39-6.36a2.14 2.14 0 0 0-3-3L6 15"></path></svg>`;

let allTorrents = [];
const tableBody = document.getElementById('trackerTableBody');
const filterType = document.getElementById('filterType');
const sortOrder = document.getElementById('sortOrder');

async function loadTrackerData() {
  setSkeletonContent(tableBody, createTrackerTableSkeleton(4));
  try {
    allTorrents = await loadTrackerEntries();
    applyFiltersAndRender();
  } catch (error) {
    logDataError('Ошибка загрузки трекера', error);
    if (tableBody) {
      const cell = document.createElement('td');
      cell.colSpan = 4;
      cell.className = 'empty-state';
      cell.style.color = 'var(--error)';
      cell.textContent = getDataErrorMessage(error, 'Ошибка загрузки данных.');
      const row = document.createElement('tr');
      row.appendChild(cell);
      tableBody.replaceChildren(row);
      clearSkeletonState(tableBody);
    }
  }
}

function applyFiltersAndRender() {
  let filtered = [...allTorrents];

  const currentFilter = filterType?.value || 'all';
  if (currentFilter !== 'all') {
    filtered = filtered.filter(item => item.type === currentFilter);
  }

  const currentSort = sortOrder?.value || 'desc';
  filtered.sort((a, b) => currentSort === 'desc' ? b.timestamp - a.timestamp : a.timestamp - b.timestamp);

  renderTable(filtered);
}

function renderTable(data) {
  if (!tableBody) return;
  clearSkeletonState(tableBody);
  if (data.length === 0) {
    tableBody.innerHTML = '<tr><td colspan="4" class="empty-state">Раздач по вашему запросу не найдено.</td></tr>';
    return;
  }

  tableBody.innerHTML = data.map(item => {
    const badgeHtml = item.type === 'pack'
      ? `<span class="badge pack">${iconPack} ПАК</span>`
      : `<span class="badge episode">${iconEpisode} СЕРИЯ</span>`;

    let linksHtml = '';
    if (item.torrentUrl) {
      const torrentUrl = safeHttpsUrl(item.torrentUrl);
      if (torrentUrl) linksHtml += `<a href="${escapeHTML(torrentUrl)}" target="_blank" rel="noopener noreferrer" class="dl-btn torrent" title="Скачать .torrent файл">${iconTorrent} .torrent</a>`;
    }
    if (item.magnet) {
      const magnetUrl = safeMagnetUrl(item.magnet);
      if (magnetUrl) linksHtml += `<a href="${escapeHTML(magnetUrl)}" class="dl-btn magnet" title="Открыть Magnet-ссылку">${iconMagnet} Magnet</a>`;
    }

    return `
      <tr>
        <td style="text-align: center;">${badgeHtml}</td>
        <td><div class="item-title">${escapeHTML(item.title || 'Без названия')}</div></td>
        <td><div class="item-date">${escapeHTML(item.dateStr || 'Неизвестно')}</div></td>
        <td><div class="dl-links">${linksHtml}</div></td>
      </tr>
    `;
  }).join('');
}

if (tableBody) tableBody.addEventListener('click', (e) => {
  const magnetBtn = e.target.closest('a.dl-btn.magnet');
  if (magnetBtn && navigator.clipboard) {
    navigator.clipboard.writeText(magnetBtn.href).then(() => {
      showToast('Magnet-ссылка скопирована!', 2500);
    }).catch(() => {});
  }
});

if (filterType) filterType.addEventListener('change', applyFiltersAndRender);
if (sortOrder) sortOrder.addEventListener('change', applyFiltersAndRender);

document.addEventListener('DOMContentLoaded', loadTrackerData);
