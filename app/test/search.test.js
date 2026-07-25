const { test } = require('node:test');
const assert = require('node:assert');

const { escapeRegExp, findMatches, searchLines } = require('../public/js/search');

test('a plain query finds every occurrence', () => {
  const matches = findMatches('the cat sat on the mat', 'the');
  assert.strictEqual(matches.length, 2);
  assert.deepStrictEqual(matches[0], { start: 0, end: 3 });
});

test('search is case-insensitive by default and exact when asked', () => {
  assert.strictEqual(findMatches('The THE the', 'the').length, 3);
  assert.strictEqual(findMatches('The THE the', 'the', { caseSensitive: true }).length, 1);
});

test('regex metacharacters in a query are literal, not patterns', () => {
  // Without escaping this throws "Unterminated group" rather than searching.
  assert.doesNotThrow(() => findMatches('a (b) c', '('));
  assert.strictEqual(findMatches('a (b) c', '(').length, 1);

  // A dot must not match every character.
  assert.strictEqual(findMatches('abc a.c', '.').length, 1);
  assert.strictEqual(findMatches('cost is $5', '$5').length, 1);
});

test('escapeRegExp neutralises the full metacharacter set', () => {
  const escaped = escapeRegExp('.*+?^${}()|[]\\');
  assert.doesNotThrow(() => new RegExp(escaped));
  assert.ok(new RegExp(escaped).test('.*+?^${}()|[]\\'));
});

test('an empty query matches nothing rather than everything', () => {
  assert.deepStrictEqual(findMatches('some text', ''), []);
  assert.deepStrictEqual(findMatches('some text', null), []);
});

test('missing text is handled without throwing', () => {
  assert.deepStrictEqual(findMatches(undefined, 'x'), []);
});

test('searchLines reports which line each match came from', () => {
  const lines = [
    { text: 'first line about cats' },
    { text: 'second line' },
    { text: 'third line about cats and cats' },
  ];
  const results = searchLines(lines, 'cats');

  assert.strictEqual(results.length, 3);
  assert.deepStrictEqual(results.map((r) => r.lineIndex), [0, 2, 2]);
});

test('searchLines returns nothing for a query that is not present', () => {
  assert.deepStrictEqual(searchLines([{ text: 'hello' }], 'goodbye'), []);
});

test('overlapping-looking queries do not double count', () => {
  // 'aa' in 'aaaa' matches at 0 and 2, not at 0,1,2 - matchAll advances past
  // each match rather than by one character.
  const matches = findMatches('aaaa', 'aa');
  assert.deepStrictEqual(matches.map((m) => m.start), [0, 2]);
});
