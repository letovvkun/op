const GISCUS_SCRIPT_URL = 'https://giscus.app/client.js';

const GISCUS_CONFIG = Object.freeze({
  repo: 'l3towm-byte/image',
  repoId: 'R_kgDOSTLQkA',
  category: 'General',
  categoryId: 'DIC_kwDOSTLQkM4C-S7f',
  mapping: 'pathname',
  strict: '0',
  reactionsEnabled: '0',
  emitMetadata: '0',
  inputPosition: 'bottom',
  theme: 'dark',
  lang: 'ru'
});

/**
 * Создаёт Giscus только при первом открытии обсуждения.
 * Повторные вызовы не создают дубликаты; при сетевой ошибке доступна повторная попытка.
 */
export function createLazyGiscusLoader(container, documentRef = globalThis.document) {
  let state = 'idle';
  let activeScript = null;
  let observer = null;
  let fallbackTimer = null;

  return function loadGiscus() {
    if (!container || !documentRef || state !== 'idle') return activeScript;

    state = 'loading';
    container.innerHTML = `
      <div class="chat-loading-skeleton" data-giscus-skeleton aria-hidden="true">
        <span class="skeleton-loader"></span>
        <span class="skeleton-loader"></span>
        <span class="skeleton-loader"></span>
      </div>
    `;
    container.setAttribute?.('aria-busy', 'true');

    const finishLoading = () => {
      container.querySelector?.('[data-giscus-skeleton]')?.remove();
      container.removeAttribute?.('aria-busy');
      observer?.disconnect();
      observer = null;
      if (fallbackTimer !== null) {
        clearTimeout(fallbackTimer);
        fallbackTimer = null;
      }
    };

    const MutationObserverClass = documentRef.defaultView?.MutationObserver || globalThis.MutationObserver;
    if (typeof MutationObserverClass === 'function') {
      observer = new MutationObserverClass(() => {
        if (container.querySelector?.('iframe')) finishLoading();
      });
      observer.observe(container, { childList: true, subtree: true });
    }

    const script = documentRef.createElement('script');
    activeScript = script;
    script.src = GISCUS_SCRIPT_URL;
    script.async = true;
    script.crossOrigin = 'anonymous';

    for (const [key, value] of Object.entries(GISCUS_CONFIG)) {
      script.dataset[key] = value;
    }

    script.addEventListener('load', () => {
      if (activeScript !== script) return;
      state = 'loaded';
      if (container.querySelector?.('iframe')) {
        finishLoading();
      } else {
        fallbackTimer = setTimeout(() => {
          if (container.querySelector?.('iframe')) {
            finishLoading();
            return;
          }
          finishLoading();
          container.textContent = 'Не удалось открыть обсуждение. Попробуйте закрыть и открыть чат ещё раз.';
        }, 12000);
      }
    }, { once: true });

    script.addEventListener('error', () => {
      if (activeScript !== script) return;
      state = 'idle';
      activeScript = null;
      observer?.disconnect();
      observer = null;
      finishLoading();
      container.textContent = 'Чат временно недоступен. Откройте его ещё раз для повторной попытки.';
      script.remove();
    }, { once: true });

    container.appendChild(script);
    return script;
  };
}
