const path = require('node:path');
const express = require('express');
const cors = require('cors');

const { createLimiter } = require('./middleware/rate-limit');
const { notFound, errorHandler } = require('./middleware/error-handler');
const { createRequestLogger } = require('./lib/logger');
const { AudioCache } = require('./lib/audio-cache');
const { createSpeakRouter } = require('./routes/speak');
const { createClaudeRouter } = require('./routes/claude');
const { createTranscribeRouter } = require('./routes/transcribe');
const { createHealthRouter } = require('./routes/health');

// Dependencies are injected rather than constructed here, so the whole app can
// be exercised in tests with fakes and without AWS credentials.
function createApp({ polly, claude, buildSignedUrl, config, logger }) {
  const app = express();

  if (config.trustProxy) app.set('trust proxy', 1);
  app.disable('x-powered-by');

  if (logger) app.use(createRequestLogger(logger));

  app.use(cors({ origin: config.allowedOrigins }));
  app.use(express.json({ limit: '64kb' }));

  const audioCache = new AudioCache(config.cache);

  app.use(createHealthRouter({ config, audioCache }));

  app.use('/speak', createLimiter({ config, max: config.rateLimit.speak }));
  app.use('/ask-claude', createLimiter({ config, max: config.rateLimit.askClaude }));
  app.use('/get-signed-url', createLimiter({ config, max: config.rateLimit.signedUrl }));

  const speak = createSpeakRouter({ polly, config, cache: audioCache });
  app.use(speak.router);
  app.use(createClaudeRouter({ claude, config }));
  app.use(createTranscribeRouter({ buildSignedUrl, config }));

  app.use(
    express.static(path.join(__dirname, 'public'), {
      index: 'assistant.html',
      extensions: ['html'],
    })
  );

  app.use(notFound);
  app.use(errorHandler);

  return app;
}

module.exports = { createApp };
