import { toTimestampMillis } from '../core/safe-dom.js';
import { initThemeToggle, initFloatingMenu, initSeasonalSnowEffect, initDetailsAnimation } from '../core/ui.js';
import { logDataError } from '../core/errors.js';
import { loadSiteSetting } from '../services/site-settings.js';
import { clearSkeletonState, createSkeletonLine, setSkeletonContent } from '../core/skeletons.js';

initThemeToggle();
initFloatingMenu();

async function loadStatus() {
  const statusIds = ['view-translation', 'view-dub-max', 'view-dub-shiyori', 'view-mixing', 'view-upload'];
  const epNumEl = document.getElementById('view-ep-num');
  const updatedEl = document.getElementById('view-updated');
  for (const id of statusIds) setSkeletonContent(document.getElementById(id), createSkeletonLine('skeleton-line--status'));
  setSkeletonContent(epNumEl, createSkeletonLine('skeleton-line--status-number'));
  setSkeletonContent(updatedEl, createSkeletonLine('skeleton-line--status-date'));

  try {
    const data = await loadSiteSetting('release_status');
    if (!data) {
      if (epNumEl) { epNumEl.textContent = '—'; clearSkeletonState(epNumEl); }
      for (const id of statusIds) {
        const element = document.getElementById(id);
        if (element) { element.textContent = 'Нет данных'; clearSkeletonState(element); }
      }
      if (updatedEl) { updatedEl.textContent = '—'; clearSkeletonState(updatedEl); }
      return;
    }
    if (epNumEl) { epNumEl.textContent = data.episode || '???'; clearSkeletonState(epNumEl); }

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
      clearSkeletonState(el);
    };

    updateBadge('view-translation', data.translation);
    updateBadge('view-dub-max', data.dub_max);
    updateBadge('view-dub-shiyori', data.dub_shiyori);
    updateBadge('view-mixing', data.mixing);
    updateBadge('view-upload', data.upload);

    if (data.updatedAt) {
      if (updatedEl) {
        const updatedAtMs = toTimestampMillis(data.updatedAt);
        const date = updatedAtMs ? new Date(updatedAtMs) : null;
        updatedEl.textContent = date ? date.toLocaleString('ru-RU', {
          day: 'numeric',
          month: 'short',
          hour: '2-digit',
          minute: '2-digit'
        }) : '—';
        clearSkeletonState(updatedEl);
      }
    } else if (updatedEl) {
      updatedEl.textContent = '—';
      clearSkeletonState(updatedEl);
    }
  } catch (e) {
    logDataError('Ошибка загрузки статуса', e);
    if (epNumEl) { epNumEl.textContent = '—'; clearSkeletonState(epNumEl); }
    for (const id of statusIds) {
      const element = document.getElementById(id);
      if (element) { element.textContent = 'Недоступно'; clearSkeletonState(element); }
    }
    if (updatedEl) { updatedEl.textContent = '—'; clearSkeletonState(updatedEl); }
  }
}



document.addEventListener('DOMContentLoaded', () => {
  loadStatus();
  initSeasonalSnowEffect();
  initDetailsAnimation();
});
