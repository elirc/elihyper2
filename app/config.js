// Single source of truth for environment configuration.
// Nothing else in this codebase reads process.env directly.

require('dotenv').config();

const REQUIRED = ['AWS_APP_ID', 'AWS_APP_SECRET', 'REGION'];

const TRANSCRIBE_LANGUAGES = [
  'en-US', 'en-GB', 'en-AU', 'es-US', 'es-ES',
  'fr-CA', 'fr-FR', 'de-DE', 'it-IT', 'pt-BR', 'ja-JP', 'ko-KR', 'zh-CN',
];

// Transcribe streaming accepts 8000-48000 Hz. We only advertise the rates a
// browser AudioContext realistically produces.
const TRANSCRIBE_SAMPLE_RATES = [8000, 16000, 22050, 44100, 48000];

function num(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function bool(value, fallback) {
  if (value === undefined || value === '') return fallback;
  return value !== 'false' && value !== '0';
}

function list(value, fallback) {
  if (!value) return fallback;
  return value.split(',').map((s) => s.trim()).filter(Boolean);
}

function load(env = process.env) {
  const missing = REQUIRED.filter((key) => !env[key]);
  if (missing.length > 0) {
    const error = new Error(
      `Missing required environment variables: ${missing.join(', ')}`
    );
    error.missing = missing;
    throw error;
  }

  return Object.freeze({
    port: num(env.PORT, 3000),
    logLevel: env.LOG_LEVEL || 'info',
    nodeEnv: env.NODE_ENV || 'development',

    region: env.REGION,
    credentials: Object.freeze({
      accessKeyId: env.AWS_APP_ID,
      secretAccessKey: env.AWS_APP_SECRET,
    }),

    // Anthropic's Bedrock client resolves credentials through the standard AWS
    // chain, which expects AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY. This repo
    // has always used AWS_APP_ID / AWS_APP_SECRET, so server.js bridges the two
    // names at startup rather than asking operators to set both.
    claudeModelId: env.CLAUDE_MODEL_ID || 'anthropic.claude-opus-5',
    claudeMaxTokens: num(env.CLAUDE_MAX_TOKENS, 16000),
    claudeMaxTokensStreaming: num(env.CLAUDE_MAX_TOKENS_STREAMING, 64000),
    claudeEffort: env.CLAUDE_EFFORT || 'high',

    allowedOrigins: list(env.ALLOWED_ORIGINS, ['http://localhost:3000']),
    trustProxy: bool(env.TRUST_PROXY, false),

    rateLimit: Object.freeze({
      enabled: bool(env.RATE_LIMIT_ENABLED, true),
      windowMs: num(env.RATE_LIMIT_WINDOW_MS, 60_000),
      speak: num(env.RATE_LIMIT_SPEAK, 30),
      askClaude: num(env.RATE_LIMIT_ASK_CLAUDE, 30),
      signedUrl: num(env.RATE_LIMIT_SIGNED_URL, 10),
    }),

    cache: Object.freeze({
      enabled: bool(env.CACHE_ENABLED, true),
      maxEntries: num(env.CACHE_MAX_ENTRIES, 200),
      maxBytes: num(env.CACHE_MAX_BYTES, 50 * 1024 * 1024),
    }),

    polly: Object.freeze({
      defaultVoiceId: env.POLLY_DEFAULT_VOICE || 'Matthew',
      defaultEngine: env.POLLY_DEFAULT_ENGINE || 'generative',
      // Polly bills per character and rejects anything larger.
      maxCharacters: num(env.POLLY_MAX_CHARACTERS, 3000),
      voiceCacheTtlMs: num(env.POLLY_VOICE_CACHE_TTL_MS, 24 * 60 * 60 * 1000),
    }),

    transcribe: Object.freeze({
      // Short-lived on purpose: the browser fetches this immediately before
      // connecting, and the URL grants direct AWS access to whoever holds it.
      urlExpiresInSeconds: num(env.TRANSCRIBE_URL_TTL, 60),
      defaultLanguage: env.TRANSCRIBE_DEFAULT_LANGUAGE || 'en-US',
      languages: TRANSCRIBE_LANGUAGES,
      sampleRates: TRANSCRIBE_SAMPLE_RATES,
    }),

    // Per-million-token rates from the AWS Bedrock pricing page for your
    // region. Bedrock is partner-operated: AWS sets these, and they are not
    // Anthropic's first-party prices. Default 0 means "not configured", and
    // the UI then reports the estimate as unavailable instead of showing $0.
    pricing: Object.freeze({
      inputPerMillion: num(env.PRICE_INPUT_PER_MILLION, 0),
      outputPerMillion: num(env.PRICE_OUTPUT_PER_MILLION, 0),
      cachedInputPerMillion: num(env.PRICE_CACHED_INPUT_PER_MILLION, 0),
    }),

    chat: Object.freeze({
      maxMessages: num(env.CHAT_MAX_MESSAGES, 40),
      maxTotalCharacters: num(env.CHAT_MAX_TOTAL_CHARACTERS, 50_000),
      maxSystemCharacters: num(env.CHAT_MAX_SYSTEM_CHARACTERS, 4000),
    }),
  });
}

module.exports = { load, TRANSCRIBE_LANGUAGES, TRANSCRIBE_SAMPLE_RATES };
