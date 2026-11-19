import { readStorage, writeStorage, removeStorage } from './storage.js';

/**
 * Общие безопасные DOM- и cache-утилиты.
 * Не вставляйте данные из Firestore в HTML без escapeHTML().
 */
export function escapeHTML(value) {
  return String(value ?? '').replace(/[&<>"']/g, (char) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  })[char]);
}

export function safeHttpsUrl(value, fallback = '') {
  if (typeof value !== 'string' || !value.trim()) return fallback;
  const raw = value.trim();
  try {
    const url = new URL(raw, window.location.href);
    const isRelative = !/^[a-z][a-z0-9+.-]*:/i.test(raw) && !raw.startsWith('//');
    if (url.protocol !== 'https:' && !(isRelative && url.origin === window.location.origin)) return fallback;
    if (url.username || url.password) return fallback;
    return url.href;
  } catch (_) {
    return fallback;
  }
}

export function safeMagnetUrl(value) {
  if (typeof value !== 'string') return '';
  const raw = value.trim();
  if (!/^magnet:\?/i.test(raw) || !/[?&]xt=urn:btih:[a-z0-9]{32,64}(?:&|$)/i.test(raw)) return '';
  return raw;
}

export function getPlayerEmbedUrl(rawContent) {
  if (typeof rawContent !== 'string' || !rawContent.trim()) return '';
  const raw = rawContent.trim();
  let candidate = raw;

  // Старые записи могли хранить полный iframe-код. Извлекаем только src,
  // любые остальные атрибуты/теги из базы данных полностью игнорируются.
  if (/^<iframe\b/i.test(raw)) {
    try {
      const parsed = new DOMParser().parseFromString(raw, 'text/html');
      candidate = parsed.querySelector('iframe')?.getAttribute('src') || '';
    } catch (_) {
      return '';
    }
  }

  const safeUrl = safeHttpsUrl(candidate);
  if (!safeUrl) return '';

  try {
    const url = new URL(safeUrl);
    // Встроенный плеер должен быть внешним HTTPS-ресурсом, а не страницей сайта.
    if (url.origin === window.location.origin) return '';
    return url.href;
  } catch (_) {
    return '';
  }
}

export function createSafePlayerIframe(rawContent, title = 'Видеоплеер') {
  const src = getPlayerEmbedUrl(rawContent);
  if (!src) return null;

  const iframe = document.createElement('iframe');
  iframe.src = src;
  iframe.title = String(title || 'Видеоплеер');
  iframe.loading = 'lazy';
  iframe.referrerPolicy = 'strict-origin-when-cross-origin';
  iframe.allow = 'autoplay; fullscreen; picture-in-picture; encrypted-media';
  iframe.allowFullscreen = true;
  iframe.setAttribute('sandbox', 'allow-scripts allow-same-origin allow-presentation allow-forms');
  return iframe;
}

export function buildHuggingFaceVideoUrl(fileName) {
  if (typeof fileName !== 'string' || !fileName.trim()) return '';
  const parts = fileName.trim().replace(/\\/g, '/').split('/');
  if (parts.some((part) => !part || part === '.' || part === '..' || /[?#\\\u0000-\u001f]/.test(part))) return '';
  const encodedPath = parts.map((part) => encodeURIComponent(part)).join('/');
  return `https://huggingface.co/datasets/letovvkun/op_archive/resolve/main/${encodedPath}?download=true`;
}

export function toTimestampMillis(value) {
  if (value && typeof value.toDate === 'function') {
    try {
      const date = value.toDate();
      return Number.isFinite(date?.getTime?.()) ? date.getTime() : 0;
    } catch (_) {
      return 0;
    }
  }
  if (value && Number.isFinite(value.seconds)) {
    return value.seconds * 1000 + (Number(value.nanoseconds) || 0) / 1e6;
  }
  const parsed = value ? new Date(value).getTime() : 0;
  return Number.isFinite(parsed) ? parsed : 0;
}

const CACHE_VERSION = 2;

/**
 * Возвращает запись кэша вместе с признаком наличия.
 * Это позволяет кэшировать валидные null-результаты (например, отсутствующий тайтл),
 * не путая их с отсутствующей или просроченной записью.
 */
export function readSessionCacheEntry(key, ttlMs = 5 * 60 * 1000) {
  try {
    const raw = readStorage(key, 'sessionStorage');
    if (!raw) return null;

    const record = JSON.parse(raw);
    const hasValidShape = record
      && record.version === CACHE_VERSION
      && Number.isFinite(record.savedAt)
      && Object.prototype.hasOwnProperty.call(record, 'data');

    if (!hasValidShape) {
      removeStorage(key, 'sessionStorage');
      return null;
    }

    const age = Date.now() - record.savedAt;
    if (!Number.isFinite(ttlMs) || ttlMs < 0 || age < 0 || age > ttlMs) {
      removeStorage(key, 'sessionStorage');
      return null;
    }

    return { data: record.data, savedAt: record.savedAt };
  } catch (_) {
    // Повреждённый JSON или недоступное хранилище не должны ломать страницу.
    removeStorage(key, 'sessionStorage');
    return null;
  }
}

/** Совместимый helper: возвращает сами данные или null при отсутствии записи. */
export function readSessionCache(key, ttlMs = 5 * 60 * 1000) {
  return readSessionCacheEntry(key, ttlMs)?.data ?? null;
}

export function writeSessionCache(key, data) {
  try {
    return writeStorage(key, JSON.stringify({
      version: CACHE_VERSION,
      savedAt: Date.now(),
      data
    }), 'sessionStorage');
  } catch (_) {
    // Кэш необязателен: переполнение/ограничения хранилища не должны ломать сайт.
    return false;
  }
}

export function removeSessionCache(key) {
  return removeStorage(key, 'sessionStorage');
}

