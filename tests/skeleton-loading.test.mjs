import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  clearSkeletonState,
  createCatalogGridSkeleton,
  createDescriptionSkeleton,
  createEpisodeGridSkeleton,
  createFilterSkeleton,
  createTextSkeleton,
  createTitleSearchSkeleton,
  createTrackerTableSkeleton,
  setSkeletonContent
} from '../js/core/skeletons.js';

const read = (path) => readFileSync(path, 'utf8');

class FakeElement {
  constructor() { this.attributes = new Map(); this.innerHTML = ''; }
  setAttribute(name, value) { this.attributes.set(name, value); }
  removeAttribute(name) { this.attributes.delete(name); }
  getAttribute(name) { return this.attributes.get(name) ?? null; }
}

test('shared skeleton state marks regions busy and clears the state after content is ready', () => {
  const element = new FakeElement();
  assert.equal(setSkeletonContent(element, '<span class="skeleton-loader"></span>'), true);
  assert.equal(element.getAttribute('aria-busy'), 'true');
  assert.match(element.innerHTML, /skeleton-loader/);
  clearSkeletonState(element);
  assert.equal(element.getAttribute('aria-busy'), null);
  assert.equal(setSkeletonContent(null, 'ignored'), false);
  assert.doesNotThrow(() => clearSkeletonState(null));
});

test('all shared skeleton templates produce bounded, semantic placeholders', () => {
  assert.equal((createEpisodeGridSkeleton(5).match(/class="ep ep-skeleton"/g) || []).length, 5);
  assert.equal((createCatalogGridSkeleton(4).match(/catalog-card-skeleton/g) || []).length, 4);
  assert.equal((createTitleSearchSkeleton(3).match(/title-search-skeleton"/g) || []).length, 3);
  assert.equal((createFilterSkeleton(4).match(/skeleton-line--filter/g) || []).length, 4);
  assert.equal((createTrackerTableSkeleton(4).match(/tracker-skeleton-row/g) || []).length, 4);
  assert.match(createTextSkeleton(), /aria-hidden="true"/);
  assert.match(createDescriptionSkeleton(), /skeleton-line--description-wide/);
  assert.ok(createEpisodeGridSkeleton(100).match(/class="ep ep-skeleton"/g).length <= 24);
  assert.ok(createFilterSkeleton(0).match(/skeleton-line--filter/g).length === 1);
});

test('all asynchronous data regions use skeletons instead of visible loading copy', () => {
  const expected = {
    'index.html': ['playerEmbed', 'playerTitle', 'episodesGrid', 'countdown'],
    'title.html': ['headerTitleName', 'playerEmbed', 'playerTitle', 'sidebarTitleName', 'titleGenresInfo', 'titleVoiceInfo', 'titleDescInfo', 'episodesGrid'],
    'catalog.html': ['catalogGrid', 'genresContainer', 'voiceContainer'],
    'tracker.html': ['trackerTableBody'],
    'info.html': ['view-ep-num', 'view-translation', 'view-dub-max', 'view-dub-shiyori', 'view-mixing', 'view-upload', 'view-updated']
  };

  for (const [page, ids] of Object.entries(expected)) {
    const html = read(page);
    for (const id of ids) {
      const index = html.indexOf(`id="${id}"`);
      assert.notEqual(index, -1, `${page} is missing ${id}`);
      const fragment = html.slice(index, html.indexOf('>', index) + 1);
      assert.match(fragment, /aria-busy="true"/, `${page}#${id} should expose its loading state`);
    }
  }

  assert.doesNotMatch(read('catalog.html'), /Загрузка каталога|Загрузка фильтров/);
  assert.doesNotMatch(read('tracker.html'), /Загрузка раздач/);
  assert.doesNotMatch(read('title.html'), /Загрузка\.\.\.|Загрузка видео|Загрузка описания/);
});

test('dynamic loading components clear busy states on success and failure', () => {
  const main = read('js/pages/main.js');
  const title = read('js/pages/title.js');
  const catalog = read('js/pages/catalog.js');
  const tracker = read('js/pages/tracker.js');
  const info = read('js/pages/info.js');
  const search = read('js/components/quick-title-search.js');
  const player = read('js/services/episode-player.js');
  const chat = read('js/components/lazy-giscus.js');

  for (const [name, source] of Object.entries({ main, title, catalog, tracker, info, search })) {
    assert.match(source, /setSkeletonContent/, `${name} should show a skeleton while loading`);
    assert.match(source, /clearSkeletonState/, `${name} should clear the loading state after resolution`);
  }
  assert.match(catalog, /clearSkeletonState\(catalogGrid\)/, 'catalog grid must leave its busy state after data arrives');
  assert.match(player, /player-source-skeleton/);
  assert.match(player, /showNoSources/);
  assert.match(player, /iframe.addEventListener\?\.\('load'/, 'iframe skeleton should clear on load');
  assert.match(player, /player-loading-overlay/);
  assert.match(chat, /chat-loading-skeleton/);
  assert.match(chat, /finishLoading/);
  assert.match(chat, /12000/);
});

test('video player skeleton appears only during real buffering and clears on playback', async () => {
  const originalDocument = globalThis.document;
  const originalPlyr = globalThis.Plyr;

  class FakeElement {
    constructor(tagName) {
      this.tagName = tagName;
      this.children = [];
      this.dataset = {};
      this.attributes = new Map();
      this.listeners = new Map();
      this.style = {};
      this.hidden = false;
    }
    appendChild(child) { this.children.push(child); return child; }
    replaceChildren(...children) { this.children = children; }
    setAttribute(name, value) { this.attributes.set(name, value); }
    removeAttribute(name) { this.attributes.delete(name); }
    addEventListener(name, callback) { this.listeners.set(name, callback); }
    dispatch(name) { this.listeners.get(name)?.(); }
  }

  globalThis.document = { createElement: (tagName) => new FakeElement(tagName) };
  globalThis.Plyr = class {};

  try {
    const { createEpisodePlayerController } = await import('../js/services/episode-player.js');
    const container = new FakeElement('div');
    const controller = createEpisodePlayerController({ container });
    controller.render({ title: 'Тестовая серия', players: { hf: 'test.mp4' } });

    const [video, overlay] = container.children;
    assert.equal(video.tagName, 'video');
    assert.equal(overlay.className, 'player-loading-overlay');
    assert.equal(overlay.hidden, true, 'preload=none must not show loading before playback');

    video.dispatch('waiting');
    assert.equal(overlay.hidden, false);
    assert.equal(container.attributes.get('aria-busy'), 'true');

    video.dispatch('playing');
    assert.equal(overlay.hidden, true);
    assert.equal(container.attributes.has('aria-busy'), false);
    controller.destroy();
  } finally {
    if (originalDocument === undefined) delete globalThis.document;
    else globalThis.document = originalDocument;
    if (originalPlyr === undefined) delete globalThis.Plyr;
    else globalThis.Plyr = originalPlyr;
  }
});
