import test from 'node:test';
import assert from 'node:assert/strict';
import {
  STATIC_DATA_MAX_AGE_MS,
  StaticDataUnavailableError,
  loadStaticData,
  tryLoadStaticData,
  unwrapStaticPayload
} from '../js/core/static-data.js';
import { selectMainEpisodes, loadMainEpisodes, loadTitleEpisodes, loadTitleRecord } from '../js/services/episode-data.js';
import { loadSiteSetting } from '../js/services/site-settings.js';
import { loadTitles } from '../js/services/titles.js';
import { buildTrackerEntries, loadTrackerEntries } from '../js/services/tracker-data.js';

const NOW = Date.parse('2026-11-20T12:00:00Z');
const snapshot = (data, generatedAt = '2026-11-20T11:30:00Z') => ({ version: 1, generatedAt, data });
const okResponse = (body) => ({ ok: true, status: 200, json: async () => body });

function withFetch(handler, callback) {
  const original = globalThis.fetch;
  globalThis.fetch = handler;
  return Promise.resolve(callback()).finally(() => { globalThis.fetch = original; });
}

test('static payload is accepted only with the right version, a valid date and a fresh timestamp', () => {
  assert.deepEqual(unwrapStaticPayload(snapshot([1]), { now: NOW }), [1]);
  assert.throws(() => unwrapStaticPayload(null, { now: NOW }), StaticDataUnavailableError);
  assert.throws(() => unwrapStaticPayload({ version: 2, generatedAt: '2026-11-20T11:30:00Z', data: [] }, { now: NOW }), /формат/);
  assert.throws(() => unwrapStaticPayload({ version: 1, data: [] }, { now: NOW }), /даты/);
  assert.throws(() => unwrapStaticPayload(snapshot([], '2026-11-20T11:30:00Z'), { now: NOW + STATIC_DATA_MAX_AGE_MS + 60_000 }), /устарел/);
});

test('loadStaticData reads data/<name>.json and reports every failure as StaticDataUnavailableError', async () => {
  const urls = [];
  const data = await loadStaticData('episodes', {
    now: NOW,
    fetchImpl: async (url) => { urls.push(url); return okResponse(snapshot([{ id: 1 }])); }
  });
  assert.deepEqual(data, [{ id: 1 }]);
  assert.deepEqual(urls, ['data/episodes.json']);

  await assert.rejects(loadStaticData('episodes', { now: NOW, fetchImpl: async () => ({ ok: false, status: 404 }) }), StaticDataUnavailableError);
  await assert.rejects(loadStaticData('episodes', { now: NOW, fetchImpl: async () => { throw new TypeError('offline'); } }), StaticDataUnavailableError);
  await assert.rejects(loadStaticData('episodes', { now: NOW, fetchImpl: async () => okResponse('<html>') }), StaticDataUnavailableError);
  await assert.rejects(loadStaticData('../secret', { now: NOW, fetchImpl: async () => okResponse({}) }), TypeError);
});

test('tryLoadStaticData returns null instead of throwing and honours the validator', async () => {
  const good = { now: NOW, fetchImpl: async () => okResponse(snapshot([1, 2])) };
  assert.deepEqual(await tryLoadStaticData('episodes', Array.isArray, good), [1, 2]);
  assert.equal(await tryLoadStaticData('episodes', (value) => !Array.isArray(value), good), null);
  assert.equal(await tryLoadStaticData('episodes', Array.isArray, { fetchImpl: async () => { throw new Error('x'); } }), null);
});

test('selectMainEpisodes keeps the main title, sorts by number descending and applies the limit', () => {
  const episodes = [
    { id: 2, firestoreId: 'a' },
    { id: 10, firestoreId: 'b', titleId: 'one_piece' },
    { id: 5, firestoreId: 'c', titleId: 'other' },
    { id: 9, firestoreId: 'd' }
  ];
  assert.deepEqual(selectMainEpisodes(episodes).map((episode) => episode.firestoreId), ['b', 'd', 'a']);
  assert.deepEqual(selectMainEpisodes(episodes, 2).map((episode) => episode.firestoreId), ['b', 'd']);
});

test('episode, title and settings services use the static snapshot and never touch Firestore when it is fresh', async () => {
  const fresh = (data) => snapshot(data, new Date().toISOString());
  const files = {
    'data/episodes.json': fresh([
      { id: 1, firestoreId: 'm1' },
      { id: 7, firestoreId: 't7', titleId: 'bleach' },
      { id: 8, firestoreId: 't8', titleId: 'bleach' }
    ]),
    'data/titles.json': fresh([{ id: 'bleach', name: 'Bleach' }]),
    'data/settings.json': fresh({ log_pose: { dayOfWeek: 0, time: '23:00' } }),
    'data/torrent_packs.json': fresh([{ id: 'p1', title: 'Pack', magnet: 'magnet:?xt=urn:btih:' + 'a'.repeat(40), createdAt: '2026-01-02T00:00:00Z' }])
  };
  const requested = [];

  await withFetch(async (url) => {
    requested.push(url);
    return files[url] ? okResponse(files[url]) : { ok: false, status: 404 };
  }, async () => {
    assert.deepEqual((await loadMainEpisodes({ forceRefresh: true })).map((episode) => episode.firestoreId), ['m1']);
    assert.deepEqual((await loadTitleEpisodes('bleach', { forceRefresh: true })).map((episode) => episode.firestoreId), ['t7', 't8']);
    assert.deepEqual(await loadTitleRecord('bleach', { forceRefresh: true }), { id: 'bleach', name: 'Bleach' });
    assert.deepEqual((await loadTitles({ forceRefresh: true })).map((title) => title.id), ['bleach']);
    assert.deepEqual(await loadSiteSetting('log_pose'), { dayOfWeek: 0, time: '23:00' });

    const tracker = await loadTrackerEntries({ forceRefresh: true });
    assert.deepEqual(tracker.map((entry) => [entry.type, entry.id, entry.dateStr]), [['pack', 'p1', '2026-01-02']]);
  });

  assert.ok(requested.length >= 5);
  assert.ok(requested.every((url) => url.startsWith('data/')), 'only static snapshots should be requested');
});

test('when the snapshot is missing the services fall back to Firestore instead of returning empty data', async () => {
  // В Node нет доступа к gstatic.com, поэтому попытка обратиться к Firestore завершается ошибкой.
  // Важно, что сервис её пытается сделать, а не молча возвращает пустой список.
  await withFetch(async () => ({ ok: false, status: 404 }), async () => {
    await assert.rejects(loadMainEpisodes({ forceRefresh: true }));
    await assert.rejects(loadTitles({ forceRefresh: true }));
    // Настройка, которой нет в снимке (release_status), всегда читается из Firestore.
    await assert.rejects(loadSiteSetting('release_status'));
  });
});

test('buildTrackerEntries skips rows without links and formats packs and episodes', () => {
  const entries = buildTrackerEntries(
    [{ id: 'p1', title: 'Pack', torrentUrl: 'https://example.com/a.torrent', createdAt: '2026-03-04T10:00:00Z' }, { id: 'p2', title: 'Empty' }],
    [{ id: 12, title: 'Name', date: '2026-03-05', magnet: 'magnet:?xt=urn:btih:' + 'b'.repeat(40) }, { id: 13, title: 'No links' }]
  );
  assert.equal(entries.length, 2);
  assert.deepEqual(entries[0], { id: 'p1', type: 'pack', title: 'Pack', dateStr: '2026-03-04', timestamp: Date.parse('2026-03-04T10:00:00Z'), magnet: undefined, torrentUrl: 'https://example.com/a.torrent' });
  assert.equal(entries[1].title, 'Серия 12 — Name [1080p]');
  assert.equal(entries[1].type, 'episode');
});
