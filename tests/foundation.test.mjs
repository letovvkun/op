import test from 'node:test';
import assert from 'node:assert/strict';
import { loadCachedResource, invalidateCachedResource } from '../js/core/data-cache.js';
import { readStorage, writeStorage, removeStorage } from '../js/core/storage.js';
import { getDataErrorMessage } from '../js/core/errors.js';
import { createEpisodePlayerController } from '../js/services/episode-player.js';
import { toTimestampMillis } from '../js/core/safe-dom.js';

function createMemoryStorage() {
  const values = new Map();
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, String(value)),
    removeItem: (key) => values.delete(key),
    values
  };
}

test('safe storage helpers return fallbacks instead of throwing', () => {
  const originalLocalStorage = globalThis.localStorage;
  globalThis.localStorage = createMemoryStorage();

  assert.equal(writeStorage('theme', 'dark'), true);
  assert.equal(readStorage('theme'), 'dark');
  assert.equal(removeStorage('theme'), true);
  assert.equal(readStorage('theme', 'localStorage', 'fallback'), 'fallback');

  globalThis.localStorage = {
    getItem() { throw new Error('blocked'); },
    setItem() { throw new Error('blocked'); },
    removeItem() { throw new Error('blocked'); }
  };
  assert.equal(readStorage('theme', 'localStorage', 'safe'), 'safe');
  assert.equal(writeStorage('theme', 'dark'), false);
  assert.equal(removeStorage('theme'), false);

  if (originalLocalStorage === undefined) delete globalThis.localStorage;
  else globalThis.localStorage = originalLocalStorage;
});

test('cached loader coalesces concurrent requests and reuses the result', async () => {
  const originalSessionStorage = globalThis.sessionStorage;
  globalThis.sessionStorage = createMemoryStorage();
  invalidateCachedResource('test:single-flight');

  let calls = 0;
  let resolveLoader;
  const loader = () => {
    calls += 1;
    return new Promise((resolve) => { resolveLoader = resolve; });
  };

  const first = loadCachedResource('test:single-flight', loader, { validate: Array.isArray });
  const second = loadCachedResource('test:single-flight', loader, { validate: Array.isArray });
  await Promise.resolve();
  assert.equal(calls, 1);
  resolveLoader(['one', 'two']);

  assert.deepEqual(await first, ['one', 'two']);
  assert.deepEqual(await second, ['one', 'two']);
  assert.deepEqual(await loadCachedResource('test:single-flight', loader, { validate: Array.isArray }), ['one', 'two']);
  assert.equal(calls, 1);

  if (originalSessionStorage === undefined) delete globalThis.sessionStorage;
  else globalThis.sessionStorage = originalSessionStorage;
});

test('cache invalidation prevents an older pending request from overwriting fresh data', async () => {
  const originalSessionStorage = globalThis.sessionStorage;
  globalThis.sessionStorage = createMemoryStorage();
  invalidateCachedResource('test:invalidation');

  let resolveOld;
  const oldRequest = loadCachedResource('test:invalidation', () => new Promise((resolve) => {
    resolveOld = resolve;
  }));
  await Promise.resolve();

  invalidateCachedResource('test:invalidation');
  const freshRequest = loadCachedResource('test:invalidation', async () => 'fresh');
  resolveOld('stale');

  assert.equal(await oldRequest, 'stale');
  assert.equal(await freshRequest, 'fresh');
  assert.equal(await loadCachedResource('test:invalidation', async () => 'unexpected'), 'fresh');

  if (originalSessionStorage === undefined) delete globalThis.sessionStorage;
  else globalThis.sessionStorage = originalSessionStorage;
});

test('data errors are translated without exposing raw backend messages', () => {
  assert.match(getDataErrorMessage({ code: 'firestore/unavailable' }), /интернет/i);
  assert.match(getDataErrorMessage({ code: 'permission-denied' }), /доступ/i);
  assert.equal(getDataErrorMessage(new Error('private details'), 'Обычная ошибка'), 'Обычная ошибка');
});

test('invalid Firestore timestamp conversion fails closed', () => {
  assert.equal(toTimestampMillis({ toDate() { throw new Error('bad timestamp'); } }), 0);
  assert.equal(toTimestampMillis({ seconds: 12, nanoseconds: 500000000 }), 12500);
});

test('shared player controller releases Plyr before replacing the active source', async () => {
  const originalDocument = globalThis.document;
  const originalPlyr = globalThis.Plyr;
  const originalLocalStorage = globalThis.localStorage;

  class FakeElement {
    constructor(tagName) {
      this.tagName = tagName;
      this.children = [];
      this.style = {};
    }
    appendChild(child) { this.children.push(child); return child; }
    replaceChildren(...children) { this.children = children; }
  }

  globalThis.document = { createElement: (tagName) => new FakeElement(tagName) };
  globalThis.localStorage = createMemoryStorage();
  let destroyed = 0;
  globalThis.Plyr = class {
    constructor(element) { this.element = element; }
    destroy() { destroyed += 1; }
  };

  const container = new FakeElement('div');
  const selector = new FakeElement('select');
  const controller = createEpisodePlayerController({ container, selector });

  const firstResult = controller.render({ title: 'Episode 1', players: { hf: 'episode-1.mp4' } });
  assert.equal(firstResult.selectedPlayer, 'hf');
  assert.equal(container.children[0].tagName, 'video');
  assert.equal(container.children[0].preload, 'none');
  await new Promise(resolve => setImmediate(resolve));

  controller.render({ title: 'Episode 2', players: { hf: 'episode-2.mp4' } });
  assert.equal(destroyed, 1);
  await new Promise(resolve => setImmediate(resolve));
  controller.destroy();
  assert.equal(destroyed, 2);

  if (originalDocument === undefined) delete globalThis.document;
  else globalThis.document = originalDocument;
  if (originalPlyr === undefined) delete globalThis.Plyr;
  else globalThis.Plyr = originalPlyr;
  if (originalLocalStorage === undefined) delete globalThis.localStorage;
  else globalThis.localStorage = originalLocalStorage;
});


test('Giscus loads only on demand, is not duplicated, and can retry after a network error', async () => {
  const { createLazyGiscusLoader } = await import('../js/components/lazy-giscus.js');
  const scripts = [];

  class FakeScript {
    constructor() {
      this.dataset = {};
      this.listeners = new Map();
      this.removed = false;
    }
    addEventListener(type, callback) { this.listeners.set(type, callback); }
    remove() { this.removed = true; }
    dispatch(type) { this.listeners.get(type)?.(); }
  }

  const content = {
    children: [],
    appendChild(script) { this.children.push(script); return script; }
  };
  const documentRef = {
    createElement(tagName) {
      assert.equal(tagName, 'script');
      const script = new FakeScript();
      scripts.push(script);
      return script;
    }
  };

  const loadGiscus = createLazyGiscusLoader(content, documentRef);
  assert.equal(content.children.length, 0, 'the widget should not load before the user action');

  const first = loadGiscus();
  assert.equal(content.children.length, 1);
  assert.equal(first.src, 'https://giscus.app/client.js');
  assert.equal(first.async, true);
  assert.equal(first.crossOrigin, 'anonymous');
  assert.equal(first.dataset.repo, 'l3towm-byte/image');
  assert.equal(first.dataset.mapping, 'pathname');
  assert.equal(first.dataset.lang, 'ru');
  assert.equal(loadGiscus(), first, 'concurrent calls must reuse the in-flight script');
  assert.equal(content.children.length, 1);

  first.dispatch('error');
  assert.equal(first.removed, true);
  const second = loadGiscus();
  assert.notEqual(second, first, 'a failed download should be retryable');
  second.dispatch('load');
  assert.equal(loadGiscus(), second, 'a loaded script must not be injected again');
  assert.equal(content.children.length, 2);
});

test('cached loader stores null as a valid result instead of refetching it', async () => {
  const originalSessionStorage = globalThis.sessionStorage;
  globalThis.sessionStorage = createMemoryStorage();
  invalidateCachedResource('test:null-result');

  let calls = 0;
  const loader = async () => {
    calls += 1;
    return null;
  };

  assert.equal(await loadCachedResource('test:null-result', loader, { validate: value => value === null }), null);
  assert.equal(await loadCachedResource('test:null-result', loader, { validate: value => value === null }), null);
  assert.equal(calls, 1);

  if (originalSessionStorage === undefined) delete globalThis.sessionStorage;
  else globalThis.sessionStorage = originalSessionStorage;
});

test('Plyr assets load once on demand and stale player renders are ignored', async () => {
  const originalDocument = globalThis.document;
  const originalPlyr = globalThis.Plyr;
  const originalLocalStorage = globalThis.localStorage;

  class FakeElement {
    constructor(tagName) {
      this.tagName = tagName;
      this.children = [];
      this.style = {};
      this.dataset = {};
    }
    appendChild(child) { this.children.push(child); child.parentNode = this; return child; }
    replaceChildren(...children) { this.children = children; }
    contains(child) { return this.children.includes(child); }
  }

  const head = new FakeElement('head');
  globalThis.document = {
    head,
    createElement: (tagName) => new FakeElement(tagName)
  };
  globalThis.localStorage = createMemoryStorage();
  delete globalThis.Plyr;

  const initializedTitles = [];
  let destroyed = 0;
  const container = new FakeElement('div');
  const selector = new FakeElement('select');
  const controller = createEpisodePlayerController({ container, selector });

  try {
    controller.render({ title: 'Устаревшая серия', players: { hf: 'old.mp4' } });
    assert.equal(container.children[0].tagName, 'video');
    assert.equal(head.children.length, 2, 'one stylesheet and one script should be requested');

    controller.render({ title: 'Актуальная серия', players: { hf: 'current.mp4' } });
    assert.equal(head.children.length, 2, 'concurrent renders must share the same asset requests');

    globalThis.Plyr = class {
      constructor(video, options) {
        this.video = video;
        initializedTitles.push(options.title);
      }
      destroy() { destroyed += 1; }
    };

    const stylesheet = head.children.find((element) => element.tagName === 'link');
    const script = head.children.find((element) => element.tagName === 'script');
    stylesheet.onload();
    script.onload();
    await new Promise(resolve => setImmediate(resolve));

    assert.deepEqual(initializedTitles, ['Актуальная серия']);
    assert.equal(container.children[0].children[0].src, 'https://huggingface.co/datasets/letovvkun/op_archive/resolve/main/current.mp4?download=true');
    controller.destroy();
    assert.equal(destroyed, 1);
  } finally {
    if (originalDocument === undefined) delete globalThis.document;
    else globalThis.document = originalDocument;
    if (originalPlyr === undefined) delete globalThis.Plyr;
    else globalThis.Plyr = originalPlyr;
    if (originalLocalStorage === undefined) delete globalThis.localStorage;
    else globalThis.localStorage = originalLocalStorage;
  }
});

test('force refresh bypasses an older pending request and keeps the fresh result in cache', async () => {
  const originalSessionStorage = globalThis.sessionStorage;
  globalThis.sessionStorage = createMemoryStorage();
  invalidateCachedResource('test:force-refresh');
  let resolveOld;
  const oldRequest = loadCachedResource('test:force-refresh', () => new Promise((resolve) => {
    resolveOld = resolve;
  }));

  const freshRequest = loadCachedResource('test:force-refresh', async () => 'fresh', {
    forceRefresh: true
  });

  assert.equal(await freshRequest, 'fresh');
  resolveOld('stale');
  assert.equal(await oldRequest, 'stale');
  assert.equal(await loadCachedResource('test:force-refresh', async () => 'unexpected'), 'fresh');

  if (originalSessionStorage === undefined) delete globalThis.sessionStorage;
  else globalThis.sessionStorage = originalSessionStorage;
});


test('shared scroll-to-top helper registers a passive listener and scrolls smoothly', async () => {
  const { initScrollToTop } = await import('../js/core/ui.js');
  const originalDocument = globalThis.document;
  const originalWindow = globalThis.window;
  const classes = new Set();
  const listeners = new Map();
  const clicks = new Map();
  const button = {
    classList: { toggle(name, force) { force ? classes.add(name) : classes.delete(name); } },
    addEventListener(type, callback) { clicks.set(type, callback); }
  };
  const calls = [];
  const frames = [];
  globalThis.document = { getElementById: id => id === 'scrollTopBtn' ? button : null };
  globalThis.window = {
    scrollY: 600,
    addEventListener(type, callback, options) { listeners.set(type, { callback, options }); },
    requestAnimationFrame(callback) { frames.push(callback); return frames.length; },
    scrollTo(options) { calls.push(options); }
  };

  try {
    initScrollToTop();
    assert.equal(classes.has('visible'), true);
    assert.equal(listeners.get('scroll').options.passive, true);
    globalThis.window.scrollY = 0;
    listeners.get('scroll').callback();
    listeners.get('scroll').callback();
    assert.equal(frames.length, 1, 'multiple scroll events should be coalesced into one frame');
    frames.shift()();
    assert.equal(classes.has('visible'), false);
    clicks.get('click')();
    assert.deepEqual(calls, [{ top: 0, behavior: 'smooth' }]);
  } finally {
    if (originalDocument === undefined) delete globalThis.document;
    else globalThis.document = originalDocument;
    if (originalWindow === undefined) delete globalThis.window;
    else globalThis.window = originalWindow;
  }
});
