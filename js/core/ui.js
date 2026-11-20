/**
 * Общие UI-механизмы сайта.
 * Здесь находятся только повторно используемые поведения, без разметки конкретных страниц.
 */

import { readStorage, writeStorage } from './storage.js';

const initializedThemeButtons = new WeakSet();
const initializedFloatingMenus = new WeakMap();
const initializedDetailsSummaries = new WeakSet();

export function debounce(fn, delay = 250) {
  let timer = null;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), delay);
  };
}

export function showToast(message, duration = 2600) {
  let toast = document.querySelector('.toast-notification');
  if (!toast) {
    toast = document.createElement('div');
    toast.className = 'toast-notification';
    document.body.appendChild(toast);
  }

  toast.textContent = String(message ?? '');
  toast.classList.add('show');
  clearTimeout(toast._hideTimer);
  toast._hideTimer = setTimeout(() => {
    toast.classList.remove('show');
    toast._hideTimer = null;
  }, duration);
}

function readStoredTheme(defaultTheme) {
  const savedTheme = readStorage('theme');
  return savedTheme === 'light' || savedTheme === 'dark' ? savedTheme : defaultTheme;
}

function persistTheme(theme) {
  writeStorage('theme', theme);
}

export function applySavedTheme(defaultTheme = 'dark') {
  const theme = readStoredTheme(defaultTheme);
  document.body?.setAttribute('data-theme', theme);
  return theme;
}

export function initThemeToggle({ buttonId = 'themeBtn', defaultTheme = 'dark' } = {}) {
  const themeButton = document.getElementById(buttonId);
  applySavedTheme(defaultTheme);

  if (!themeButton || initializedThemeButtons.has(themeButton)) return;
  initializedThemeButtons.add(themeButton);

  themeButton.addEventListener('click', () => {
    const currentTheme = document.body.getAttribute('data-theme');
    const nextTheme = currentTheme === 'dark' ? 'light' : 'dark';
    document.body.setAttribute('data-theme', nextTheme);
    persistTheme(nextTheme);
  });
}

export function initScrollToTop({ buttonId = 'scrollTopBtn', threshold = 500 } = {}) {
  const button = document.getElementById(buttonId);
  if (!button) return;

  const updateVisibility = () => {
    button.classList.toggle('visible', window.scrollY > threshold);
  };

  let updateScheduled = false;
  const scheduleVisibilityUpdate = () => {
    if (updateScheduled) return;
    updateScheduled = true;
    window.requestAnimationFrame(() => {
      updateScheduled = false;
      updateVisibility();
    });
  };

  window.addEventListener('scroll', scheduleVisibilityUpdate, { passive: true });
  button.addEventListener('click', () => {
    window.scrollTo({ top: 0, behavior: 'smooth' });
  });
  updateVisibility();
}

export function initFloatingMenu({ buttonId = 'floatingMenuBtn', menuId = 'floatingMenu' } = {}) {
  const button = document.getElementById(buttonId);
  const menu = document.getElementById(menuId);
  if (!button || !menu || initializedFloatingMenus.get(button) === menu) return;
  initializedFloatingMenus.set(button, menu);

  const closeMenu = () => {
    menu.classList.remove('active');
    button.classList.remove('is-open');
    button.setAttribute('aria-expanded', 'false');
  };

  button.addEventListener('click', (event) => {
    event.stopPropagation();
    const willOpen = !menu.classList.contains('active');
    menu.classList.toggle('active', willOpen);
    button.classList.toggle('is-open', willOpen);
    button.setAttribute('aria-expanded', String(willOpen));
  });

  document.addEventListener('click', (event) => {
    if (!menu.contains(event.target) && !button.contains(event.target)) closeMenu();
  });

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') closeMenu();
  });
}

export function initSeasonalSnowEffect() {
  if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return;
  if (document.querySelector('.snow-wrapper')) return;

  const now = new Date();
  const month = now.getMonth();
  const day = now.getDate();
  const isSeason = (month === 11 && day >= 10) || (month === 0 && day <= 20);
  if (!isSeason) return;

  const wrapper = document.createElement('div');
  wrapper.className = 'snow-wrapper';
  const fragment = document.createDocumentFragment();

  // На телефонах и устройствах с малым числом ядер хватает меньшего количества снежинок.
  const isLightDevice = window.matchMedia?.('(max-width: 767px)').matches || (navigator.hardwareConcurrency || 8) <= 4;
  const flakeCount = isLightDevice ? 18 : 45;

  for (let i = 0; i < flakeCount; i++) {
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

/**
 * Кнопка «Поделиться»: системное окно, если оно есть, иначе копирование ссылки.
 * getShareData возвращает { title, text?, url }; copiedMessage показывается после копирования.
 */
export function initShareButton(button, getShareData, copiedMessage = 'Ссылка скопирована!') {
  if (!button) return;

  button.addEventListener('click', async () => {
    const shareData = getShareData();
    try {
      if (navigator.share) {
        await navigator.share(shareData);
      } else {
        await navigator.clipboard.writeText(shareData.url);
        showToast(copiedMessage);
      }
    } catch (_) {
      // Пользователь закрыл окно «Поделиться» или буфер обмена недоступен: ничего делать не нужно.
    }
  });
}

export function initDetailsAnimation() {
  document.querySelectorAll('details').forEach((detail) => {
    const summary = detail.querySelector('summary');
    const content = detail.querySelector('.faq-content');
    if (!summary || !content || initializedDetailsSummaries.has(summary)) return;
    initializedDetailsSummaries.add(summary);

    let currentAnimation = null;

    summary.addEventListener('click', (event) => {
      event.preventDefault();
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
