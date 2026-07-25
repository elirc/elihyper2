const { Readable } = require('node:stream');
const { DescribeVoicesCommand, SynthesizeSpeechCommand } = require('@aws-sdk/client-polly');

// Lives outside test/ deliberately. `node --test` with no arguments treats
// every file under a directory named `test` as a test file, so a helper in
// there gets executed as one - inflating the count and turning an import
// error into a confusing test failure.
const { load } = require('../config');
const { createApp } = require('../app');
const { createSignedUrlBuilder } = require('../lib/transcribe-url');

const TEST_ENV = {
  AWS_APP_ID: 'AKIAIOSFODNN7EXAMPLE',
  AWS_APP_SECRET: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY',
  REGION: 'us-east-1',
  RATE_LIMIT_ENABLED: 'false',
  NODE_ENV: 'test',
};

const VOICES = [
  {
    Id: 'Matthew',
    Name: 'Matthew',
    LanguageCode: 'en-US',
    LanguageName: 'US English',
    Gender: 'Male',
    SupportedEngines: ['standard', 'neural', 'generative'],
  },
  {
    Id: 'Lupe',
    Name: 'Lupe',
    LanguageCode: 'es-US',
    LanguageName: 'US Spanish',
    Gender: 'Female',
    SupportedEngines: ['standard', 'neural'],
  },
];

// Deterministic stand-in for real MP3 bytes.
const AUDIO = Buffer.from('ID3-fake-mp3-payload');

function createFakePolly({ synthesize } = {}) {
  const calls = { describeVoices: 0, synthesize: 0 };

  const polly = {
    calls,
    async send(command) {
      if (command instanceof DescribeVoicesCommand) {
        calls.describeVoices += 1;
        return { Voices: VOICES };
      }
      if (command instanceof SynthesizeSpeechCommand) {
        calls.synthesize += 1;
        if (synthesize) return synthesize(command);
        return { AudioStream: Readable.from([AUDIO]) };
      }
      throw new Error(`Unexpected Polly command: ${command.constructor.name}`);
    },
  };

  return polly;
}

function createFakeClaude({ text = 'Four.', onCreate, deltas } = {}) {
  const calls = [];

  return {
    calls,
    messages: {
      async create(params) {
        calls.push({ mode: 'create', params });
        if (onCreate) return onCreate(params);
        return {
          content: [{ type: 'text', text }],
          stop_reason: 'end_turn',
          model: params.model,
          usage: { input_tokens: 10, output_tokens: 3 },
        };
      },
      stream(params) {
        calls.push({ mode: 'stream', params });
        const chunks = deltas ?? [text];
        const iterator = (async function* () {
          for (const chunk of chunks) {
            yield { type: 'content_block_delta', delta: { type: 'text_delta', text: chunk } };
          }
        })();
        return {
          [Symbol.asyncIterator]: () => iterator,
          async finalMessage() {
            return {
              content: [{ type: 'text', text: chunks.join('') }],
              stop_reason: 'end_turn',
              model: params.model,
              usage: { input_tokens: 10, output_tokens: 5 },
            };
          },
        };
      },
    },
  };
}

function buildApp(overrides = {}) {
  const config = load({ ...TEST_ENV, ...(overrides.env ?? {}) });
  const polly = overrides.polly ?? createFakePolly();
  const claude = overrides.claude ?? createFakeClaude();

  // Presigning is pure crypto with no network call, so the real builder runs
  // in tests against throwaway credentials.
  const buildSignedUrl =
    overrides.buildSignedUrl ??
    createSignedUrlBuilder({ credentials: config.credentials, region: config.region });

  const app = createApp({ polly, claude, buildSignedUrl, config, logger: null });
  return { app, polly, claude, config };
}

module.exports = { buildApp, createFakePolly, createFakeClaude, TEST_ENV, VOICES, AUDIO };
