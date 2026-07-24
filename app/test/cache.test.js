const { test } = require('node:test');
const assert = require('node:assert');

const { AudioCache } = require('../lib/audio-cache');

const params = (overrides = {}) => ({
  text: 'hello',
  voiceId: 'Matthew',
  engine: 'generative',
  outputFormat: 'mp3',
  textType: 'text',
  languageCode: 'en-US',
  ...overrides,
});

test('the key is stable for identical parameters', () => {
  assert.strictEqual(AudioCache.key(params()), AudioCache.key(params()));
});

test('the key changes when any parameter changes', () => {
  const base = AudioCache.key(params());
  assert.notStrictEqual(base, AudioCache.key(params({ voiceId: 'Joanna' })));
  assert.notStrictEqual(base, AudioCache.key(params({ engine: 'neural' })));
  assert.notStrictEqual(base, AudioCache.key(params({ text: 'hello ' })));
  assert.notStrictEqual(base, AudioCache.key(params({ textType: 'ssml' })));
});

test('a miss is followed by a hit that returns identical bytes', () => {
  const cache = new AudioCache();
  const audio = Buffer.from('audio-bytes');

  assert.strictEqual(cache.get('k'), undefined);
  cache.set('k', audio);

  const hit = cache.get('k');
  assert.ok(hit);
  assert.ok(hit.audio.equals(audio));
  assert.deepStrictEqual(
    { hits: cache.stats().hits, misses: cache.stats().misses },
    { hits: 1, misses: 1 }
  );
});

test('entries are evicted least-recently-used first', () => {
  const cache = new AudioCache({ maxEntries: 2 });
  cache.set('a', Buffer.from('a'));
  cache.set('b', Buffer.from('b'));

  cache.get('a'); // 'a' is now the most recently used, so 'b' should go first
  cache.set('c', Buffer.from('c'));

  assert.ok(cache.get('a'), 'a should survive');
  assert.strictEqual(cache.get('b'), undefined, 'b should have been evicted');
  assert.ok(cache.get('c'), 'c should survive');
});

test('the byte budget is enforced', () => {
  const cache = new AudioCache({ maxEntries: 100, maxBytes: 10 });
  cache.set('a', Buffer.alloc(6));
  cache.set('b', Buffer.alloc(6));

  assert.strictEqual(cache.stats().entries, 1);
  assert.ok(cache.stats().bytes <= 10);
});

test('an entry larger than the whole budget is not stored', () => {
  const cache = new AudioCache({ maxBytes: 10 });
  cache.set('a', Buffer.alloc(4));
  cache.set('huge', Buffer.alloc(999));

  // Storing it would have evicted everything else for no benefit.
  assert.strictEqual(cache.get('huge'), undefined);
  assert.ok(cache.get('a'));
});

test('replacing a key does not double-count its bytes', () => {
  const cache = new AudioCache();
  cache.set('a', Buffer.alloc(100));
  cache.set('a', Buffer.alloc(40));

  assert.strictEqual(cache.stats().entries, 1);
  assert.strictEqual(cache.stats().bytes, 40);
});

test('a disabled cache never stores or returns anything', () => {
  const cache = new AudioCache({ enabled: false });
  cache.set('a', Buffer.from('a'));

  assert.strictEqual(cache.get('a'), undefined);
  assert.strictEqual(cache.stats().entries, 0);
});
