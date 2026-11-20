/**
 * Загрузка статических снимков данных (data/*.json), которые собираются при деплое
 * скриптом scripts/build-site.mjs. Это избавляет посетителей от скачивания
 * Firebase SDK и от чтений Firestore: список серий приходит с того же хостинга,
 * что и сайт. Если снимка нет, он устарел или повреждён, вызывающий код
 * переключается на Firestore, так что сайт продолжает работать.
 */

export const STATIC_DATA_VERSION = 1;
// Если GitHub Actions по расписанию не работал дольше этого срока, снимку не доверяем.
export const STATIC_DATA_MAX_AGE_MS = 3 * 60 * 60 * 1000;
const STATIC_DATA_TIMEOUT_MS = 7000;

export class StaticDataUnavailableError extends Error {
  constructor(message, options) {
    super(message, options);
    this.name = 'StaticDataUnavailableError';
  }
}

/** Проверяет оболочку {version, generatedAt, data} и возвращает data. */
export function unwrapStaticPayload(payload, { now = Date.now(), maxAgeMs = STATIC_DATA_MAX_AGE_MS } = {}) {
  if (!payload || typeof payload !== 'object' || payload.version !== STATIC_DATA_VERSION || !('data' in payload)) {
    throw new StaticDataUnavailableError('Снимок данных имеет неизвестный формат.');
  }

  const generatedAt = new Date(payload.generatedAt).getTime();
  if (!Number.isFinite(generatedAt)) {
    throw new StaticDataUnavailableError('В снимке данных нет даты создания.');
  }

  const age = now - generatedAt;
  if (Number.isFinite(maxAgeMs) && age > maxAgeMs) {
    throw new StaticDataUnavailableError('Снимок данных устарел.');
  }

  return payload.data;
}

/**
 * Скачивает data/<name>.json. Бросает StaticDataUnavailableError при любой проблеме.
 * Параметры fetchImpl и now нужны для тестов.
 */
export async function loadStaticData(name, {
  fetchImpl = globalThis.fetch,
  now = Date.now(),
  maxAgeMs = STATIC_DATA_MAX_AGE_MS,
  timeoutMs = STATIC_DATA_TIMEOUT_MS
} = {}) {
  if (typeof name !== 'string' || !/^[a-z0-9_-]{1,60}$/i.test(name)) {
    throw new TypeError('Некорректное имя статического набора данных.');
  }
  if (typeof fetchImpl !== 'function') {
    throw new StaticDataUnavailableError('fetch недоступен.');
  }

  const controller = typeof AbortController === 'function' ? new AbortController() : null;
  const timer = controller ? setTimeout(() => controller.abort(), timeoutMs) : null;

  try {
    const response = await fetchImpl(`data/${name}.json`, controller ? { signal: controller.signal } : undefined);
    if (!response || !response.ok) {
      throw new StaticDataUnavailableError(`Снимок ${name} недоступен (${response?.status ?? 'нет ответа'}).`);
    }
    const payload = await response.json();
    return unwrapStaticPayload(payload, { now, maxAgeMs });
  } catch (error) {
    if (error instanceof StaticDataUnavailableError) throw error;
    throw new StaticDataUnavailableError(`Не удалось получить снимок ${name}.`, { cause: error });
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/** Возвращает данные снимка либо null, если снимок недоступен или не прошёл проверку. */
export async function tryLoadStaticData(name, validate = () => true, options = {}) {
  try {
    const data = await loadStaticData(name, options);
    return validate(data) ? data : null;
  } catch (_) {
    return null;
  }
}
