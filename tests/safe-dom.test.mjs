import test from 'node:test';
import assert from 'node:assert/strict';
import {
  escapeHTML,
  safeHttpsUrl,
  safeMagnetUrl,
  getPlayerEmbedUrl,
  buildHuggingFaceVideoUrl,
  toTimestampMillis,
  readSessionCache,
  writeSessionCache
} from '../js/core/safe-dom.js';
import { isEpisodePublic, isEpisodeDisplayable, loadWatchedEpisodes, saveWatchedEpisodes } from '../js/services/episodes.js';
import { createWatchedEpisodeManager } from '../js/components/watched-episodes.js';

globalThis.window = { location: { href: 'https://letovshiyori.org/catalog.html', origin: 'https://letovshiyori.org' } };

test('escapeHTML encodes HTML-sensitive characters', () => {
  assert.equal(escapeHTML(`<img src=x onerror="alert('x')">`), '&lt;img src=x onerror=&quot;alert(&#39;x&#39;)&quot;&gt;');
});

test('safeHttpsUrl accepts HTTPS and same-site relative paths only', () => {
  assert.equal(safeHttpsUrl('https://cdn.example/image.webp'), 'https://cdn.example/image.webp');
  assert.equal(safeHttpsUrl('/images/poster.webp'), 'https://letovshiyori.org/images/poster.webp');
  assert.equal(safeHttpsUrl('javascript:alert(1)'), '');
  assert.equal(safeHttpsUrl('http://cdn.example/image.webp'), '');
  assert.equal(safeHttpsUrl('data:text/html,hello'), '');
});

test('safeMagnetUrl requires a BitTorrent info hash', () => {
  const hash = '0123456789012345678901234567890123456789';
  assert.equal(safeMagnetUrl(`magnet:?xt=urn:btih:${hash}&dn=release`).startsWith('magnet:?xt=urn:btih:'), true);
  assert.equal(safeMagnetUrl('javascript:alert(1)'), '');
  assert.equal(safeMagnetUrl('magnet:?dn=missing-hash'), '');
});

test('player embed parser extracts only HTTPS iframe src and rejects same-site URLs', () => {
  globalThis.DOMParser = class {
    parseFromString() {
      return { querySelector: () => ({ getAttribute: () => 'https://player.example/embed/123' }) };
    }
  };
  assert.equal(getPlayerEmbedUrl('<iframe src="https://player.example/embed/123"></iframe><script>alert(1)</script>'), 'https://player.example/embed/123');
  assert.equal(getPlayerEmbedUrl('javascript:alert(1)'), '');
  assert.equal(getPlayerEmbedUrl('https://letovshiyori.org/'), '');
});

test('Hugging Face file paths are encoded and traversal is rejected', () => {
  assert.match(buildHuggingFaceVideoUrl('episode 1123.mp4'), /episode%201123\.mp4/);
  assert.equal(buildHuggingFaceVideoUrl('../secret.mp4'), '');
  assert.equal(buildHuggingFaceVideoUrl('file.mp4?download=false'), '');
});

test('toTimestampMillis supports ISO strings and Firestore timestamp-like objects', () => {
  assert.equal(toTimestampMillis({ seconds: 123, nanoseconds: 500000000 }), 123500);
  assert.equal(toTimestampMillis('1970-01-01T00:00:02.000Z'), 2000);
  assert.equal(toTimestampMillis(null), 0);
});

test('session cache is versioned and degrades safely when storage is unavailable', () => {
  const store = new Map();
  globalThis.sessionStorage = {
    getItem: key => store.get(key) ?? null,
    setItem: (key, value) => store.set(key, value),
    removeItem: key => store.delete(key)
  };
  writeSessionCache('unit-test', [1, 2, 3]);
  assert.deepEqual(readSessionCache('unit-test'), [1, 2, 3]);
  store.set('legacy-test', '[1,2,3]');
  assert.equal(readSessionCache('legacy-test'), null);
  globalThis.sessionStorage = { getItem() { throw new Error('blocked'); } };
  assert.equal(readSessionCache('blocked-test'), null);
});


test('isEpisodePublic handles draft and scheduled episodes safely in Array.filter', () => {
  const now = Date.now();
  const episodes = [
    { status: 'published', id: 1 },
    { status: 'draft', id: 2 },
    { status: 'scheduled', publishAt: new Date(now - 60_000).toISOString(), id: 3 },
    { status: 'scheduled', publishAt: new Date(now + 60_000).toISOString(), id: 4 },
    { status: 'scheduled', publishAt: null, id: 5 }
  ];

  assert.deepEqual(episodes.filter(isEpisodePublic).map(episode => episode.id), [1, 3]);
});

test('isEpisodeDisplayable applies publication and required-field checks in one predicate', () => {
  const base = { firestoreId: 'ep-1', id: 1, title: 'Episode 1', status: 'published' };
  assert.equal(isEpisodeDisplayable(base), true);
  assert.equal(isEpisodeDisplayable({ ...base, firestoreId: '' }), false);
  assert.equal(isEpisodeDisplayable({ ...base, title: '  ' }), false);
  assert.equal(isEpisodeDisplayable({ ...base, status: 'draft' }), false);
});

test('watched episode storage tolerates malformed or unavailable localStorage', () => {
  const store = new Map();
  globalThis.localStorage = {
    getItem: key => store.get(key) ?? null,
    setItem: (key, value) => store.set(key, value)
  };

  const watched = new Set(['ep-1', 'ep-2']);
  assert.equal(saveWatchedEpisodes(watched), true);
  assert.deepEqual([...loadWatchedEpisodes()], ['ep-1', 'ep-2']);

  store.set('watchedEpisodes', '{broken-json');
  assert.deepEqual([...loadWatchedEpisodes()], []);

  globalThis.localStorage = {
    getItem() { throw new Error('blocked'); },
    setItem() { throw new Error('blocked'); }
  };
  assert.deepEqual([...loadWatchedEpisodes()], []);
  assert.equal(saveWatchedEpisodes(watched), false);
});

test('watched episode manager updates saved state, bounty and the matching episode card', () => {
  const store = new Map();
  globalThis.localStorage = {
    getItem: key => store.get(key) ?? null,
    setItem: (key, value) => store.set(key, value)
  };

  const counter = { textContent: '' };
  const attributes = new Map();
  const classNames = new Set();
  const watchButton = {
    setAttribute: (name, value) => attributes.set(name, value)
  };
  const card = {
    dataset: { firestoreId: 'episode-7' },
    classList: {
      toggle: (name, enabled) => enabled ? classNames.add(name) : classNames.delete(name)
    },
    querySelector: () => watchButton
  };
  const grid = { querySelectorAll: () => [card] };
  globalThis.document = {
    getElementById: id => id === 'bountyAmount' ? counter : null
  };

  const manager = createWatchedEpisodeManager({ grid });
  manager.load();
  manager.mark('episode-7', true);

  assert.deepEqual([...manager.episodes], ['episode-7']);
  assert.equal(counter.textContent, '1,500,000');
  assert.equal(classNames.has('watched'), true);
  assert.equal(attributes.get('aria-pressed'), 'true');
  assert.deepEqual(JSON.parse(store.get('watchedEpisodes')), ['episode-7']);
});

test('cache entry API distinguishes a cached null result from a cache miss', async () => {
  const { readSessionCacheEntry } = await import('../js/core/safe-dom.js');
  const store = new Map();
  globalThis.sessionStorage = {
    getItem: key => store.get(key) ?? null,
    setItem: (key, value) => store.set(key, value),
    removeItem: key => store.delete(key)
  };

  writeSessionCache('null-cache-test', null);
  assert.deepEqual(readSessionCacheEntry('null-cache-test')?.data, null);
  assert.equal(readSessionCacheEntry('missing-cache-test'), null);

  store.set('broken-cache-test', '{broken');
  assert.equal(readSessionCacheEntry('broken-cache-test'), null);
  assert.equal(store.has('broken-cache-test'), false);
});
