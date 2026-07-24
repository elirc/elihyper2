const express = require('express');
const { SynthesizeSpeechCommand } = require('@aws-sdk/client-polly');

const { AudioCache } = require('../lib/audio-cache');
const { createVoiceCatalogue } = require('../lib/voices');
const { normaliseSpeechText, oneOf } = require('../lib/validate');
const { badRequest } = require('../lib/errors');

const OUTPUT_FORMAT = 'mp3';
const TEXT_TYPES = ['text', 'ssml'];

async function collect(stream) {
  const chunks = [];
  for await (const chunk of stream) chunks.push(chunk);
  return Buffer.concat(chunks);
}

// Turns "Hello! This is a demo." into "hello-this-is-a-demo".
function filenameFrom(text) {
  const slug = text
    .replace(/<[^>]*>/g, ' ')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
    .replace(/-+$/, '');
  return `${slug || 'speech'}.mp3`;
}

function createSpeakRouter({ polly, config, cache }) {
  const router = express.Router();
  const voices = createVoiceCatalogue({
    polly,
    ttlMs: config.polly.voiceCacheTtlMs,
  });
  const audioCache = cache ?? new AudioCache(config.cache);

  router.get('/voices', async (req, res) => {
    const [list, engines] = await Promise.all([voices.list(), voices.engines()]);
    res.set('Cache-Control', 'public, max-age=3600');
    res.json({
      voices: list,
      engines,
      defaults: {
        voiceId: config.polly.defaultVoiceId,
        engine: config.polly.defaultEngine,
      },
      maxCharacters: config.polly.maxCharacters,
    });
  });

  router.post('/speak', async (req, res) => {
    const body = req.body ?? {};

    const textType = oneOf(body.textType, TEXT_TYPES, 'textType', 'text');
    const text = normaliseSpeechText(body.text, {
      maxCharacters: config.polly.maxCharacters,
      textType,
    });

    const voiceId = body.voiceId ?? config.polly.defaultVoiceId;
    const voice = await voices.find(voiceId);
    if (!voice) {
      throw badRequest(`Unknown voiceId "${voiceId}"`);
    }

    const engine = body.engine ?? config.polly.defaultEngine;
    if (!voice.supportedEngines.includes(engine)) {
      throw badRequest(
        `Voice "${voiceId}" does not support the "${engine}" engine. ` +
          `Supported: ${voice.supportedEngines.join(', ')}`
      );
    }

    const key = AudioCache.key({
      text,
      voiceId,
      engine,
      outputFormat: OUTPUT_FORMAT,
      textType,
      languageCode: voice.languageCode,
    });
    const etag = `"${key}"`;

    // A conditional request costs us nothing at all.
    if (req.headers['if-none-match'] === etag) {
      res.set({ ETag: etag, 'Cache-Control': 'public, max-age=86400' });
      return res.status(304).end();
    }

    const send = (audio, cacheStatus) => {
      res.set({
        'Content-Type': 'audio/mpeg',
        'Content-Length': String(audio.byteLength),
        ETag: etag,
        'Cache-Control': 'public, max-age=86400',
        'X-Cache': cacheStatus,
        'Content-Disposition': body.download
          ? `attachment; filename="${filenameFrom(text)}"`
          : `inline; filename="${filenameFrom(text)}"`,
      });
      return res.end(audio);
    };

    const hit = audioCache.get(key);
    if (hit) {
      req.log?.debug({ key, voiceId, engine }, 'audio cache hit');
      return send(hit.audio, 'HIT');
    }

    const response = await polly.send(
      new SynthesizeSpeechCommand({
        OutputFormat: OUTPUT_FORMAT,
        Text: text,
        TextType: textType,
        VoiceId: voiceId,
        Engine: engine,
      })
    );

    // Buffering rather than piping, so the result can be cached. Polly caps
    // input at a few thousand characters, so these payloads stay small.
    const audio = await collect(response.AudioStream);
    audioCache.set(key, audio, { voiceId, engine, textType });
    req.log?.debug({ key, voiceId, engine, bytes: audio.byteLength }, 'synthesised speech');

    return send(audio, 'MISS');
  });

  return { router, audioCache, voices };
}

module.exports = { createSpeakRouter, filenameFrom };
