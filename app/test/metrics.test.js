const { test } = require('node:test');
const assert = require('node:assert');
const request = require('supertest');

const { createMetrics, percentile } = require('../lib/metrics');
const { buildApp } = require('../test-support/helpers');

test('percentile of an empty set is zero rather than undefined', () => {
  assert.strictEqual(percentile([], 95), 0);
});

test('percentile never indexes past the end', () => {
  // p100 on a 3-element array is the classic off-by-one here.
  const sorted = [1, 2, 3];
  assert.strictEqual(percentile(sorted, 100), 3);
  assert.strictEqual(percentile(sorted, 0), 1);
});

test('percentile works with fewer samples than the reservoir', () => {
  assert.strictEqual(percentile([5], 50), 5);
  assert.strictEqual(percentile([5], 95), 5);
});

test('percentiles are computed by nearest rank', () => {
  const sorted = Array.from({ length: 100 }, (_, i) => i + 1);
  assert.strictEqual(percentile(sorted, 50), 50);
  assert.strictEqual(percentile(sorted, 95), 95);
  assert.strictEqual(percentile(sorted, 99), 99);
});

test('requests and errors are counted per route', () => {
  const metrics = createMetrics();
  metrics.record({ route: 'GET /a', statusCode: 200, durationMs: 10 });
  metrics.record({ route: 'GET /a', statusCode: 500, durationMs: 20 });
  metrics.record({ route: 'GET /b', statusCode: 200, durationMs: 5 });

  const snap = metrics.snapshot();
  assert.strictEqual(snap.totals.requests, 3);
  assert.strictEqual(snap.totals.errors, 1);
  assert.strictEqual(snap.routes['GET /a'].requests, 2);
  assert.strictEqual(snap.routes['GET /a'].errors, 1);
  assert.strictEqual(snap.routes['GET /b'].errors, 0);
});

test('4xx counts as an error alongside 5xx', () => {
  const metrics = createMetrics();
  metrics.record({ route: 'GET /a', statusCode: 404, durationMs: 1 });
  assert.strictEqual(metrics.snapshot().totals.errors, 1);
});

test('status codes are broken out', () => {
  const metrics = createMetrics();
  metrics.record({ route: 'GET /a', statusCode: 200, durationMs: 1 });
  metrics.record({ route: 'GET /a', statusCode: 200, durationMs: 1 });
  metrics.record({ route: 'GET /a', statusCode: 429, durationMs: 1 });

  assert.deepStrictEqual(metrics.snapshot().routes['GET /a'].byStatus, { 200: 2, 429: 1 });
});

test('the latency reservoir is bounded', () => {
  const metrics = createMetrics({ reservoirSize: 10 });
  for (let i = 0; i < 100; i++) {
    metrics.record({ route: 'GET /a', statusCode: 200, durationMs: i });
  }

  const summary = metrics.snapshot().routes['GET /a'];
  assert.strictEqual(summary.requests, 100, 'the counter keeps counting');
  assert.strictEqual(summary.latencyMs.sampled, 10, 'but only 10 durations are retained');
  // The ring buffer holds the most recent ten: 90..99.
  assert.strictEqual(summary.latencyMs.max, 99);
});

test('error rate is zero rather than NaN with no requests', () => {
  const snap = createMetrics().snapshot();
  assert.strictEqual(snap.totals.errorRate, 0);
});

test('GET /metrics reports the requests it has seen', async () => {
  const { app } = buildApp();

  await request(app).get('/health');
  await request(app).get('/definitely-missing');

  const res = await request(app).get('/metrics');
  assert.strictEqual(res.status, 200);
  assert.ok(res.body.totals.requests >= 2);
  assert.ok(res.body.routes);
  assert.strictEqual(res.headers['cache-control'], 'no-store');
});

test('unmatched paths are grouped rather than creating one label each', async () => {
  const { app } = buildApp();

  // Without grouping, each of these would create its own metrics entry and
  // an attacker could grow the map without bound.
  for (const path of ['/nope-1', '/nope-2', '/nope-3']) {
    await request(app).get(path);
  }

  const res = await request(app).get('/metrics');
  const unmatched = Object.keys(res.body.routes).filter((k) => k.includes('(unmatched)'));
  assert.strictEqual(unmatched.length, 1);
  assert.strictEqual(res.body.routes[unmatched[0]].requests, 3);
});

test('the dashboard page is served', async () => {
  const { app } = buildApp();
  const res = await request(app).get('/dashboard.html');

  assert.strictEqual(res.status, 200);
  assert.match(res.text, /Dashboard/);
});
