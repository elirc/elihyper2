const { test } = require('node:test');
const assert = require('node:assert');
const request = require('supertest');

const { normaliseProsody, wrapInProsody, escapeXml } = require('../lib/validate');
const { buildApp, createFakePolly } = require('./helpers');

test('defaults are applied and flagged as default', () => {
  const prosody = normaliseProsody({});
  assert.deepStrictEqual(
    { rate: prosody.rate, pitch: prosody.pitch, volume: prosody.volume },
    { rate: 100, pitch: 0, volume: 0 }
  );
  assert.strictEqual(prosody.isDefault, true);
});

test('supplied values are kept and clear the default flag', () => {
  const prosody = normaliseProsody({ rate: 150 });
  assert.strictEqual(prosody.rate, 150);
  assert.strictEqual(prosody.isDefault, false);
});

test('values are rounded to integers', () => {
  assert.strictEqual(normaliseProsody({ rate: 120.7 }).rate, 121);
});

test('out-of-range and non-numeric values are rejected', () => {
  assert.throws(() => normaliseProsody({ rate: 500 }), /rate must be between/);
  assert.throws(() => normaliseProsody({ rate: 10 }), /rate must be between/);
  assert.throws(() => normaliseProsody({ pitch: 'fast' }), /pitch must be a number/);
  assert.throws(() => normaliseProsody({ volume: -100 }), /volume must be between/);
});

test('escapeXml neutralises every character that matters in markup', () => {
  assert.strictEqual(
    escapeXml(`<a href="x">& '</a>`),
    '&lt;a href=&quot;x&quot;&gt;&amp; &apos;&lt;/a&gt;'
  );
});

test('text is escaped before it becomes SSML', () => {
  // Without escaping, this input closes our prosody element and opens its
  // own - arbitrary SSML injection that changes what is spoken.
  const hostile = `</prosody><prosody rate="20%">pwned`;
  const ssml = wrapInProsody(hostile, normaliseProsody({ rate: 150 }));

  assert.ok(ssml.startsWith('<speak><prosody '));
  assert.ok(ssml.endsWith('</prosody></speak>'));
  assert.strictEqual(
    (ssml.match(/<prosody/g) || []).length,
    1,
    'the payload must not have opened a second prosody element'
  );
  assert.ok(ssml.includes('&lt;/prosody&gt;'));
});

test('signed attributes are formatted the way SSML expects', () => {
  const ssml = wrapInProsody('hi', normaliseProsody({ rate: 90, pitch: -10, volume: 5 }));
  assert.ok(ssml.includes('rate="90%"'));
  assert.ok(ssml.includes('pitch="-10%"'));
  assert.ok(ssml.includes('volume="+5dB"'));
});

test('POST /speak wraps plain text when prosody is non-default', async () => {
  let captured = null;
  const polly = createFakePolly({
    synthesize(command) {
      captured = command.input;
      const { Readable } = require('node:stream');
      return { AudioStream: Readable.from([Buffer.from('audio')]) };
    },
  });
  const { app } = buildApp({ polly });

  const res = await request(app).post('/speak').send({ text: 'Hello', prosody: { rate: 150 } });

  assert.strictEqual(res.status, 200);
  assert.strictEqual(captured.TextType, 'ssml');
  assert.ok(captured.Text.includes('rate="150%"'));
});

test('POST /speak leaves default prosody as plain text', async () => {
  let captured = null;
  const polly = createFakePolly({
    synthesize(command) {
      captured = command.input;
      const { Readable } = require('node:stream');
      return { AudioStream: Readable.from([Buffer.from('audio')]) };
    },
  });
  const { app } = buildApp({ polly });

  await request(app).post('/speak').send({ text: 'Hello' });

  assert.strictEqual(captured.TextType, 'text');
  assert.strictEqual(captured.Text, 'Hello');
});

test('POST /speak does not double-wrap text already supplied as SSML', async () => {
  let captured = null;
  const polly = createFakePolly({
    synthesize(command) {
      captured = command.input;
      const { Readable } = require('node:stream');
      return { AudioStream: Readable.from([Buffer.from('audio')]) };
    },
  });
  const { app } = buildApp({ polly });

  await request(app)
    .post('/speak')
    .send({ text: '<speak>Hi</speak>', textType: 'ssml', prosody: { rate: 150 } });

  assert.strictEqual((captured.Text.match(/<speak>/g) || []).length, 1);
});

test('POST /speak rejects out-of-range prosody', async () => {
  const { app } = buildApp();
  const res = await request(app).post('/speak').send({ text: 'hi', prosody: { rate: 999 } });

  assert.strictEqual(res.status, 400);
  assert.match(res.body.error, /rate must be between/);
});

test('changing prosody produces a cache miss rather than stale audio', async () => {
  const { app, polly } = buildApp();
  const body = { text: 'Same words' };

  await request(app).post('/speak').send(body);
  await request(app).post('/speak').send({ ...body, prosody: { rate: 150 } });

  assert.strictEqual(polly.calls.synthesize, 2, 'the second request must not hit cache');
});
