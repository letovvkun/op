import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const stylesheet = readFileSync('css/style.css', 'utf8');
const sharedFooterSelectors = [
  '.site-footer .js-themable-icon',
  'body[data-theme="dark"] .site-footer .js-themable-icon'
];
const pagesWithSharedFooterStyles = [
  'index.html',
  'title.html',
  'catalog.html',
  'info.html',
  'tracker.html'
];

test('verified unused CSS artifacts stay removed', () => {
  assert.doesNotMatch(stylesheet, /--radius\s*:/,
    'the unused --radius custom property should not return');
  assert.doesNotMatch(stylesheet, /\.player-float\b/,
    'the unreferenced .player-float selector should not return');

  for (const page of ['404.html', ...pagesWithSharedFooterStyles]) {
    const source = readFileSync(page, 'utf8');
    assert.doesNotMatch(source, /--radius\s*:/,
      `${page} should not declare the unused --radius property`);
  }
});

test('shared footer icon styling is defined once in the common stylesheet', () => {
  for (const selector of sharedFooterSelectors) {
    const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const matches = [...stylesheet.matchAll(new RegExp(`^\\s*${escaped}\\s*\\{`, 'gm'))];
    assert.equal(matches.length, 1, `${selector} should be defined once in css/style.css`);
  }

  for (const page of pagesWithSharedFooterStyles) {
    const source = readFileSync(page, 'utf8');
    assert.doesNotMatch(source, /\.site-footer\s+\.js-themable-icon\s*\{/,
      `${page} still duplicates the shared footer icon transition`);
    assert.doesNotMatch(source, /body\[data-theme="dark"\]\s+\.site-footer\s+\.js-themable-icon\s*\{/,
      `${page} still duplicates the shared footer icon filter`);
  }
});

test('cascade-controlled rules do not rely on redundant !important flags', () => {
  assert.match(stylesheet, /\.ep\.active\s*\{[^}]*box-shadow:\s*0 0 0 1px var\(--accent-c\);/s);
  assert.match(stylesheet, /@media \(max-width: 767px\)[\s\S]*?\.search,[\s\S]*?font-size:\s*16px;/);
  assert.doesNotMatch(stylesheet, /font-size:\s*16px\s*!important/);

  const catalog = readFileSync('catalog.html', 'utf8');
  assert.match(catalog, /\.wrap \{\s*max-width:\s*1420px;\s*\}/);
  assert.doesNotMatch(catalog, /max-width:\s*1420px\s*!important/);

  const tracker = readFileSync('tracker.html', 'utf8');
  assert.match(tracker, /\.tracker-table\s*\{[^}]*text-align:\s*left;/s);
  assert.doesNotMatch(tracker, /text-align:\s*left\s*!important/);
});

test('core appearance and responsive behavior remain represented in shared CSS', () => {
  for (const token of [
    'backdrop-filter: blur(18px) saturate(1.1)',
    'box-shadow: var(--card-shadow)',
    '@media (max-width: 980px)',
    '@media (max-width: 767px)',
    '@media (prefers-reduced-motion: reduce)',
    '.ep:hover',
    '.modal.open',
    '.floating-menu.active'
  ]) {
    assert.ok(stylesheet.includes(token), `missing important visual or responsive rule: ${token}`);
  }
});
