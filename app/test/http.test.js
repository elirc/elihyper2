const { test } = require('node:test');
const assert = require('node:assert');

const { createHttp, backoffFor, DEFAULTS } = require('../public/js/http');

// A response stub with only what the retry logic reads.
function reply(status, headers = {}) {
  return {
    status,
    ok: status >= 200 && status < 300,
    headers: { get: (name) => headers[name.toLowerCase()] ?? null },
  };
}

// Records the delays instead of sleeping, so the suite stays fast.
function harness(responses, options = {}) {
  const calls = [];
  const waits = [];
  const retries = [];

  const http = createHttp({
    wait: (ms) => { waits.push(ms); return Promise.resolve(); },
    onRetry: (info) => retries.push(info),
    fetch: async (url, init) => {
      calls.push({ url, init });
      const next = responses[calls.length - 1];
      if (next instanceof Error) throw next;
      return next ?? reply(500);
    },
    ...options,
  });

  return { http, calls, waits, retries };
}

test('a successful response is returned without retrying', async () => {
  const { http, calls } = harness([reply(200)]);
  const response = await http.request('/x');

  assert.strictEqual(response.status, 200);
  assert.strictEqual(calls.length, 1);
});

test('a 503 is retried and the eventual success returned', async () => {
  const { http, calls } = harness([reply(503), reply(503), reply(200)]);
  const response = await http.request('/x');

  assert.strictEqual(response.status, 200);
  assert.strictEqual(calls.length, 3);
});

test('a 400 is never retried', async () => {
  // The request is malformed. Sending it again produces the same rejection
  // three times and delays the error the user needs to see.
  const { http, calls } = harness([reply(400), reply(200)]);
  const response = await http.request('/x');

  assert.strictEqual(response.status, 400);
  assert.strictEqual(calls.length, 1);
});

test('a 413 is never retried', async () => {
  const { http, calls } = harness([reply(413), reply(200)]);
  const response = await http.request('/x');

  assert.strictEqual(response.status, 413);
  assert.strictEqual(calls.length, 1);
});

test('retries stop at the configured attempt count', async () => {
  const { http, calls } = harness([reply(503), reply(503), reply(503), reply(200)]);
  const response = await http.request('/x');

  assert.strictEqual(calls.length, 3, 'default is three attempts total');
  assert.strictEqual(response.status, 503, 'the last response is returned, not thrown');
});

test('backoff grows between attempts', async () => {
  const { http, waits } = harness([reply(503), reply(503), reply(200)]);
  await http.request('/x');

  assert.strictEqual(waits.length, 2);
  assert.ok(waits[1] > waits[0], `expected growth, got ${waits.join(', ')}`);
});

test('Retry-After is honoured over the computed backoff', async () => {
  const { http, waits } = harness([reply(429, { 'retry-after': '7' }), reply(200)]);
  await http.request('/x');

  assert.strictEqual(waits.length, 1);
  assert.strictEqual(waits[0], 7000, 'must use the server-supplied delay exactly');
});

test('a nonsense Retry-After falls back to exponential backoff', async () => {
  const { http, waits } = harness([reply(429, { 'retry-after': 'soon' }), reply(200)]);
  await http.request('/x');

  assert.ok(waits[0] >= DEFAULTS.baseDelayMs);
  assert.ok(waits[0] < DEFAULTS.baseDelayMs + DEFAULTS.jitterMs + 1);
});

test('backoff is capped', () => {
  const delay = backoffFor(20, null, DEFAULTS);
  assert.ok(delay <= DEFAULTS.maxDelayMs + DEFAULTS.jitterMs);
});

test('a network error is retried, then rethrown', async () => {
  const boom = new TypeError('Failed to fetch');
  const { http, calls } = harness([boom, boom, boom]);

  await assert.rejects(() => http.request('/x'), /Failed to fetch/);
  assert.strictEqual(calls.length, 3);
});

test('an abort is never retried', async () => {
  // Aborting is the user pressing stop. Retrying would defeat the point.
  const abort = Object.assign(new Error('aborted'), { name: 'AbortError' });
  const { http, calls } = harness([abort, reply(200)]);

  await assert.rejects(() => http.request('/x'), /aborted/);
  assert.strictEqual(calls.length, 1);
});

test('retry progress is reported to the caller', async () => {
  const { http, retries } = harness([reply(503), reply(200)]);
  await http.request('/x');

  assert.strictEqual(retries.length, 1);
  assert.strictEqual(retries[0].attempt, 1);
  assert.strictEqual(retries[0].of, 3);
  assert.strictEqual(retries[0].reason, 503);
});

test('per-call options override the defaults', async () => {
  const { http, calls } = harness([reply(503), reply(503), reply(503), reply(503), reply(200)]);
  await http.request('/x', {}, { attempts: 5 });

  assert.strictEqual(calls.length, 5);
});
