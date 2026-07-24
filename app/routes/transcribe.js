const express = require('express');

const { oneOf } = require('../lib/validate');
const { badRequest } = require('../lib/errors');

function createTranscribeRouter({ buildSignedUrl, config }) {
  const router = express.Router();

  router.get('/transcribe-options', (req, res) => {
    res.json({
      languages: config.transcribe.languages,
      defaultLanguage: config.transcribe.defaultLanguage,
      sampleRates: config.transcribe.sampleRates,
    });
  });

  router.get('/get-signed-url', async (req, res) => {
    const languageCode = oneOf(
      req.query.languageCode,
      config.transcribe.languages,
      'languageCode',
      config.transcribe.defaultLanguage
    );

    // The browser reports the sample rate its AudioContext actually got. When
    // the hardware refuses 16 kHz we tell Transcribe the truth instead of
    // resampling in an audio callback, which is where v1 had a race.
    let sampleRate = 16000;
    if (req.query.sampleRate !== undefined) {
      const requested = Number(req.query.sampleRate);
      if (!Number.isInteger(requested)) {
        throw badRequest('sampleRate must be an integer');
      }
      if (!config.transcribe.sampleRates.includes(requested)) {
        throw badRequest(
          `sampleRate must be one of: ${config.transcribe.sampleRates.join(', ')}`
        );
      }
      sampleRate = requested;
    }

    const identifyPii = req.query.identifyPii === 'true';

    const result = await buildSignedUrl({
      languageCode,
      sampleRate,
      identifyPii,
      expiresIn: config.transcribe.urlExpiresInSeconds,
    });

    // A signed URL is a bearer credential. Never let it be cached anywhere.
    res.set('Cache-Control', 'no-store');
    res.json(result);
  });

  return router;
}

module.exports = { createTranscribeRouter };
