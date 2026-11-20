/**
 * Минимальный клиент Firestore REST API для сборки сайта.
 * Читает только публичные данные (те же, что сайт читает из браузера) и превращает
 * типизированные значения REST в обычные JS-объекты. Timestamp становится ISO-строкой,
 * которую понимает toTimestampMillis() на клиенте.
 */

const BASE_URL = 'https://firestore.googleapis.com/v1';

export function decodeValue(value) {
  if (!value || typeof value !== 'object') return null;
  if ('nullValue' in value) return null;
  if ('booleanValue' in value) return Boolean(value.booleanValue);
  if ('integerValue' in value) return Number(value.integerValue);
  if ('doubleValue' in value) return Number(value.doubleValue);
  if ('timestampValue' in value) return String(value.timestampValue);
  if ('stringValue' in value) return String(value.stringValue);
  if ('referenceValue' in value) return String(value.referenceValue);
  if ('bytesValue' in value) return String(value.bytesValue);
  if ('geoPointValue' in value) {
    return { latitude: Number(value.geoPointValue.latitude) || 0, longitude: Number(value.geoPointValue.longitude) || 0 };
  }
  if ('arrayValue' in value) return (value.arrayValue.values || []).map(decodeValue);
  if ('mapValue' in value) return decodeFields(value.mapValue.fields);
  return null;
}

export function decodeFields(fields = {}) {
  const result = {};
  for (const [key, value] of Object.entries(fields)) result[key] = decodeValue(value);
  return result;
}

/** Документ REST -> { ...поля, [idField]: идентификатор документа }. */
export function decodeDocument(document, idField = 'id') {
  const id = String(document?.name || '').split('/').pop();
  const data = decodeFields(document?.fields);
  return { data, id, withId: { ...data, [idField]: id } };
}

async function requestJson(fetchImpl, url) {
  const response = await fetchImpl(url, { headers: { accept: 'application/json' } });
  if (!response.ok) {
    throw new Error(`Firestore REST ${response.status} для ${url.split('?')[0]}`);
  }
  return response.json();
}

function buildUrl(project, path, params) {
  const query = new URLSearchParams(params);
  return `${BASE_URL}/projects/${encodeURIComponent(project)}/databases/(default)/documents/${path}?${query}`;
}

/** Читает всю коллекцию постранично. Возвращает массив сырых REST-документов. */
export async function fetchCollection({ fetchImpl = fetch, project, apiKey, collection, pageSize = 300, maxPages = 50 }) {
  const documents = [];
  let pageToken = '';

  for (let page = 0; page < maxPages; page += 1) {
    const params = { pageSize: String(pageSize), key: apiKey };
    if (pageToken) params.pageToken = pageToken;
    const body = await requestJson(fetchImpl, buildUrl(project, collection, params));
    documents.push(...(body.documents || []));
    if (!body.nextPageToken) return documents;
    pageToken = body.nextPageToken;
  }

  throw new Error(`Коллекция ${collection} превысила ${maxPages} страниц`);
}

/** Читает один документ или возвращает null, если его нет. */
export async function fetchDocument({ fetchImpl = fetch, project, apiKey, path }) {
  const response = await fetchImpl(buildUrl(project, path, { key: apiKey }), { headers: { accept: 'application/json' } });
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(`Firestore REST ${response.status} для ${path}`);
  return response.json();
}
