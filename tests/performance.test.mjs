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


test('LCP banner is an early, high-priority HTML image rather than a CSS background', () => {
  for (const page of ['index.html', 'catalog.html', 'title.html', 'tracker.html', 'info.html']) {
    const html = read(page);
    const bodyStart = html.indexOf('<body');
    const bannerIndex = html.indexOf('class="site-banner"');
    assert.ok(bannerIndex > bodyStart, `${page} should contain its banner in the body`);
    assert.ok(bannerIndex - bodyStart < 500, `${page} should expose the banner near the start of the body`);
    const banner = html.slice(bannerIndex, html.indexOf('</div>', bannerIndex));
    assert.match(banner, /<img[^>]+background\.webp/);
    assert.match(banner, /loading="eager"/);
    assert.match(banner, /fetchpriority="high"/);
    assert.match(banner, /decoding="async"/);
    assert.match(banner, /width="1000"/);
    assert.match(banner, /height="562"/);
  }

  const sharedCss = read('css/style.css');
  assert.match(sharedCss, /\.site-banner__image\s*\{/);
  assert.doesNotMatch(sharedCss, /\.site-banner\s*\{[^}]*background:\s*url\(/s);
});

test('Firestore SDK is dynamically imported only when a Firestore operation is needed', () => {
  const firebase = read('js/core/firebase.js');
  assert.match(firebase, /export function getFirestoreSdk\(\)/);
  assert.match(firebase, /import\('https:\/\/www\.gstatic\.com\/firebasejs\/9\.22\.1\/firebase-firestore\.js'\)/);
  assert.doesNotMatch(firebase, /^import\s+\{[^}]+\}\s+from\s+['"]https:\/\/www\.gstatic\.com\/firebasejs\/9\.22\.1\/firebase-firestore\.js['"]/m);

  for (const service of ['episode-data.js', 'titles.js', 'tracker-data.js', 'site-settings.js', 'telemetry.js']) {
    const source = read(`js/services/${service}`);
    assert.match(source, /getFirestoreSdk/);
  }
});

test('Yandex Metrika keeps the existing counter but loads after the page load/idle period', () => {
  const html = read('index.html');
  assert.match(html, /window\.ym\(103823334, 'init'/);
  assert.match(html, /webvisor:true/);
  assert.match(html, /clickmap:true/);
  assert.match(html, /requestIdleCallback\(loadMetrika, \{ timeout: 4000 \}\)/);
  assert.match(html, /addEventListener\('load', scheduleMetrika/);
  assert.doesNotMatch(html, /k=e\.createElement\(t\),a=e\.getElementsByTagName\(t\)\[0\],k\.async=1/);
});

test('small header logos and berry symbols reserve their rendered dimensions', () => {
  for (const page of ['index.html', 'catalog.html', 'title.html', 'tracker.html', 'info.html']) {
    const html = read(page);
    for (const match of html.matchAll(/<img[^>]+(?:logo\.webp|Berrysymbol\.svg\.webp)[^>]*>/g)) {
      assert.match(match[0], /width="(?:44|15)"/);
      assert.match(match[0], /height="(?:44|15)"/);
    }
  }
});


test('skeleton shimmer animates transform instead of repainting background-position', () => {
  const sharedCss = read('css/style.css');
  const skeletonBlock = sharedCss.slice(sharedCss.indexOf('.skeleton-loader {'), sharedCss.indexOf('/* Унифицированные размеры skeleton-placeholder'));
  assert.match(skeletonBlock, /\.skeleton-loader::after/);
  assert.match(skeletonBlock, /animation:\s*skeleton-shimmer/);
  assert.match(skeletonBlock, /@keyframes skeleton-shimmer[\s\S]*transform:\s*translate3d/);
  assert.doesNotMatch(skeletonBlock, /background-position/);
});


test('shared initial pages preconnect to the image CDN and Firebase module host', () => {
  for (const page of ['index.html', 'catalog.html', 'title.html', 'tracker.html', 'info.html']) {
    const html = read(page);
    assert.match(html, /rel="preconnect" href="https:\/\/cdn\.jsdelivr\.net"/);
    assert.match(html, /rel="preconnect" href="https:\/\/www\.gstatic\.com" crossorigin/);
  }
});


test('quick title search is loaded only after interaction, not in the entrypoint module graph', () => {
  for (const page of ['js/pages/main.js', 'js/pages/title.js']) {
    const source = read(page);
    assert.match(source, /initLazyQuickTitleSearch/);
    assert.doesNotMatch(source, /from ['"]\.\.\/components\/quick-title-search\.js['"]/);
  }

  const loader = read('js/components/lazy-quick-title-search.js');
  assert.match(loader, /import\(['"]\.\/quick-title-search\.js['"]\)/);
  assert.match(loader, /addEventListener\('pointerdown'/);
  assert.match(loader, /addEventListener\('focus'/);
  assert.match(loader, /addEventListener\('click',[\s\S]*?true\)/);
});

test('homepage preconnects to Firestore while keeping font stylesheet non-blocking', () => {
  const html = read('index.html');
  assert.match(html, /rel="preconnect" href="https:\/\/firestore\.googleapis\.com"/);
  assert.match(html, /rel="dns-prefetch" href="\/\/fonts\.googleapis\.com"/);
  assert.match(html, /fonts\.gstatic\.com/);
  assert.match(html, /rel="preconnect" href="https:\/\/cdn\.plyr\.io"/);
});

test('site image CDN URLs are pinned to an immutable repository commit', () => {
  const commit = '16d8001cfeaaf7e87811f94162c9e3c7986d1c79';
  for (const page of ['index.html', 'catalog.html', 'title.html', 'tracker.html', 'info.html']) {
    const html = read(page);
    assert.match(html, new RegExp('cdn\\.jsdelivr\\.net/gh/l3towm-byte/image@' + commit));
    assert.doesNotMatch(html, /cdn\.jsdelivr\.net\/gh\/l3towm-byte\/image\//);
  }
});
