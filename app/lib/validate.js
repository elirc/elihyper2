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
  oneOf,
};
