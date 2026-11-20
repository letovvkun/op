import { applySavedTheme } from '../core/ui.js';

applySavedTheme();

// Страницы /title/<id>/ создаются при сборке. Если тайтл добавили позже последней сборки,
// GitHub Pages отдаёт эту 404-страницу, а мы открываем динамическую версию того же тайтла.
const titleMatch = window.location.pathname.match(/^\/title\/([a-zA-Z0-9_-]{1,80})\/?$/);
if (titleMatch) {
  window.location.replace(`/title.html?id=${encodeURIComponent(titleMatch[1])}`);
}
