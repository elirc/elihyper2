const { test } = require('node:test');
const assert = require('node:assert');
const request = require('supertest');

const { buildApp, createFakePolly, createFakeClaude, AUDIO } = require('./helpers');

// ---- health -----------------------------------------------------------------

test('GET /health returns ok without touching AWS', async () => {
  const { app, polly, claude } = buildApp();
  const res = await request(app).get('/health');

  assert.strictEqual(res.status, 200);
  assert.strictEqual(res.body.status, 'ok');
  assert.strictEqual(res.body.region, 'us-east-1');
  assert.ok(res.body.cache);
  assert.strictEqual(polly.calls.describeVoices, 0);
  assert.strictEqual(polly.calls.synthesize, 0);
  assert.strictEqual(claude.calls.length, 0);
});

// ---- /ask-claude ------------------------------------------------------------

test('POST /ask-claude answers a plain string message', async () => {
  // This is the exact shape the v1 UI sent, which v1 could not parse.
  const { app, claude } = buildApp({ claude: createFakeClaude({ text: 'Four.' }) });
  const res = await request(app).post('/ask-claude').send({ message: 'What is 2+2?' });

  assert.strictEqual(res.status, 200);
  assert.strictEqual(res.body.completion, 'Four.');
  assert.deepStrictEqual(claude.calls[0].params.messages, [
    { role: 'user', content: 'What is 2+2?' },
  ]);
});

test('POST /ask-claude accepts a multi-turn messages array', async () => {
  const { app, claude } = buildApp();
  const res = await request(app)
    .post('/ask-claude')
    .send({
      messages: [
        { role: 'user', content: 'What is the capital of France?' },
        { role: 'assistant', content: 'Paris.' },
        { role: 'user', content: 'And in Spanish?' },
      ],
    });

  assert.strictEqual(res.status, 200);
  assert.strictEqual(claude.calls[0].params.messages.length, 3);
});

test('POST /ask-claude rejects an empty message', async () => {
  const { app, claude } = buildApp();
  const res = await request(app).post('/ask-claude').send({ message: '   ' });

  assert.strictEqual(res.status, 400);
  assert.match(res.body.error, /non-empty string/);
  assert.strictEqual(claude.calls.length, 0, 'must not call Bedrock');
});

test('POST /ask-claude rejects a missing body', async () => {
  const { app } = buildApp();
  const res = await request(app).post('/ask-claude').send({});

  assert.strictEqual(res.status, 400);
  assert.match(res.body.error, /required/);
});

test('POST /ask-claude rejects an invalid role', async () => {
  const { app } = buildApp();
  const res = await request(app)
    .post('/ask-claude')
    .send({ messages: [{ role: 'system', content: 'hi' }] });

  assert.strictEqual(res.status, 400);
  assert.match(res.body.error, /role/);
});

test('POST /ask-claude rejects an over-long conversation', async () => {
  const { app } = buildApp();
  const res = await request(app)
    .post('/ask-claude')
    .send({ messages: [{ role: 'user', content: 'x'.repeat(50_001) }] });

  assert.strictEqual(res.status, 400);
  assert.match(res.body.error, /too long/);
});

test('POST /ask-claude trims history to the newest turns, keeping a user first', async () => {
  const { app, claude } = buildApp({ env: { CHAT_MAX_MESSAGES: '4' } });
  const messages = [];
  for (let i = 0; i < 10; i++) {
    messages.push({ role: i % 2 === 0 ? 'user' : 'assistant', content: `turn ${i}` });
  }

  const res = await request(app).post('/ask-claude').send({ messages });
  assert.strictEqual(res.status, 200);

  const sent = claude.calls[0].params.messages;
  assert.ok(sent.length <= 4);
  assert.strictEqual(sent[0].role, 'user');
});

test('POST /ask-claude passes a system prompt only when non-empty', async () => {
  const { app, claude } = buildApp();

  await request(app).post('/ask-claude').send({ message: 'hi', tone: '   ' });
  assert.ok(!('system' in claude.calls[0].params), 'blank tone must be omitted entirely');

  await request(app).post('/ask-claude').send({ message: 'hi', tone: 'Be terse.' });
  assert.strictEqual(claude.calls[1].params.system, 'Be terse.');
});

test('POST /ask-claude rejects an over-long system prompt', async () => {
  const { app } = buildApp();
  const res = await request(app)
    .post('/ask-claude')
    .send({ message: 'hi', tone: 'x'.repeat(4001) });

  assert.strictEqual(res.status, 400);
  assert.match(res.body.error, /4000 characters/);
});

test('POST /ask-claude?stream=1 emits SSE deltas then done', async () => {
  const { app } = buildApp({
    claude: createFakeClaude({ deltas: ['Hello', ', ', 'world.'] }),
  });

  const res = await request(app).post('/ask-claude?stream=1').send({ message: 'hi' });

  assert.strictEqual(res.status, 200);
  assert.match(res.headers['content-type'], /text\/event-stream/);

  const frames = res.text
    .split('\n\n')
    .filter(Boolean)
    .map((frame) => JSON.parse(frame.replace(/^data: /, '')));

  assert.deepStrictEqual(
    frames.filter((f) => f.type === 'delta').map((f) => f.text),
    ['Hello', ', ', 'world.']
  );
  assert.strictEqual(frames.at(-1).type, 'done');
  assert.strictEqual(frames.at(-1).stopReason, 'end_turn');
});

test('every SSE frame is terminated with a blank line', async () => {
  // Without the trailing blank line the browser buffers the frame forever.
  const { app } = buildApp({ claude: createFakeClaude({ deltas: ['a', 'b'] }) });
  const res = await request(app).post('/ask-claude?stream=1').send({ message: 'hi' });

  for (const line of res.text.split('\n\n').filter(Boolean)) {
    assert.match(line, /^data: /);
  }
  assert.ok(res.text.endsWith('\n\n'));
});

// ---- /voices and /speak -----------------------------------------------------

test('GET /voices returns voices with their supported engines', async () => {
  const { app } = buildApp();
  const res = await request(app).get('/voices');

  assert.strictEqual(res.status, 200);
  assert.strictEqual(res.body.voices.length, 2);
  assert.deepStrictEqual(res.body.voices[0].supportedEngines.includes('neural'), true);
  assert.strictEqual(res.body.defaults.voiceId, 'Matthew');
});

test('GET /voices only calls DescribeVoices once thanks to the catalogue cache', async () => {
  const { app, polly } = buildApp();
  await request(app).get('/voices');
  await request(app).get('/voices');

  assert.strictEqual(polly.calls.describeVoices, 1);
});

test('POST /speak returns audio/mpeg', async () => {
  const { app } = buildApp();
  const res = await request(app)
    .post('/speak')
    .send({ text: 'Hello there.' })
    .buffer()
    .parse((response, callback) => {
      const chunks = [];
      response.on('data', (chunk) => chunks.push(chunk));
      response.on('end', () => callback(null, Buffer.concat(chunks)));
    });

  assert.strictEqual(res.status, 200);
  assert.strictEqual(res.headers['content-type'], 'audio/mpeg');
  assert.ok(res.headers.etag);
  assert.ok(res.body.equals(AUDIO));
});

test('POST /speak rejects empty text without calling Polly', async () => {
  const { app, polly } = buildApp();
  const res = await request(app).post('/speak').send({ text: '   ' });

  assert.strictEqual(res.status, 400);
  assert.match(res.body.error, /text is required/);
  assert.strictEqual(polly.calls.synthesize, 0);
});

test('POST /speak rejects text over the character limit', async () => {
  const { app } = buildApp();
  const res = await request(app).post('/speak').send({ text: 'x'.repeat(3001) });

  assert.strictEqual(res.status, 400);
  assert.match(res.body.error, /3000 characters or fewer/);
});

test('POST /speak rejects an unknown voice', async () => {
  const { app } = buildApp();
  const res = await request(app).post('/speak').send({ text: 'hi', voiceId: 'Nobody' });

  assert.strictEqual(res.status, 400);
  assert.match(res.body.error, /Unknown voiceId/);
});

test('POST /speak rejects a voice and engine that do not go together', async () => {
  // Lupe supports standard and neural, but not generative.
  const { app } = buildApp();
  const res = await request(app)
    .post('/speak')
    .send({ text: 'hola', voiceId: 'Lupe', engine: 'generative' });

  assert.strictEqual(res.status, 400);
  assert.match(res.body.error, /does not support/);
});

test('POST /speak rejects SSML that is not wrapped in <speak>', async () => {
  const { app } = buildApp();
  const res = await request(app)
    .post('/speak')
    .send({ text: 'Hello <break time="500ms"/>', textType: 'ssml' });

  assert.strictEqual(res.status, 400);
  assert.match(res.body.error, /<speak>/);
});

test('POST /speak accepts well-formed SSML', async () => {
  const { app, polly } = buildApp();
  const res = await request(app)
    .post('/speak')
    .send({ text: '<speak>Hello <break time="500ms"/> there.</speak>', textType: 'ssml' });

  assert.strictEqual(res.status, 200);
  assert.strictEqual(polly.calls.synthesize, 1);
});

test('POST /speak serves the second identical request from cache', async () => {
  const { app, polly } = buildApp();
  const body = { text: 'Cache me.', voiceId: 'Matthew', engine: 'neural' };

  const collect = (response, callback) => {
    const chunks = [];
    response.on('data', (chunk) => chunks.push(chunk));
    response.on('end', () => callback(null, Buffer.concat(chunks)));
  };

  const first = await request(app).post('/speak').send(body).buffer().parse(collect);
  const second = await request(app).post('/speak').send(body).buffer().parse(collect);

  assert.strictEqual(first.headers['x-cache'], 'MISS');
  assert.strictEqual(second.headers['x-cache'], 'HIT');
  assert.strictEqual(polly.calls.synthesize, 1, 'Polly must only be billed once');
  assert.ok(first.body.equals(second.body), 'cached bytes must be identical');
});

test('POST /speak honours If-None-Match with a 304', async () => {
  const { app, polly } = buildApp();
  const body = { text: 'Conditional.' };

  const first = await request(app).post('/speak').send(body);
  const etag = first.headers.etag;
  assert.ok(etag);

  const second = await request(app).post('/speak').set('If-None-Match', etag).send(body);

  assert.strictEqual(second.status, 304);
  assert.strictEqual(polly.calls.synthesize, 1);
});

test('POST /speak with download set marks the response as an attachment', async () => {
  const { app } = buildApp();
  const res = await request(app)
    .post('/speak')
    .send({ text: 'Hello! This is a demo.', download: true });

  assert.match(res.headers['content-disposition'], /^attachment;/);
  assert.match(res.headers['content-disposition'], /hello-this-is-a-demo\.mp3/);
});

// ---- /get-signed-url --------------------------------------------------------

test('GET /get-signed-url returns a signed wss URL', async () => {
  const { app } = buildApp();
  const res = await request(app).get('/get-signed-url');

  assert.strictEqual(res.status, 200);
  assert.match(res.body.url, /^wss:\/\/transcribestreaming\.us-east-1\.amazonaws\.com:8443\//);
  assert.match(res.body.url, /X-Amz-Signature=/);
  assert.match(res.body.url, /X-Amz-Credential=/);
  assert.match(res.body.url, /language-code=en-US/);
  assert.strictEqual(res.body.sampleRate, 16000);
  assert.ok(res.body.sessionId);
});

test('GET /get-signed-url is never cached', async () => {
  const { app } = buildApp();
  const res = await request(app).get('/get-signed-url');

  // The URL is a bearer credential.
  assert.strictEqual(res.headers['cache-control'], 'no-store');
});

test('GET /get-signed-url honours language and sample rate', async () => {
  const { app } = buildApp();
  const res = await request(app).get('/get-signed-url?languageCode=fr-CA&sampleRate=44100');

  assert.strictEqual(res.status, 200);
  assert.match(res.body.url, /language-code=fr-CA/);
  assert.match(res.body.url, /media-sample-rate-hertz=44100/);
  assert.strictEqual(res.body.sampleRate, 44100);
});

test('GET /get-signed-url rejects an unsupported language', async () => {
  const { app } = buildApp();
  const res = await request(app).get('/get-signed-url?languageCode=xx-XX');

  assert.strictEqual(res.status, 400);
  assert.match(res.body.error, /languageCode must be one of/);
});

test('GET /get-signed-url rejects an unsupported sample rate', async () => {
  const { app } = buildApp();
  const res = await request(app).get('/get-signed-url?sampleRate=12345');

  assert.strictEqual(res.status, 400);
  assert.match(res.body.error, /sampleRate must be one of/);
});

test('GET /transcribe-options lists the supported languages', async () => {
  const { app } = buildApp();
  const res = await request(app).get('/transcribe-options');

  assert.strictEqual(res.status, 200);
  assert.ok(res.body.languages.includes('en-US'));
  assert.strictEqual(res.body.defaultLanguage, 'en-US');
});

// ---- error handling ---------------------------------------------------------

test('an unknown route returns a JSON 404', async () => {
  const { app } = buildApp();
  const res = await request(app).get('/definitely-not-a-route');

  assert.strictEqual(res.status, 404);
  assert.strictEqual(res.body.error, 'Not found');
});

test('an upstream failure returns a generic 500 with no internal detail', async () => {
  const polly = createFakePolly({
    synthesize() {
      throw new Error('AccessDeniedException: arn:aws:iam::123456789012:user/secret');
    },
  });
  const { app } = buildApp({ polly });

  const res = await request(app).post('/speak').send({ text: 'boom' });

  assert.strictEqual(res.status, 500);
  assert.strictEqual(res.body.error, 'Internal server error');
  const body = JSON.stringify(res.body);
  assert.ok(!body.includes('AccessDenied'), 'must not leak the AWS error');
  assert.ok(!body.includes('arn:aws'), 'must not leak account detail');
  assert.ok(!body.includes('stack'), 'must not leak a stack trace');
});

test('a rejected promise in a handler is caught by the error middleware', async () => {
  const claude = createFakeClaude({
    onCreate() {
      return Promise.reject(new Error('ThrottlingException'));
    },
  });
  const { app } = buildApp({ claude });

  const res = await request(app).post('/ask-claude').send({ message: 'hi' });

  assert.strictEqual(res.status, 500);
  assert.strictEqual(res.body.error, 'Internal server error');
});

// ---- static -----------------------------------------------------------------

test('the four pages are served', async () => {
  const { app } = buildApp();
  for (const page of ['assistant', 'claude', 'text-to-speech', 'transcribe']) {
    const res = await request(app).get(`/${page}.html`);
    assert.strictEqual(res.status, 200, `${page}.html should be served`);
    assert.match(res.headers['content-type'], /text\/html/);
  }
});

test('the root path serves the voice assistant', async () => {
  const { app } = buildApp();
  const res = await request(app).get('/');

  assert.strictEqual(res.status, 200);
  assert.match(res.text, /Voice Assistant/);
});
