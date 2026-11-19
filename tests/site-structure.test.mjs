import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join, relative, resolve, extname } from 'node:path';
import { Script } from 'node:vm';

const root = resolve('.');
const htmlFiles = readdirSync(root).filter(file => extname(file).toLowerCase() === '.html').sort();

function collectFiles(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const filePath = join(directory, entry.name);
    return entry.isDirectory() ? collectFiles(filePath) : [filePath];
  });
}

function getAttributes(source) {
  const attributes = new Map();
  const pattern = /([^\s=/>]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g;
  for (const match of source.matchAll(pattern)) {
    const key = match[1].toLowerCase();
    if (key === 'id' || key === 'href' || key === 'src' || key === 'rel' || key === 'target' || key === 'alt' || key === 'type') {
      attributes.set(key, match[2] ?? match[3] ?? match[4] ?? '');
    }
  }
  return attributes;
}

function getOpeningTags(html) {
  return [...html.matchAll(/<([a-z][a-z0-9-]*)\b([^>]*)>/gi)].map(match => ({
    name: match[1].toLowerCase(),
    attributes: getAttributes(match[2])
  }));
}

function resolveLocalReference(page, reference) {
  const clean = reference.split(/[?#]/, 1)[0];
  if (!clean) return page;
  if (clean.startsWith('/')) return resolve(root, `.${clean}`);
  return resolve(root, dirname(page), decodeURIComponent(clean));
}

test('HTML start tags do not absorb following markup through a missing closing angle bracket', () => {
  for (const htmlFile of htmlFiles) {
    let html = readFileSync(join(root, htmlFile), 'utf8');
    // Avoid interpreting markup-like text inside inline JavaScript or CSS strings as HTML.
    html = html
      .replace(/<script\b[^>]*>[\s\S]*?<\/script\s*>/gi, '')
      .replace(/<style\b[^>]*>[\s\S]*?<\/style\s*>/gi, '');

    for (const match of html.matchAll(/<([a-z][a-z0-9-]*)\b([^>]*)>/gi)) {
      assert.equal(match[2].includes('<'), false,
        `${htmlFile} has an unclosed start tag <${match[1]}> that absorbs the next element`);
    }
  }
});

test('all local script src references in HTML resolve to existing files', () => {
  for (const htmlFile of htmlFiles) {
    const html = readFileSync(join(root, htmlFile), 'utf8');
    for (const tag of getOpeningTags(html)) {
      if (tag.name !== 'script') continue;
      const src = tag.attributes.get('src');
      if (!src || /^(?:https?:)?\/\//i.test(src) || src.startsWith('data:')) continue;
      assert.equal(existsSync(resolveLocalReference(join(root, htmlFile), src)), true, `${htmlFile} references missing script ${src}`);
    }
  }
});

test('all relative JavaScript module imports resolve to existing files', () => {
  const jsFiles = collectFiles(join(root, 'js')).filter(file => file.endsWith('.js'));
  for (const file of jsFiles) {
    const source = readFileSync(file, 'utf8');
    for (const match of source.matchAll(/(?:\bfrom\s*|\bimport\s*\(\s*)["'](\.{1,2}\/[^"']+)["']/g)) {
      const target = resolve(dirname(file), match[1]);
      assert.equal(existsSync(target), true, `${relative(root, file)} imports missing ${match[1]}`);
    }
  }
});

test('all local HTML assets and navigation links resolve', () => {
  for (const htmlFile of htmlFiles) {
    const html = readFileSync(join(root, htmlFile), 'utf8');
    const pagePath = join(root, htmlFile);
    const tags = getOpeningTags(html);
    const ids = new Set(tags.filter(tag => tag.attributes.has('id')).map(tag => tag.attributes.get('id')));

    for (const tag of tags) {
      const reference = tag.attributes.get('src')
        || (tag.name === 'link' || tag.name === 'a' ? tag.attributes.get('href') : null);
      if (!reference || /^(?:[a-z][a-z0-9+.-]*:|\/\/|#)/i.test(reference)) continue;
      assert.equal(existsSync(resolveLocalReference(pagePath, reference)), true, `${htmlFile} has missing local ${tag.name} reference ${reference}`);
    }

    for (const tag of tags) {
      const href = tag.name === 'a' ? tag.attributes.get('href') : null;
      if (!href || !href.includes('#')) continue;
      const [path, fragment] = href.split('#', 2);
      if (!fragment) continue;
      const targetPath = path ? resolveLocalReference(pagePath, path) : pagePath;
      if (extname(targetPath).toLowerCase() !== '.html' || !existsSync(targetPath)) continue;
      const targetHtml = readFileSync(targetPath, 'utf8');
      const targetIds = new Set(getOpeningTags(targetHtml).filter(item => item.attributes.has('id')).map(item => item.attributes.get('id')));
      assert.equal(targetIds.has(decodeURIComponent(fragment)), true, `${htmlFile} has broken fragment link ${href}`);
    }
  }
});

test('HTML ids are unique and external new-tab links are protected', () => {
  for (const htmlFile of htmlFiles) {
    const html = readFileSync(join(root, htmlFile), 'utf8');
    const tags = getOpeningTags(html);
    const ids = tags.filter(tag => tag.attributes.has('id')).map(tag => tag.attributes.get('id'));
    assert.equal(new Set(ids).size, ids.length, `${htmlFile} contains duplicate id attributes`);

    for (const tag of tags) {
      if (tag.name !== 'a' || tag.attributes.get('target') !== '_blank') continue;
      const rel = new Set((tag.attributes.get('rel') || '').toLowerCase().split(/\s+/));
      assert.equal(rel.has('noopener'), true, `${htmlFile} has target=_blank without rel=noopener`);
    }
  }
});

test('inline JavaScript blocks parse successfully', () => {
  for (const htmlFile of htmlFiles) {
    const html = readFileSync(join(root, htmlFile), 'utf8');
    for (const match of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi)) {
      const attrs = getAttributes(match[1]);
      if (attrs.has('src') || !match[2].trim()) continue;
      assert.doesNotThrow(() => new Script(match[2], { filename: `${htmlFile}:inline-script` }));
    }
  }
});

test('local CSS url() assets resolve', () => {
  for (const cssFile of collectFiles(join(root, 'css')).filter(file => file.endsWith('.css'))) {
    const source = readFileSync(cssFile, 'utf8');
    for (const match of source.matchAll(/url\(\s*(["']?)(.*?)\1\s*\)/gi)) {
      const reference = match[2].trim();
      if (!reference || /^(?:[a-z][a-z0-9+.-]*:|\/\/|#)/i.test(reference)) continue;
      const target = resolve(dirname(cssFile), decodeURIComponent(reference.split(/[?#]/, 1)[0]));
      assert.equal(existsSync(target), true, `${relative(root, cssFile)} references missing CSS asset ${reference}`);
    }
  }
});

test('Firebase SDK imports stay in the adapter and Analytics remains optional', () => {
  const jsFiles = collectFiles(join(root, 'js')).filter(file => file.endsWith('.js'));
  for (const file of jsFiles) {
    const source = readFileSync(file, 'utf8');
    if (relative(root, file) === 'js/core/firebase.js') continue;
    assert.equal(source.includes('firebasejs/'), false, `${relative(root, file)} imports Firebase SDK directly`);
  }

  const adapter = readFileSync(join(root, 'js/core/firebase.js'), 'utf8');
  assert.match(adapter, /import\(['"]https:\/\/www\.gstatic\.com\/firebasejs\/9\.22\.1\/firebase-analytics\.js['"]\)/);
  assert.doesNotMatch(adapter, /^\s*import\s+.*firebase-analytics/m);
});

test('page modules delegate Firestore access to services', () => {
  for (const file of collectFiles(join(root, 'js/pages')).filter(file => file.endsWith('.js'))) {
    const source = readFileSync(file, 'utf8');
    assert.doesNotMatch(source, /from\s*["']\.\.\/core\/firebase\.js["']/,
      `${relative(root, file)} imports Firebase directly instead of using a service`);
  }
});

test('sitemap entries resolve to existing public HTML pages', () => {
  const sitemap = readFileSync(join(root, 'sitemap.xml'), 'utf8');
  const urls = [...sitemap.matchAll(/<loc>(.*?)<\/loc>/g)].map(match => match[1].trim());
  assert.ok(urls.length > 0, 'sitemap.xml has no URL entries');
  for (const url of urls) {
    const parsed = new URL(url);
    assert.equal(parsed.hostname, 'letovshiyori.org', `unexpected sitemap host in ${url}`);
    const page = parsed.pathname === '/' ? 'index.html' : parsed.pathname.replace(/^\//, '');
    assert.equal(existsSync(join(root, page)), true, `sitemap entry points to missing page ${url}`);
  }
});

test('all JavaScript modules are reachable from HTML entry points and imports have no cycles', () => {
  const jsFiles = collectFiles(join(root, 'js')).filter(file => file.endsWith('.js')).map(file => resolve(file));
  const knownFiles = new Set(jsFiles);
  const graph = new Map();

  for (const file of jsFiles) {
    const source = readFileSync(file, 'utf8');
    const dependencies = [];
    for (const match of source.matchAll(/(?:\bfrom\s*|\bimport\s*\(\s*)["'](\.{1,2}\/[^"']+)["']/g)) {
      const target = resolve(dirname(file), match[1]);
      if (knownFiles.has(target)) dependencies.push(target);
    }
    graph.set(file, dependencies);
  }

  const entryPoints = [];
  for (const htmlFile of htmlFiles) {
    const html = readFileSync(join(root, htmlFile), 'utf8');
    for (const tag of getOpeningTags(html)) {
      const src = tag.name === 'script' ? tag.attributes.get('src') : null;
      if (src?.startsWith('js/') && src.endsWith('.js')) entryPoints.push(resolve(root, src));
    }
  }

  const reachable = new Set();
  const visit = (file) => {
    if (reachable.has(file)) return;
    reachable.add(file);
    for (const dependency of graph.get(file) || []) visit(dependency);
  };
  entryPoints.forEach(visit);

  const unreachable = jsFiles.filter(file => !reachable.has(file));
  assert.deepEqual(unreachable, [], `Unreachable JavaScript files: ${unreachable.map(file => relative(root, file)).join(', ')}`);

  const state = new Map();
  const stack = [];
  const cycles = [];
  const detectCycle = (file) => {
    state.set(file, 1);
    stack.push(file);
    for (const dependency of graph.get(file) || []) {
      if (state.get(dependency) === 1) {
        cycles.push([...stack.slice(stack.indexOf(dependency)), dependency]);
      } else if (!state.has(dependency)) {
        detectCycle(dependency);
      }
    }
    stack.pop();
    state.set(file, 2);
  };
  for (const file of jsFiles) if (!state.has(file)) detectCycle(file);
  assert.deepEqual(cycles, [], `Circular JavaScript imports: ${cycles.map(cycle => cycle.map(file => relative(root, file)).join(' -> ')).join('; ')}`);
});

test('all HTML images declare alternative text', () => {
  for (const htmlFile of htmlFiles) {
    const html = readFileSync(join(root, htmlFile), 'utf8');
    for (const tag of getOpeningTags(html)) {
      if (tag.name !== 'img') continue;
      assert.equal(tag.attributes.has('alt'), true, `${htmlFile} contains an img without alt text`);
    }
  }
});
