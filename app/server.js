const { PollyClient } = require('@aws-sdk/client-polly');
const { AnthropicBedrockMantle } = require('@anthropic-ai/bedrock-sdk');

const { load } = require('./config');
const { createApp } = require('./app');
const { createLogger } = require('./lib/logger');
const { createSignedUrlBuilder } = require('./lib/transcribe-url');

function main() {
  let config;
  try {
    config = load();
  } catch (err) {
    console.error(err.message);
    console.error('Copy .env.example to .env and fill in the values.');
    process.exit(1);
  }

  const logger = createLogger({
    level: config.logLevel,
    pretty: config.nodeEnv === 'development',
  });

  // The Anthropic Bedrock client reads the standard AWS environment variables.
  // This project has always used AWS_APP_ID / AWS_APP_SECRET, so bridge the
  // names here rather than making operators define both pairs.
  process.env.AWS_ACCESS_KEY_ID ??= config.credentials.accessKeyId;
  process.env.AWS_SECRET_ACCESS_KEY ??= config.credentials.secretAccessKey;
  process.env.AWS_REGION ??= config.region;

  // AWS SDK clients are designed to be long-lived singletons: one connection
  // pool, one credential resolver, reused across every request.
  const polly = new PollyClient({
    region: config.region,
    credentials: config.credentials,
  });

  const claude = new AnthropicBedrockMantle({ awsRegion: config.region });

  const buildSignedUrl = createSignedUrlBuilder({
    credentials: config.credentials,
    region: config.region,
  });

  const app = createApp({ polly, claude, buildSignedUrl, config, logger });

  const server = app.listen(config.port, () => {
    logger.info(
      { port: config.port, region: config.region, model: config.claudeModelId },
      `Listening on http://localhost:${config.port}`
    );
  });

  const shutdown = (signal) => () => {
    logger.info({ signal }, 'Shutting down');
    server.close(() => process.exit(0));
    // Do not let a hung connection block the exit forever.
    setTimeout(() => process.exit(1), 10_000).unref();
  };
  process.on('SIGTERM', shutdown('SIGTERM'));
  process.on('SIGINT', shutdown('SIGINT'));

  return server;
}

if (require.main === module) {
  main();
}

module.exports = { main };
