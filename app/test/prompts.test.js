const { test } = require('node:test');
const assert = require('node:assert');

const { createPromptStore, variablesIn, fill, DEFAULTS, SCHEMA_VERSION } = require('../public/js/prompts');

function fakeStorage() {
  const data = new Map();
  return {
    getItem: (k) => (data.has(k) ? data.get(k) : null),
    setItem: (k, v) => data.set(k, v),
    removeItem: (k) => data.delete(k),
  };
}

let n = 0;
const build = () => createPromptStore({ storage: fakeStorage(), newId: () => `p-${++n}` });

test('variablesIn finds each placeholder once', () => {
  assert.deepStrictEqual(variablesIn('{{a}} then {{b}} then {{a}}'), ['a', 'b']);
  assert.deepStrictEqual(variablesIn('no placeholders'), []);
  assert.deepStrictEqual(variablesIn(null), []);
});

test('fill substitutes supplied values and leaves the rest alone', () => {
  assert.strictEqual(fill('Hi {{name}}', { name: 'Sam' }), 'Hi Sam');
  // An unsupplied placeholder stays visible rather than becoming "undefined",
  // which at least tells the user what is missing.
  assert.strictEqual(fill('Hi {{name}}', {}), 'Hi {{name}}');
});

test('fill does not treat a replacement value as a pattern', () => {
  // A naive replace would interpret $& in the value as a backreference.
  assert.strictEqual(fill('{{x}}', { x: '$& and $1' }), '$& and $1');
});

test('a new library is seeded so the user never sees an empty box', () => {
  const prompts = build().list();
  assert.strictEqual(prompts.length, DEFAULTS.length);
  assert.ok(prompts.every((p) => typeof p.body === 'string' && p.body.length > 0));
});

test('save appends a new prompt and returns the library', () => {
  const store = build();
  const before = store.list().length;
  store.save({ name: 'Mine', body: 'Do {{thing}}' });

  const after = store.list();
  assert.strictEqual(after.length, before + 1);
  assert.ok(after.some((p) => p.name === 'Mine'));
});

test('save with an existing id edits in place', () => {
  const store = build();
  const target = store.list()[0];
  store.save({ id: target.id, name: 'Renamed', body: 'new body' });

  const updated = store.get(target.id);
  assert.strictEqual(updated.name, 'Renamed');
  assert.strictEqual(updated.body, 'new body');
});

test('a blank name falls back rather than saving an unlabelled prompt', () => {
  const store = build();
  store.save({ name: '   ', body: 'x' });
  assert.ok(store.list().some((p) => p.name === 'Untitled prompt'));
});

test('remove reports whether the prompt existed', () => {
  const store = build();
  const target = store.list()[0];

  assert.strictEqual(store.remove(target.id), true);
  assert.strictEqual(store.remove(target.id), false);
  assert.strictEqual(store.get(target.id), null);
});

test('export and import round-trip', () => {
  const source = build();
  source.save({ name: 'Portable', body: 'body {{v}}' });

  const target = build();
  const before = target.list().length;
  const result = target.fromJson(source.toJson());

  assert.strictEqual(result.ok, true);
  assert.strictEqual(target.list().length, before + result.imported);
  assert.ok(target.list().some((p) => p.name === 'Portable'));
});

test('import rejects malformed files without touching the library', () => {
  const store = build();
  const before = store.list().length;

  for (const bad of ['{oops', JSON.stringify({ version: 99, prompts: [] }),
                     JSON.stringify({ version: SCHEMA_VERSION, prompts: [{ name: 1, body: 'x' }] })]) {
    const result = store.fromJson(bad);
    assert.strictEqual(result.ok, false);
  }
  assert.strictEqual(store.list().length, before);
});

test('import assigns fresh ids rather than trusting the file', () => {
  const store = build();
  const payload = JSON.stringify({
    version: SCHEMA_VERSION,
    prompts: [{ id: 'builtin-explain', name: 'Collision', body: 'x' }],
  });
  store.fromJson(payload);

  const matching = store.list().filter((p) => p.id === 'builtin-explain');
  assert.strictEqual(matching.length, 1, 'an imported id must not overwrite an existing prompt');
});

test('a corrupt store re-seeds instead of throwing', () => {
  const storage = fakeStorage();
  storage.setItem('nova.prompts', 'not json at all');
  const store = createPromptStore({ storage, newId: () => `p-${++n}` });

  assert.strictEqual(store.list().length, DEFAULTS.length);
});
