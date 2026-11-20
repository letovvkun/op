#!/usr/bin/env node
/**
 * Сборка сайта для GitHub Pages: node scripts/build-site.mjs [--out _site] [--skip-data]
 *
 *  1. копирует публичные файлы в _site;
 *  2. забирает данные из Firestore (REST) и сохраняет их как data/*.json;
 *  3. создаёт статические страницы тайтлов /title/<id>/ и sitemap.xml;
 *  4. добавляет ?v=<хеш> к css/js в HTML.
 *
 * Если Firestore недоступен, сборка не падает: сайт публикуется без data/*.json,
 * а браузер сам читает данные из Firestore, как раньше.
 */
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { decodeDocument, fetchCollection, fetchDocument } from './lib/firestore-rest.mjs';
import { addAssetVersion, hashContents, isGeneratableTitle, renderSitemap, renderTitlePage, titlePath } from './lib/site-pages.mjs';

export const FIRESTORE_PROJECT = 'letovshiyori';
// Публичный веб-ключ Firebase (тот же, что в js/core/firebase.js); доступ ограничивают правила Firestore.
export const FIRESTORE_API_KEY = 'AIzaSyBE1AkNd3bPGPr3ZPUbtqNUd2WDCB2SHHw';
export const STATIC_DATA_VERSION = 1;

const PUBLIC_HTML = ['index.html', 'catalog.html', 'title.html', 'tracker.html', 'info.html', 'game.html', '404.html'];
const PUBLIC_FILES = ['CNAME', 'robots.txt', 'sitemap.xml', 'veo-veo.txt', 'favicon.svg'];
const PUBLIC_DIRS = ['css', 'js', 'img'];
const SITEMAP_PAGES = ['', 'catalog.html', 'info.html', 'tracker.html', 'game.html'];

const isDraft = (episode) => episode.status === 'draft' || episode.isDraft === true;

export function wrapSnapshot(data, now = new Date()) {
  return { version: STATIC_DATA_VERSION, generatedAt: now.toISOString(), data };
}

function collectFiles(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    return entry.isDirectory() ? collectFiles(path) : [path];
  });
}

function writeJson(path, value) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(value));
}

/** Скачивает коллекции и возвращает объект { episodes, titles, torrent_packs, settings } (что удалось). */
export async function fetchSiteData({ fetchImpl = fetch, project = FIRESTORE_PROJECT, apiKey = FIRESTORE_API_KEY, log = console } = {}) {
  const result = {};
  const options = { fetchImpl, project, apiKey };

  const tasks = {
    async episodes() {
      const docs = await fetchCollection({ ...options, collection: 'episodes' });
      return docs
        .map((document) => decodeDocument(document, 'firestoreId').withId)
        .filter((episode) => !isDraft(episode));
    },
    async titles() {
      const docs = await fetchCollection({ ...options, collection: 'titles' });
      return docs.map((document) => decodeDocument(document, 'id').withId);
    },
    async torrent_packs() {
      const docs = await fetchCollection({ ...options, collection: 'torrent_packs' });
      return docs.map((document) => decodeDocument(document, 'id').withId);
    },
    async settings() {
      const logPose = await fetchDocument({ ...options, path: 'settings/log_pose' });
      return logPose ? { log_pose: decodeDocument(logPose).data } : {};
    }
  };

  for (const [name, task] of Object.entries(tasks)) {
    try {
      result[name] = await task();
      log.log(`[data] ${name}: ${Array.isArray(result[name]) ? `${result[name].length} док.` : 'ok'}`);
    } catch (error) {
      log.warn(`[data] ${name}: пропущено (${error.message})`);
    }
  }
  return result;
}

export async function buildSite({
  root = resolve(dirname(fileURLToPath(import.meta.url)), '..'),
  out = '_site',
  skipData = false,
  fetchImpl = fetch,
  now = new Date(),
  log = console
} = {}) {
  const outDir = resolve(root, out);
  rmSync(outDir, { recursive: true, force: true });
  mkdirSync(outDir, { recursive: true });

  for (const file of [...PUBLIC_HTML, ...PUBLIC_FILES]) {
    if (existsSync(join(root, file))) cpSync(join(root, file), join(outDir, file));
  }
  for (const directory of PUBLIC_DIRS) {
    if (existsSync(join(root, directory))) cpSync(join(root, directory), join(outDir, directory), { recursive: true });
  }

  const version = hashContents(
    ['css', 'js'].flatMap((directory) => collectFiles(join(outDir, directory)).sort())
      .map((file) => readFileSync(file))
  );

  let data = {};
  if (skipData) {
    log.log('[data] пропущено (--skip-data)');
  } else {
    data = await fetchSiteData({ fetchImpl, log });
  }

  for (const [name, value] of Object.entries(data)) {
    writeJson(join(outDir, 'data', `${name}.json`), wrapSnapshot(value, now));
  }

  const buildDate = now.toISOString().slice(0, 10);
  const titles = Array.isArray(data.titles) ? data.titles : [];
  const generatedTitles = titles.filter(isGeneratableTitle);
  const template = readFileSync(join(root, 'title.html'), 'utf8');

  for (const title of generatedTitles) {
    const pageDirectory = join(outDir, titlePath(title.id));
    mkdirSync(pageDirectory, { recursive: true });
    writeFileSync(join(pageDirectory, 'index.html'), renderTitlePage(template, title));
  }
  log.log(`[pages] страниц тайтлов: ${generatedTitles.length}`);

  if (generatedTitles.length > 0) {
    writeFileSync(join(outDir, 'sitemap.xml'), renderSitemap({ pages: SITEMAP_PAGES, titles: generatedTitles, buildDate }));
  }

  for (const file of collectFiles(outDir).filter((path) => path.endsWith('.html'))) {
    writeFileSync(file, addAssetVersion(readFileSync(file, 'utf8'), version));
  }

  const size = collectFiles(outDir).reduce((sum, file) => sum + statSync(file).size, 0);
  log.log(`[build] готово: ${outDir} (${(size / 1024).toFixed(0)} КБ, версия ресурсов ${version})`);
  return { outDir, version, data, generatedTitles };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const outIndex = args.indexOf('--out');
  buildSite({
    out: outIndex !== -1 ? args[outIndex + 1] : '_site',
    skipData: args.includes('--skip-data')
  }).catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
