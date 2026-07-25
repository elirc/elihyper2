const { badRequest } = require('./errors');

const ROLES = new Set(['user', 'assistant']);

// Validates and normalises a conversation before it reaches Bedrock.
//
// The Messages API requires the first message to be `user`. Consecutive
// same-role messages are allowed and get merged into one turn, so strict
// alternation is not enforced here.
function normaliseMessages(input, { maxMessages, maxTotalCharacters }) {
  if (!Array.isArray(input)) {
    throw badRequest('messages must be an array');
  }
  if (input.length === 0) {
    throw badRequest('messages must contain at least one message');
  }

  const messages = input.map((message, index) => {
    if (message === null || typeof message !== 'object') {
      throw badRequest(`messages[${index}] must be an object`);
    }
    const { role, content } = message;
    if (!ROLES.has(role)) {
      throw badRequest(`messages[${index}].role must be "user" or "assistant"`);
    }
    if (typeof content !== 'string' || content.trim() === '') {
      throw badRequest(`messages[${index}].content must be a non-empty string`);
    }
    return { role, content };
  });

  const total = messages.reduce((sum, m) => sum + m.content.length, 0);
  if (total > maxTotalCharacters) {
    throw badRequest(
      `conversation is too long (${total} characters, limit ${maxTotalCharacters}). Start a new conversation.`
    );
  }

  // Trim oldest-first, then drop any leading assistant turns so the history
  // still starts with a user message.
  let trimmed = messages.length > maxMessages
    ? messages.slice(messages.length - maxMessages)
    : messages;

  const firstUser = trimmed.findIndex((m) => m.role === 'user');
  if (firstUser === -1) {
    throw badRequest('messages must contain at least one user message');
  }
  trimmed = trimmed.slice(firstUser);

  return trimmed;
}

function normaliseSystemPrompt(tone, { maxSystemCharacters }) {
  if (tone === undefined || tone === null || tone === '') return undefined;
  if (typeof tone !== 'string') {
    throw badRequest('tone must be a string');
  }
  const trimmed = tone.trim();
  if (trimmed === '') return undefined;
  if (trimmed.length > maxSystemCharacters) {
    throw badRequest(
      `tone must be ${maxSystemCharacters} characters or fewer (got ${trimmed.length})`
    );
  }
  return trimmed;
}

function normaliseSpeechText(text, { maxCharacters, textType }) {
  if (typeof text !== 'string' || text.trim() === '') {
    throw badRequest('text is required');
  }
  if (text.length > maxCharacters) {
    throw badRequest(
      `text must be ${maxCharacters} characters or fewer (got ${text.length})`
    );
  }
  if (textType === 'ssml') {
    const trimmed = text.trim();
    if (!trimmed.startsWith('<speak') || !trimmed.endsWith('</speak>')) {
      throw badRequest('SSML must be wrapped in a single <speak> element');
    }
  }
  return text;
}

// Prosody controls, expressed as percentages so they map straight onto SSML.
const PROSODY_LIMITS = {
  rate: { min: 50, max: 200, default: 100 },
  pitch: { min: -50, max: 50, default: 0 },
  volume: { min: -20, max: 20, default: 0 },
};

function normaliseProsody(input = {}) {
  const result = {};
  for (const [name, limits] of Object.entries(PROSODY_LIMITS)) {
    const raw = input[name];
    if (raw === undefined || raw === null || raw === '') {
      result[name] = limits.default;
      continue;
    }
    const value = Number(raw);
    if (!Number.isFinite(value)) {
      throw badRequest(`${name} must be a number`);
    }
    if (value < limits.min || value > limits.max) {
      throw badRequest(`${name} must be between ${limits.min} and ${limits.max}`);
    }
    // Rounded to an integer so the value cannot smuggle anything unusual into
    // an SSML attribute.
    result[name] = Math.round(value);
  }
  result.isDefault =
    result.rate === PROSODY_LIMITS.rate.default &&
    result.pitch === PROSODY_LIMITS.pitch.default &&
    result.volume === PROSODY_LIMITS.volume.default;
  return result;
}

function escapeXml(text) {
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

// Wrapping plain text in SSML turns it into markup, so it MUST be escaped
// first. Without this, a user typing "</prosody><prosody rate='x-slow'>" can
// inject arbitrary SSML and change what is spoken.
//
// The attribute values are built from integers that normaliseProsody has
// already validated - never from raw request strings.
function wrapInProsody(text, prosody) {
  // The unit is a parameter, not baked in: pitch is a percentage and volume
  // is decibels. An earlier version hardcoded '%' here and produced
  // volume="+5%dB", which Polly rejects.
  const signed = (value, unit) => `${value >= 0 ? '+' : ''}${value}${unit}`;

  return (
    `<speak><prosody rate="${prosody.rate}%" pitch="${signed(prosody.pitch, '%')}" ` +
    `volume="${signed(prosody.volume, 'dB')}">${escapeXml(text)}</prosody></speak>`
  );
}

function oneOf(value, allowed, field, fallback) {
  if (value === undefined || value === null || value === '') return fallback;
  if (!allowed.includes(value)) {
    throw badRequest(`${field} must be one of: ${allowed.join(', ')}`);
  }
  return value;
}

module.exports = {
  normaliseMessages,
  normaliseSystemPrompt,
  normaliseSpeechText,
  normaliseProsody,
  wrapInProsody,
  escapeXml,
  oneOf,
  PROSODY_LIMITS,
};
