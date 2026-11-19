import test from 'node:test';
import assert from 'node:assert/strict';
import { createEpisodeBrowser } from '../js/components/episode-browser.js';

class FakeClassList {
  constructor() { this.values = new Set(); }
  add(name) { this.values.add(name); }
  remove(name) { this.values.delete(name); }
  contains(name) { return this.values.has(name); }
  toggle(name, force) {
    const shouldAdd = force === undefined ? !this.contains(name) : Boolean(force);
    if (shouldAdd) this.add(name);
    else this.remove(name);
    return shouldAdd;
  }
}

class FakeElement {
  constructor(tagName = 'div') {
    this.tagName = tagName;
    this.dataset = {};
    this.style = {};
    this.children = [];
    this.listeners = new Map();
    this.classList = new FakeClassList();
    this.attributes = new Map();
    this.value = '';
    this.textContent = '';
    this.innerHTML = '';
  }
  set className(value) {
    this.classList = new FakeClassList();
    for (const name of String(value).split(/\s+/).filter(Boolean)) this.classList.add(name);
  }
  get className() { return [...this.classList.values].join(' '); }
  addEventListener(type, callback) { this.listeners.set(type, callback); }
  dispatch(type, event = {}) {
    const callback = this.listeners.get(type);
    callback?.({ target: this, preventDefault() {}, stopPropagation() {}, ...event });
  }
  appendChild(child) {
    if (child.isFragment) {
      for (const item of child.children) {
        item.parentNode = this;
        this.children.push(item);
      }
    } else {
      child.parentNode = this;
      this.children.push(child);
    }
    return child;
  }
  closest(selector) {
    let node = this;
    while (node) {
      if (selector === '.ep' && node.classList?.contains('ep')) return node;
      if (selector === '.ep-watch-toggle' && node.classList?.contains('ep-watch-toggle')) return node;
      node = node.parentNode;
    }
    return null;
  }
  replaceChildren(...children) { this.children = children; }
  setAttribute(name, value) { this.attributes.set(name, String(value)); }
  querySelectorAll(selector) {
    if (selector === '.ep') return this.children.filter(child => child.classList?.contains('ep'));
    return [];
  }
  scrollIntoView() {}
}

function withFakeDocument(callback) {
  const originalDocument = globalThis.document;
  globalThis.document = {
    createElement: tagName => new FakeElement(tagName),
    createDocumentFragment: () => Object.assign(new FakeElement('#fragment'), { isFragment: true })
  };
  try { return callback(); }
  finally {
    if (originalDocument === undefined) delete globalThis.document;
    else globalThis.document = originalDocument;
  }
}

test('shared episode browser sorts once, keeps the selected episode stable after sorting, and navigates', () => {
  withFakeDocument(() => {
    const grid = new FakeElement();
    const sortSelect = new FakeElement('select');
    const previousButton = new FakeElement('button');
    const nextButton = new FakeElement('button');
    const selected = [];
    const browser = createEpisodeBrowser({
      grid,
      sortSelect,
      previousButton,
      nextButton,
      onSelect: episode => selected.push(episode.firestoreId)
    });

    const source = [
      { id: 1, firestoreId: 'ep-1', title: 'First' },
      { id: 3, firestoreId: 'ep-3', title: 'Third' },
      { id: 2, firestoreId: 'ep-2', title: 'Second' }
    ];
    browser.setEpisodes(source);

    assert.deepEqual(browser.episodes.map(episode => episode.id), [3, 2, 1]);
    assert.deepEqual(selected, ['ep-3']);

    sortSelect.value = 'asc';
    sortSelect.dispatch('change');
    assert.deepEqual(browser.episodes.map(episode => episode.id), [1, 2, 3]);
    assert.equal(browser.currentIndex, 2, 'the current episode must remain selected after reordering');
    assert.deepEqual(selected, ['ep-3'], 'sorting must not restart the player');

    nextButton.dispatch('click');
    assert.equal(browser.currentIndex, 1);
    assert.equal(selected.at(-1), 'ep-2');
    previousButton.dispatch('click');
    assert.equal(browser.currentIndex, 2);
    assert.equal(selected.at(-1), 'ep-3');
  });
});

test('shared episode browser respects the current sort control when data arrives asynchronously', () => {
  withFakeDocument(() => {
    const sortSelect = new FakeElement('select');
    sortSelect.value = 'asc';
    const browser = createEpisodeBrowser({ grid: new FakeElement(), sortSelect });
    browser.setEpisodes([
      { id: 2, firestoreId: 'ep-2', title: 'Second' },
      { id: 1, firestoreId: 'ep-1', title: 'First' }
    ]);
    assert.deepEqual(browser.episodes.map(episode => episode.id), [1, 2]);
  });
});

test('shared episode browser reuses prepared search metadata and renders only matching episodes', () => {
  withFakeDocument(() => {
    const grid = new FakeElement();
    const browser = createEpisodeBrowser({ grid });
    browser.setEpisodes([
      { id: 101, firestoreId: 'ep-101', title: 'East Blue' },
      { id: 102, firestoreId: 'ep-102', title: 'Grand Line' },
      { id: 103, firestoreId: 'ep-103', title: 'New World' }
    ]);

    browser.render('grand');
    assert.deepEqual(grid.children.map(card => card.dataset.firestoreId), ['ep-102']);
    browser.render('103');
    assert.deepEqual(grid.children.map(card => card.dataset.firestoreId), ['ep-103']);
  });
});


test('shared episode browser delegates card selection and watched toggles', () => {
  withFakeDocument(() => {
    const grid = new FakeElement();
    const watched = new Set();
    const marks = [];
    const manager = {
      get episodes() { return watched; },
      mark(id, value) {
        marks.push([id, value]);
        if (value) watched.add(id);
        else watched.delete(id);
      }
    };
    const selected = [];
    const browser = createEpisodeBrowser({
      grid,
      watchedManager: manager,
      onSelect: episode => selected.push(episode.firestoreId)
    });
    browser.setEpisodes([
      { id: 1, firestoreId: 'ep-1', title: 'First' },
      { id: 2, firestoreId: 'ep-2', title: 'Second' }
    ]);

    const firstCard = grid.children.find(card => card.dataset.firestoreId === 'ep-1');
    grid.dispatch('click', { target: firstCard });
    assert.deepEqual(selected, ['ep-2', 'ep-1']);
    assert.deepEqual(marks.at(-1), ['ep-1', true]);

    const toggle = new FakeElement('button');
    toggle.className = 'ep-watch-toggle';
    firstCard.appendChild(toggle);
    grid.dispatch('click', { target: toggle });
    assert.deepEqual(marks.at(-1), ['ep-1', false]);
    assert.equal(watched.has('ep-1'), false);
  });
});

test('shared episode browser paginates and collapses the episode list', () => {
  withFakeDocument(() => {
    const grid = new FakeElement();
    const loadMoreButton = new FakeElement('button');
    const loadMoreContainer = new FakeElement();
    const browser = createEpisodeBrowser({ grid, loadMoreButton, loadMoreContainer });
    browser.setEpisodes(Array.from({ length: 25 }, (_, index) => ({
      id: index + 1,
      firestoreId: `ep-${index + 1}`,
      title: `Episode ${index + 1}`
    })));

    assert.equal(grid.querySelectorAll('.ep').length, 8);
    loadMoreButton.dispatch('click');
    assert.equal(grid.querySelectorAll('.ep').length, 20);
    loadMoreButton.dispatch('click');
    assert.equal(grid.querySelectorAll('.ep').length, 25);
    assert.equal(loadMoreButton.classList.contains('expanded'), true);
    loadMoreButton.dispatch('click');
    assert.equal(grid.querySelectorAll('.ep').length, 8);
    assert.equal(loadMoreContainer.style.display, 'flex');
  });
});
