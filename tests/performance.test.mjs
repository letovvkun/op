import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

const read = (path) => readFileSync(path, 'utf8');

test('Plyr is not loaded as a render-blocking asset on the main or title page', () => {
  for (const page of ['index.html', 'title.html']) {
    const html = read(page);
    assert.doesNotMatch(html, /https:\/\/cdn\.plyr\.io\/3\.7\.8\/plyr\.(?:css|js)/,
      `${page} should defer Plyr until the MP4 player is selected`);
  }

  const player = read('js/services/episode-player.js');
  assert.match(player, /function loadPlyrScript\(\)/);
  assert.match(player, /function loadPlyrStylesheet\(\)/);
  assert.match(player, /loadPlyrAssets\(\)\.then/);
  assert.match(player, /preload = 'none'/);
});



test('visual transitions avoid broad all-property animation and slide the mobile catalog panel with transform', () => {
  const sharedCss = read('css/style.css');
  const catalogHtml = read('catalog.html');
  const gameHtml = read('game.html');
  assert.doesNotMatch(sharedCss, /transition:\s*all\b/);
  assert.doesNotMatch(catalogHtml, /transition:\s*all\b/);
  assert.doesNotMatch(gameHtml, /transition:\s*(?:all\b|[0-9.]+s\s*;)/);
  assert.match(catalogHtml, /transform:\s*translateX\(100%\)/);
  assert.match(catalogHtml, /transition:\s*transform 0\.3s var\(--ease-out\)/);
  assert.match(catalogHtml, /catalog-sidebar\.open \{ transform: translateX\(0\); \}/);
});

test('discussion widget does not load Giscus until the user opens the chat', () => {
  const html = read('index.html');
  const main = read('js/pages/main.js');
  const loader = read('js/components/lazy-giscus.js');
  assert.doesNotMatch(html, /<script[^>]+src=["']https:\/\/giscus\.app\/client\.js/,
    'Giscus must not be requested during initial HTML parsing');
  assert.match(html, /<div class="chat-widget-content"><\/div>/);
  assert.match(main, /createLazyGiscusLoader\(chatContent\)/);
  assert.match(main, /if \(isHidden\) loadChatWidget\(\)/);
  assert.match(loader, /script\.src = GISCUS_SCRIPT_URL/);
  assert.match(loader, /state !== 'idle'/);
});

test('game animation loop stops scheduling frames when the game is idle', () => {
  const source = read('js/pages/game.js');
  assert.match(source, /function scheduleLoop\(\)\s*\{\s*if \(animationFrameId !== null\) return;\s*animationFrameId = requestAnimationFrame\(loop\);/);
  assert.match(source, /if \(isGameRunning\) \{\s*update\(dt\);\s*if \(isGameRunning\) scheduleLoop\(\);\s*\}/);
  assert.match(source, /Рисуем один статичный кадр для меню/);
  assert.doesNotMatch(source, /function loop\(now\)\s*\{[\s\S]*?requestAnimationFrame\(loop\);/);
});

test('footer social icons are lazy-loaded and asynchronously decoded', () => {
  for (const page of ['index.html', 'catalog.html', 'info.html', 'title.html', 'tracker.html']) {
    const html = read(page);
    const socialIcons = [...html.matchAll(/<img\b[^>]*class="js-themable-icon"[^>]*>/g)].map(match => match[0]);
    assert.ok(socialIcons.length > 0, `${page} should retain its social icons`);
    for (const image of socialIcons) {
      assert.match(image, /loading="lazy"/);
      assert.match(image, /decoding="async"/);
      assert.match(image, /width="22"/);
      assert.match(image, /height="22"/);
    }
  }
});


test('catalog search metadata is prepared once after data load rather than rebuilt for each filter', () => {
  const page = read('js/pages/catalog.js');
  assert.match(page, /allTitles\.forEach\(\(title\) => catalogTitleIndex\.set\(title, createCatalogTitleIndex\(title\)\)\)/);
  assert.match(page, /catalogTitleIndex\.get\(title\)/);
  const renderCatalog = page.slice(page.indexOf('function renderCatalog'), page.indexOf('if (searchInput)'));
  assert.doesNotMatch(renderCatalog, /\.genres\.split\(/);
  assert.doesNotMatch(renderCatalog, /\.voice\.split\(/);
  assert.match(page, /function createCatalogTitleIndex\(title\)/);
  assert.match(page, /updatedAt: toTimestampMillis/);
  const buildFilters = page.slice(page.indexOf('function buildFilters'), page.indexOf('function renderCatalog'));
  assert.match(buildFilters, /catalogTitleIndex\.get\(title\)/);
  assert.doesNotMatch(buildFilters, /\.genres\.split\(/);
  assert.doesNotMatch(buildFilters, /\.voice\.split\(/);
});


test('game loop draws one idle frame, runs while playing and stops on return to menu', () => {
  const source = read('js/pages/game.js');
  const frames = [];
  let nextFrameId = 0;
  const listeners = new Map();
  const ctx = new Proxy({}, {
    get(target, property) {
      if (property === 'createLinearGradient') return () => ({ addColorStop() {} });
      return target[property] ?? (() => {});
    },
    set(target, property, value) {
      target[property] = value;
      return true;
    }
  });

  function makeElement(tagName = 'div') {
    return {
      tagName,
      style: {},
      dataset: {},
      classList: { add() {}, remove() {}, toggle() {} },
      addEventListener(type, callback) {
        this.listeners ||= {};
        this.listeners[type] = callback;
      },
      click() { this.listeners?.click?.({}); },
      getContext() { return ctx; }
    };
  }

  const ids = [
    'gameCanvas', 'score', 'final-score', 'bestScoreMenu', 'game-over',
    'mugiwara-popup', 'mugiwara-text', 'mugiwara-avatar', 'scoreBoard',
    'start-menu', 'ui-layer', 'restartBtn', 'menuBtn'
  ];
  const elements = new Map(ids.map(id => [id, makeElement(id === 'gameCanvas' ? 'canvas' : 'div')]));
  const canvas = elements.get('gameCanvas');
  const easyButton = makeElement('button');
  easyButton.dataset.diff = 'easy';

  runInNewContext(source, {
    document: {
      getElementById: id => elements.get(id),
      querySelectorAll: selector => selector === '.diff-btn' ? [easyButton] : []
    },
    window: {
      innerWidth: 390,
      innerHeight: 844,
      addEventListener(type, callback) { listeners.set(type, callback); }
    },
    localStorage: { getItem: () => null, setItem() {} },
    performance: { now: () => 1000 },
    requestAnimationFrame(callback) {
      frames.push(callback);
      nextFrameId += 1;
      return nextFrameId;
    },
    setTimeout: () => 1,
    console,
    Math,
    Date
  });

  assert.equal(frames.length, 1, 'the menu should request only its first drawing frame');
  frames.shift()(1016);
  assert.equal(frames.length, 0, 'the idle menu must not keep scheduling animation frames');

  easyButton.click();
  assert.equal(frames.length, 1, 'starting the game should restart the animation loop');
  frames.shift()(1033);
  assert.equal(frames.length, 1, 'the active game should keep scheduling frames');

  elements.get('menuBtn').click();
  frames.shift()(1050);
  assert.equal(frames.length, 0, 'returning to the menu should stop the animation loop again');
});

test('main and title pages share one episode browser instead of duplicating list logic', () => {
  const main = read('js/pages/main.js');
  const title = read('js/pages/title.js');

  for (const [name, source] of [['main', main], ['title', title]]) {
    assert.match(source, /createEpisodeBrowser\(/, `${name} should use the shared episode browser`);
    assert.match(source, /isEpisodeDisplayable/, `${name} should use the shared episode validation`);
    assert.doesNotMatch(source, /function (?:renderList|getFilteredEpisodes|markActive)\(/,
      `${name} should not contain a duplicate episode-list implementation`);
    assert.match(source, /initScrollToTop\(\)/, `${name} should use the shared scroll-to-top helper`);
  }

  assert.match(main, /animatedCollapse:\s*true/);
  assert.match(title, /navigationScroll:\s*true/);
  assert.match(title, /navigator\.share/);
  assert.match(main, /trackPlayerSelection/);
});


test('LCP banner is explicitly preloaded at high priority on pages that use it', () => {
  for (const page of ['index.html', 'catalog.html', 'title.html', 'tracker.html', 'info.html']) {
    const html = read(page);
    assert.match(html, /<link\s+rel="preload"\s+as="image"[^>]*background\.webp[^>]*fetchpriority="high"/,
      `${page} should preload its shared CSS banner image at high priority`);
  }
});

test('Google Fonts stylesheets are loaded asynchronously with a no-script fallback', () => {
  for (const page of ['index.html', 'catalog.html', 'title.html', 'tracker.html', 'info.html', 'game.html', '404.html']) {
    const html = read(page);
    assert.match(html, /<link href="https:\/\/fonts\.googleapis\.com\/css2\?[^"]+" rel="stylesheet" media="print" onload="this\.media='all'">/,
      `${page} should not make Google Fonts CSS render-blocking`);
    assert.match(html, /<noscript><link href="https:\/\/fonts\.googleapis\.com\/css2\?[^"]+" rel="stylesheet"><\/noscript>/,
      `${page} should retain Google Fonts when JavaScript is disabled`);
  }
});
