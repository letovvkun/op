/**
 * Загружает быстрый поиск тайтлов только при взаимодействии с кнопкой.
 * Предварительная загрузка начинается при наведении/фокусе, чтобы к клику
 * модуль обычно уже был готов. Повторный click после загрузки сохраняет
 * исходное поведение компонента и его обработчиков.
 */
export function initLazyQuickTitleSearch() {
  const button = document.getElementById('titleSearchBtn');
  if (!button) return;

  let modulePromise = null;
  let initialized = false;

  const load = () => {
    if (initialized) return Promise.resolve();
    if (!modulePromise) {
      modulePromise = import('./quick-title-search.js')
        .then(({ initQuickTitleSearch }) => {
          initQuickTitleSearch();
          initialized = true;
        })
        .catch((error) => {
          modulePromise = null;
          throw error;
        });
    }
    return modulePromise;
  };

  const warm = () => {
    void load().catch((error) => {
      console.warn('Не удалось предварительно загрузить поиск тайтлов', error);
    });
  };

  button.addEventListener('pointerdown', warm, { once: true, passive: true });
  button.addEventListener('focus', warm, { once: true });

  // Если пользователь активировал кнопку до завершения импорта,
  // перехватываем первый клик и воспроизводим его после инициализации.
  button.addEventListener('click', async (event) => {
    if (initialized) return;

    event.preventDefault();
    event.stopImmediatePropagation();

    try {
      await load();
      button.click();
    } catch (error) {
      console.error('Не удалось загрузить поиск тайтлов', error);
    }
  }, true);
}
