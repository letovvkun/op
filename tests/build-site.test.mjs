import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { decodeDocument, decodeValue, fetchCollection, fetchDocument } from '../scripts/lib/firestore-rest.mjs';
import {
  addAssetVersion, buildTitleStructuredData, isGeneratableTitle, renderSitemap, renderTitlePage, toJsonLd
} from '../scripts/lib/site-pages.mjs';
import { buildSite, fetchSiteData } from '../scripts/build-site.mjs';

const silent = { log() {}, warn() {} };
const jsonResponse = (body, status = 200) => ({ ok: status >= 200 && status < 300, status, json: async () => body });

test('Firestore REST values are decoded into plain JavaScript values', () => {
  assert.equal(decodeValue({ stringValue: 'a' }), 'a');
  assert.equal(decodeValue({ integerValue: '1123' }), 1123);
  assert.equal(decodeValue({ doubleValue: 1.5 }), 1.5);
  assert.equal(decodeValue({ booleanValue: true }), true);
  assert.equal(decodeValue({ nullValue: null }), null);
  assert.equal(decodeValue({ timestampValue: '2026-01-01T00:00:00Z' }), '2026-01-01T00:00:00Z');
  assert.deepEqual(decodeValue({ arrayValue: { values: [{ integerValue: '1' }, { stringValue: 'x' }] } }), [1, 'x']);
  assert.deepEqual(decodeValue({ arrayValue: {} }), []);
  assert.deepEqual(decodeValue({ mapValue: { fields: { hf: { stringValue: 'f.mp4' } } } }), { hf: 'f.mp4' });

  const { data, id, withId } = decodeDocument({
    name: 'projects/p/databases/(default)/documents/episodes/abc123',
    fields: { id: { integerValue: '5' }, title: { stringValue: 'T' } }
  }, 'firestoreId');
  assert.equal(id, 'abc123');
  assert.deepEqual(data, { id: 5, title: 'T' });
  assert.deepEqual(withId, { id: 5, title: 'T', firestoreId: 'abc123' });
});

test('fetchCollection follows page tokens and fetchDocument returns null for a missing document', async () => {
  const urls = [];
  const pages = [
    { documents: [{ name: 'x/1' }], nextPageToken: 'next' },
    { documents: [{ name: 'x/2' }] }
  ];
  const documents = await fetchCollection({
    project: 'p', apiKey: 'k', collection: 'episodes',
    fetchImpl: async (url) => { urls.push(url); return jsonResponse(pages.shift()); }
  });
  assert.equal(documents.length, 2);
  assert.match(urls[0], /\/projects\/p\/databases\/\(default\)\/documents\/episodes\?pageSize=300&key=k$/);
  assert.match(urls[1], /pageToken=next/);

  assert.deepEqual(await fetchCollection({ project: 'p', apiKey: 'k', collection: 'empty', fetchImpl: async () => jsonResponse({}) }), []);
  await assert.rejects(fetchCollection({ project: 'p', apiKey: 'k', collection: 'x', fetchImpl: async () => jsonResponse({}, 403) }), /403/);
  assert.equal(await fetchDocument({ project: 'p', apiKey: 'k', path: 'settings/log_pose', fetchImpl: async () => jsonResponse({}, 404) }), null);
});

test('title pages get their own metadata, a <base> and safe JSON-LD', () => {
  const template = readFileSync('title.html', 'utf8');
  const title = {
    id: 'bleach', name: 'Блич "Тысячелетняя кровавая война"', genres: 'Экшен, Фэнтези',
    desc: 'Описание </script><script>alert(1)</script>', poster: 'https://example.com/p.webp', updatedAt: '2026-05-06T00:00:00Z'
  };
  const html = renderTitlePage(template, title);

  assert.ok(html.indexOf('<base href="/">') < html.indexOf('rel="stylesheet" href="css/style.css"'), '<base> must precede relative links');
  assert.match(html, /<title>Блич &quot;Тысячелетняя кровавая война&quot; \| Макс Летов &amp; ShiYori<\/title>/);
  assert.match(html, /<meta name="title-id" content="bleach">/);
  assert.match(html, /<link rel="canonical" href="https:\/\/letovshiyori\.org\/title\/bleach\/">/);
  assert.equal((html.match(/<meta name="description"/g) || []).length, 1, 'the template description must be replaced, not duplicated');
  assert.doesNotMatch(html, /<script>alert\(1\)<\/script>/);

  const jsonLd = html.match(/<script type="application\/ld\+json">(.*?)<\/script>/s)[1];
  const parsed = JSON.parse(jsonLd);
  assert.equal(parsed['@type'], 'TVSeries');
  assert.deepEqual(parsed.genre, ['Экшен', 'Фэнтези']);
  assert.equal(parsed.image, 'https://example.com/p.webp');
  assert.equal(toJsonLd({ a: '</script>' }).includes('</script>'), false);
  assert.equal(buildTitleStructuredData({ id: 'x', name: 'X', poster: 'http://insecure/p.png' }).image, undefined);
});

test('only safe, non-main titles with a name get their own page', () => {
  assert.equal(isGeneratableTitle({ id: 'bleach', name: 'Bleach' }), true);
  assert.equal(isGeneratableTitle({ id: 'one_piece', name: 'One Piece' }), false);
  assert.equal(isGeneratableTitle({ id: '../evil', name: 'X' }), false);
  assert.equal(isGeneratableTitle({ id: 'ok', name: '  ' }), false);
  assert.equal(isGeneratableTitle(null), false);
});

test('sitemap lists static pages and generated title pages with lastmod', () => {
  const xml = renderSitemap({
    pages: ['', 'catalog.html'],
    titles: [{ id: 'bleach', name: 'Bleach', updatedAt: '2026-05-06T10:00:00Z' }, { id: 'naruto', name: 'Naruto' }, { id: 'one_piece', name: 'OP' }],
    buildDate: '2026-11-20'
  });
  assert.match(xml, /<loc>https:\/\/letovshiyori\.org\/<\/loc><lastmod>2026-11-20<\/lastmod>/);
  assert.match(xml, /<loc>https:\/\/letovshiyori\.org\/title\/bleach\/<\/loc><lastmod>2026-05-06<\/lastmod>/);
  assert.match(xml, /title\/naruto\/<\/loc><lastmod>2026-11-20<\/lastmod>/);
  assert.doesNotMatch(xml, /one_piece/);
});

test('asset versioning touches stylesheets and entry scripts but not modulepreload links', () => {
  const html = [
    '<link rel="stylesheet" href="css/style.css">',
    '<link rel="modulepreload" href="js/core/ui.js">',
    '<link rel="icon" href="favicon.svg">',
    '<script type="module" src="js/pages/main.js"></script>',
    '<script src="https://cdn.example.com/x.js"></script>',
    '<img src="img/no-poster.svg">'
  ].join('\n');
  const result = addAssetVersion(html, 'abc');
  assert.match(result, /href="css\/style\.css\?v=abc"/);
  assert.match(result, /src="js\/pages\/main\.js\?v=abc"/);
  assert.match(result, /rel="modulepreload" href="js\/core\/ui\.js">/);
  assert.match(result, /src="https:\/\/cdn\.example\.com\/x\.js"/);
  assert.match(result, /<img src="img\/no-poster\.svg">/);
});

function fakeFirestore({ failCollections = [] } = {}) {
  const documents = {
    episodes: [
      { name: 'p/documents/episodes/e1', fields: { id: { integerValue: '1' }, title: { stringValue: 'One' }, players: { mapValue: { fields: { hf: { stringValue: '1.mp4' } } } } } },
      { name: 'p/documents/episodes/e2', fields: { id: { integerValue: '2' }, title: { stringValue: 'Draft' }, status: { stringValue: 'draft' } } },
      { name: 'p/documents/episodes/e3', fields: { id: { integerValue: '3' }, title: { stringValue: 'Soon' }, status: { stringValue: 'scheduled' }, publishAt: { timestampValue: '2099-01-01T00:00:00Z' } } }
    ],
    titles: [
      { name: 'p/documents/titles/bleach', fields: { name: { stringValue: 'Bleach' }, desc: { stringValue: 'Anime' }, updatedAt: { timestampValue: '2026-05-06T00:00:00Z' } } },
      { name: 'p/documents/titles/one_piece', fields: { name: { stringValue: 'One Piece' } } }
    ],
    torrent_packs: [{ name: 'p/documents/torrent_packs/pk', fields: { title: { stringValue: 'Pack' }, magnet: { stringValue: 'magnet:?xt=urn:btih:' + 'a'.repeat(40) } } }]
  };
  return async (url) => {
    const match = String(url).match(/documents\/([a-z_]+)(?:\/([a-z_]+))?\?/);
    if (match[1] === 'settings') return jsonResponse({ name: 'p/documents/settings/log_pose', fields: { dayOfWeek: { integerValue: '0' }, time: { stringValue: '23:00' } } });
    if (failCollections.includes(match[1])) return jsonResponse({ error: 'denied' }, 403);
    return jsonResponse({ documents: documents[match[1]] || [] });
  };
}

test('fetchSiteData drops drafts, keeps scheduled episodes and skips a collection that fails', async () => {
  const data = await fetchSiteData({ fetchImpl: fakeFirestore({ failCollections: ['torrent_packs'] }), log: silent });
  assert.deepEqual(data.episodes.map((episode) => episode.firestoreId), ['e1', 'e3']);
  assert.deepEqual(data.episodes[0].players, { hf: '1.mp4' });
  assert.equal(data.titles.find((title) => title.id === 'bleach').name, 'Bleach');
  assert.deepEqual(data.settings, { log_pose: { dayOfWeek: 0, time: '23:00' } });
  assert.equal('torrent_packs' in data, false);
});

test('buildSite writes data snapshots, title pages, a sitemap and versioned assets', async () => {
  const out = mkdtempSync(join(tmpdir(), 'site-build-'));
  try {
    const now = new Date('2026-11-20T12:00:00Z');
    const result = await buildSite({ root: resolve('.'), out, fetchImpl: fakeFirestore(), now, log: silent });

    const episodes = JSON.parse(readFileSync(join(out, 'data/episodes.json'), 'utf8'));
    assert.equal(episodes.version, 1);
    assert.equal(episodes.generatedAt, now.toISOString());
    assert.equal(episodes.data.length, 2);
    for (const name of ['titles', 'torrent_packs', 'settings']) assert.ok(existsSync(join(out, 'data', `${name}.json`)), `${name}.json`);

    const titlePage = readFileSync(join(out, 'title/bleach/index.html'), 'utf8');
    assert.match(titlePage, /<meta name="title-id" content="bleach">/);
    assert.equal(existsSync(join(out, 'title/one_piece/index.html')), false);

    const sitemap = readFileSync(join(out, 'sitemap.xml'), 'utf8');
    assert.match(sitemap, /title\/bleach\//);

    const index = readFileSync(join(out, 'index.html'), 'utf8');
    assert.match(index, new RegExp(`css/style\\.css\\?v=${result.version}`));
    assert.match(index, new RegExp(`js/pages/main\\.js\\?v=${result.version}`));
    assert.ok(existsSync(join(out, 'favicon.svg')));
    assert.ok(existsSync(join(out, 'img/no-poster.svg')));
    assert.ok(existsSync(join(out, 'CNAME')));
  } finally {
    rmSync(out, { recursive: true, force: true });
  }
});

test('buildSite still produces a working site when Firestore is unreachable', async () => {
  const out = mkdtempSync(join(tmpdir(), 'site-build-'));
  try {
    await buildSite({ root: resolve('.'), out, fetchImpl: async () => { throw new Error('network down'); }, log: silent });
    assert.equal(existsSync(join(out, 'data/episodes.json')), false);
    assert.ok(existsSync(join(out, 'index.html')));
    // Без данных остаётся sitemap из репозитория.
    assert.match(readFileSync(join(out, 'sitemap.xml'), 'utf8'), /letovshiyori\.org/);
  } finally {
    rmSync(out, { recursive: true, force: true });
  }
});
