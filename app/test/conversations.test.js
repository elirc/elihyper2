const { test } = require('node:test');
const assert = require('node:assert');

const { createConversationStore, titleFrom, SCHEMA_VERSION } = require('../public/js/conversations');

// Map-backed stand-in for localStorage. The store takes its backend as an
// argument precisely so this file needs no browser and no jsdom.
function fakeStorage({ failAfterBytes = Infinity } = {}) {
  const data = new Map();
  return {
    data,
    getItem: (key) => (data.has(key) ? data.get(key) : null),
    setItem(key, value) {
      if (value.length > failAfterBytes) {
        const err = new Error('quota');
        err.name = 'QuotaExceededError';
        throw err;
      }
      data.set(key, value);
    },
    removeItem: (key) => data.delete(key),
  };
}

let counter = 0;
const build = (options = {}) =>
  createConversationStore({
    storage: fakeStorage(),
    newId: () => `id-${++counter}`,
    now: () => 1_000 + counter,
    ...options,
  });

test('a new store lists nothing', () => {
  assert.deepStrictEqual(build().list(), []);
});

test('create stores a conversation and derives its title', () => {
  const store = build();
  const created = store.create('What is the capital of France?', [
    { role: 'user', content: 'What is the capital of France?' },
  ]);

  assert.ok(created.id);
  assert.strictEqual(created.title, 'What is the capital of France?');
  assert.strictEqual(store.list().length, 1);
  assert.strictEqual(store.get(created.id).messages.length, 1);
});

test('titles are collapsed to one line and truncated', () => {
  assert.strictEqual(titleFrom('  hello\n  world  '), 'hello world');
  assert.strictEqual(titleFrom(''), 'Untitled conversation');

  const long = titleFrom('x'.repeat(200));
  assert.ok(long.length <= 50, `expected <= 50, got ${long.length}`);
  assert.ok(long.endsWith('…'));
});

test('save replaces the message array and bumps updatedAt', () => {
  const store = build();
  const created = store.create('hi', [{ role: 'user', content: 'hi' }]);
  const before = store.get(created.id).updatedAt;

  store.save(created.id, [
    { role: 'user', content: 'hi' },
    { role: 'assistant', content: 'hello' },
  ]);

  const after = store.get(created.id);
  assert.strictEqual(after.messages.length, 2);
  assert.ok(after.updatedAt >= before);
});

test('save on an unknown id is a no-op rather than a throw', () => {
  const store = build();
  assert.strictEqual(store.save('nope', []), null);
});

test('rename falls back to a placeholder for blank titles', () => {
  const store = build();
  const created = store.create('hi', []);

  store.rename(created.id, '  Renamed  ');
  assert.strictEqual(store.get(created.id).title, 'Renamed');

  store.rename(created.id, '   ');
  assert.strictEqual(store.get(created.id).title, 'Untitled conversation');
});

test('remove deletes one conversation and reports whether it existed', () => {
  const store = build();
  const a = store.create('a', []);
  store.create('b', []);

  assert.strictEqual(store.remove(a.id), true);
  assert.strictEqual(store.remove(a.id), false);
  assert.strictEqual(store.list().length, 1);
});

test('the list is newest-first', () => {
  let clock = 0;
  const store = createConversationStore({
    storage: fakeStorage(),
    newId: () => `id-${++counter}`,
    now: () => (clock += 10),
  });

  const first = store.create('first', []);
  const second = store.create('second', []);

  assert.deepStrictEqual(
    store.list().map((c) => c.id),
    [second.id, first.id]
  );
});

test('the oldest conversation is evicted beyond the cap', () => {
  let clock = 0;
  const evictions = [];
  const store = createConversationStore({
    storage: fakeStorage(),
    maxConversations: 3,
    newId: () => `id-${++counter}`,
    now: () => (clock += 10),
    onEviction: (n) => evictions.push(n),
  });

  const oldest = store.create('one', []);
  store.create('two', []);
  store.create('three', []);
  store.create('four', []);

  assert.strictEqual(store.list().length, 3);
  assert.strictEqual(store.get(oldest.id), null, 'oldest should be gone');
  assert.deepStrictEqual(evictions, [1], 'the caller should be told once');
});

test('a quota error drops old conversations instead of losing the current turn', () => {
  let clock = 0;
  const evictions = [];
  // Small enough that the fourth conversation cannot fit.
  const storage = fakeStorage({ failAfterBytes: 400 });
  const store = createConversationStore({
    storage,
    newId: () => `id-${++counter}`,
    now: () => (clock += 10),
    onEviction: (n) => evictions.push(n),
  });

  for (let i = 0; i < 6; i++) store.create(`conversation number ${i}`, []);

  // The write succeeded in some reduced form rather than throwing.
  assert.ok(store.list().length > 0, 'something survived');
  assert.ok(evictions.length > 0, 'eviction was reported');
});

test('an unrecognised schema version is discarded, not guessed at', () => {
  const storage = fakeStorage();
  storage.setItem(
    'nova.conversations',
    JSON.stringify({ version: SCHEMA_VERSION + 99, conversations: [{ id: 'x' }] })
  );

  const store = createConversationStore({ storage });
  assert.deepStrictEqual(store.list(), []);
});

test('a corrupt payload does not throw on read', () => {
  const storage = fakeStorage();
  storage.setItem('nova.conversations', '{not json');

  const store = createConversationStore({ storage });
  assert.deepStrictEqual(store.list(), []);
});

test('malformed conversations are filtered out', () => {
  const storage = fakeStorage();
  storage.setItem(
    'nova.conversations',
    JSON.stringify({
      version: SCHEMA_VERSION,
      conversations: [
        { id: 'good', title: 't', createdAt: 1, updatedAt: 1, messages: [] },
        { id: 'bad-no-timestamps', title: 't', messages: [] },
        { id: 'bad-role', title: 't', createdAt: 1, updatedAt: 1, messages: [{ role: 'system', content: 'x' }] },
      ],
    })
  );

  const store = createConversationStore({ storage });
  assert.deepStrictEqual(
    store.list().map((c) => c.id),
    ['good']
  );
});
