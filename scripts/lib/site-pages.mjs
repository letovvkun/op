/** Чистые функции для генерации страниц тайтлов, sitemap и версионирования ресурсов. */
import { createHash } from 'node:crypto';

export const SITE_ORIGIN = 'https://letovshiyori.org';
const TITLE_ID_PATTERN = /^[a-zA-Z0-9_-]{1,80}$/;
const MAIN_TITLE_ID = 'one_piece';

export function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (char) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  })[char]);
}

export function isGeneratableTitle(title) {
  return Boolean(title)
    && typeof title.id === 'string'
    && TITLE_ID_PATTERN.test(title.id)
    && title.id !== MAIN_TITLE_ID
    && typeof title.name === 'string'
    && title.name.trim().length > 0;
}

export function titlePath(id) {
  return `title/${id}/`;
}

function shorten(text, limit = 160) {
  const clean = String(text ?? '').replace(/\s+/g, ' ').trim();
  if (clean.length <= limit) return clean;
  return `${clean.slice(0, limit - 1).trimEnd()}…`;
}

function httpsOrEmpty(url) {
  try {
    const parsed = new URL(String(url));
    return parsed.protocol === 'https:' && !parsed.username && !parsed.password ? parsed.href : '';
  } catch (_) {
    return '';
  }
}

/** JSON для <script type="application/ld+json">: «<» экранируется, чтобы нельзя было закрыть тег. */
export function toJsonLd(object) {
  return JSON.stringify(object).replace(/</g, '\\u003c').replace(/\u2028|\u2029/g, '');
}

export function buildTitleStructuredData(title) {
  const url = `${SITE_ORIGIN}/${titlePath(title.id)}`;
  const data = {
    '@context': 'https://schema.org',
    '@type': 'TVSeries',
    name: title.name,
    url,
    inLanguage: 'ru'
  };
  if (title.desc) data.description = shorten(title.desc, 300);
  const poster = httpsOrEmpty(title.poster);
  if (poster) data.image = poster;
  if (typeof title.genres === 'string' && title.genres.trim()) {
    data.genre = title.genres.split(',').map((genre) => genre.trim()).filter(Boolean);
  }
  return data;
}

/**
 * Превращает title.html в готовую страницу конкретного тайтла:
 * <base href="/"> позволяет не менять относительные пути к css/js/ссылкам,
 * а мета-теги и JSON-LD видны поисковикам без выполнения JavaScript.
 */
export function renderTitlePage(template, title) {
  const name = String(title.name).trim();
  const pageTitle = `${name} | Макс Летов & ShiYori`;
  const description = shorten(title.desc, 160)
    || `Смотреть «${name}» в русской озвучке Макс Летов & ShiYori онлайн.`;
  const url = `${SITE_ORIGIN}/${titlePath(title.id)}`;
  const poster = httpsOrEmpty(title.poster);

  const headTags = [
    `<base href="/">`,
    `<meta name="title-id" content="${escapeHtml(title.id)}">`,
    `<meta name="description" content="${escapeHtml(description)}">`,
    `<link rel="canonical" href="${escapeHtml(url)}">`,
    `<meta property="og:type" content="video.tv_show">`,
    `<meta property="og:url" content="${escapeHtml(url)}">`,
    `<meta property="og:title" content="${escapeHtml(pageTitle)}">`,
    `<meta property="og:description" content="${escapeHtml(description)}">`,
    poster ? `<meta property="og:image" content="${escapeHtml(poster)}">` : '',
    `<meta name="twitter:card" content="summary_large_image">`,
    `<script type="application/ld+json">${toJsonLd(buildTitleStructuredData(title))}</script>`
  ].filter(Boolean).join('\n  ');

  let html = template;
  if (!/<title>[\s\S]*?<\/title>/.test(html) || !/<head>/.test(html)) {
    throw new Error('В шаблоне title.html нет <head> или <title>');
  }
  html = html.replace(/<title>[\s\S]*?<\/title>/, () => `<title>${escapeHtml(pageTitle)}</title>`);
  // Исходный description из шаблона (если есть) заменяется, дубликаты не нужны.
  html = html.replace(/\s*<meta name="description"[^>]*>/g, '');
  // <base> должен идти раньше любых относительных ссылок, поэтому теги ставим сразу после <head>.
  html = html.replace(/<head>/, () => `<head>\n  ${headTags}`);
  return html;
}

export function renderSitemap({ pages, titles, buildDate }) {
  const lastmodOf = (value) => {
    const time = new Date(value).getTime();
    return Number.isFinite(time) ? new Date(time).toISOString().slice(0, 10) : buildDate;
  };

  const entries = [
    ...pages.map((page) => ({ loc: `${SITE_ORIGIN}/${page}`, lastmod: buildDate })),
    ...titles.filter(isGeneratableTitle).map((title) => ({
      loc: `${SITE_ORIGIN}/${titlePath(title.id)}`,
      lastmod: lastmodOf(title.updatedAt)
    }))
  ];

  const body = entries
    .map((entry) => `  <url><loc>${escapeHtml(entry.loc)}</loc><lastmod>${entry.lastmod}</lastmod></url>`)
    .join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${body}\n</urlset>\n`;
}

/**
 * Добавляет ?v=<хеш> к подключаемым css и точкам входа js, чтобы браузеры не держали старые версии.
 * Ссылки <link rel="modulepreload"> не трогаем: внутренние модули импортируются без ?v,
 * и предзагрузка с другим адресом скачивала бы их дважды.
 */
export function addAssetVersion(html, version) {
  return html.replace(/<(script|link)\b[^>]*>/g, (tag, name) => {
    if (name === 'link' && !/\brel="stylesheet"/.test(tag)) return tag;
    const attribute = name === 'script' ? 'src' : 'href';
    return tag.replace(
      new RegExp(`(\\b${attribute}=")(/?(?:css|js)/[^"?#]+\\.(?:css|js))(")`),
      (_, start, path, end) => `${start}${path}?v=${version}${end}`
    );
  });
}

export function hashContents(chunks) {
  const hash = createHash('sha256');
  for (const chunk of chunks) hash.update(chunk);
  return hash.digest('hex').slice(0, 10);
}
