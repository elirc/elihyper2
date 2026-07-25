const express = require('express');
const { SynthesizeSpeechCommand } = require('@aws-sdk/client-polly');

const { AudioCache } = require('../lib/audio-cache');
const { createVoiceCatalogue } = require('../lib/voices');
const {
  normaliseSpeechText,
  normaliseProsody,
  wrapInProsody,
  oneOf,
  PROSODY_LIMITS,
} = require('../lib/validate');
const { badRequest } = require('../lib/errors');

const OUTPUT_FORMAT = 'mp3';
const TEXT_TYPES = ['text', 'ssml'];

async function collect(stream) {
  const chunks = [];
  for await (const chunk of stream) chunks.push(chunk);
  return Buffer.concat(chunks);
}

// Shared with the browser rather than reimplemented here. The module is
// dual-exported for exactly this reason: a filename sanitiser that exists in
// two places will eventually only be fixed in one.
const { filenameFrom } = require('../public/js/filename');

const speechFilename = (text) => filenameFrom(text, 'mp3', { fallback: 'speech' });

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
      prosody: PROSODY_LIMITS,
    });
  });

  router.post('/speak', async (req, res) => {
    const body = req.body ?? {};

    const requestedType = oneOf(body.textType, TEXT_TYPES, 'textType', 'text');
    const text = normaliseSpeechText(body.text, {
      maxCharacters: config.polly.maxCharacters,
      textType: requestedType,
    });

    const prosody = normaliseProsody(body.prosody);

    // Plain text with non-default controls becomes SSML. Text the caller
    // already supplied as SSML is left alone rather than double-wrapped -
    // nesting <speak> is invalid, and re-escaping would break their markup.
    const applyProsody = requestedType === 'text' && !prosody.isDefault;
    const spokenText = applyProsody ? wrapInProsody(text, prosody) : text;
    const textType = applyProsody ? 'ssml' : requestedType;

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

    // Keyed on the text actually sent to Polly, so a change of rate or pitch
    // produces a different key. Keying on the original text would serve
    // audio at the wrong speed from cache.
    const key = AudioCache.key({
      text: spokenText,
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
          ? `attachment; filename="${speechFilename(text)}"`
          : `inline; filename="${speechFilename(text)}"`,
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
        Text: spokenText,
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

module.exports = { createSpeakRouter, speechFilename };
