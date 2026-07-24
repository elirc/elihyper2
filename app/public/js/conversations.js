// Persistent conversation storage.
//
// The storage backend is injected rather than reaching for localStorage
// directly, so the whole store runs under Node in tests with a Map-backed fake.
// That is the only reason this file has no browser API in it.
//
// Deliberately client-side: there is no user authentication in this app, so
// there is no correct owner for server-side conversation data yet.

(function (root) {
  'use strict';

  const SCHEMA_VERSION = 1;
  const STORAGE_KEY = 'nova.conversations';
  const MAX_CONVERSATIONS = 50;
  const MAX_TITLE_LENGTH = 50;

  function titleFrom(message) {
    const oneLine = (message ?? '').replace(/\s+/g, ' ').trim();
    if (oneLine === '') return 'Untitled conversation';
    return oneLine.length <= MAX_TITLE_LENGTH
      ? oneLine
      : `${oneLine.slice(0, MAX_TITLE_LENGTH - 1).trimEnd()}…`;
  }

  function createConversationStore(options = {}) {
    const {
      storage,
      key = STORAGE_KEY,
      maxConversations = MAX_CONVERSATIONS,
      now = () => Date.now(),
      newId = () => globalThis.crypto.randomUUID(),
      onEviction = () => {},
    } = options;

    if (!storage) throw new Error('createConversationStore requires a storage backend');

    function readAll() {
      let raw;
      try {
        raw = storage.getItem(key);
      } catch {
        return [];
      }
      if (!raw) return [];

      let parsed;
      try {
        parsed = JSON.parse(raw);
      } catch {
        // Corrupt payload. Discarding beats throwing on every page load.
        return [];
      }

      // An unrecognised version is discarded rather than guessed at. When a
      // migration is genuinely needed it belongs here, explicitly.
      if (!parsed || parsed.version !== SCHEMA_VERSION || !Array.isArray(parsed.conversations)) {
        return [];
      }
      return parsed.conversations.filter(isValidConversation);
    }

    function writeAll(conversations) {
      const payload = { version: SCHEMA_VERSION, conversations };
      try {
        storage.setItem(key, JSON.stringify(payload));
        return { ok: true, evicted: 0 };
      } catch (err) {
        if (err && err.name === 'QuotaExceededError') {
          // Drop the oldest half rather than throwing and losing the turn the
          // user just had. Losing old history beats losing current work.
          const keep = conversations
            .slice()
            .sort((a, b) => b.updatedAt - a.updatedAt)
            .slice(0, Math.max(1, Math.floor(conversations.length / 2)));
          try {
            storage.setItem(key, JSON.stringify({ version: SCHEMA_VERSION, conversations: keep }));
            const evicted = conversations.length - keep.length;
            onEviction(evicted);
            return { ok: true, evicted };
          } catch {
            return { ok: false, evicted: 0 };
          }
        }
        return { ok: false, evicted: 0 };
      }
    }

    function isValidConversation(candidate) {
      return (
        candidate &&
        typeof candidate.id === 'string' &&
        typeof candidate.title === 'string' &&
        Number.isFinite(candidate.createdAt) &&
        Number.isFinite(candidate.updatedAt) &&
        Array.isArray(candidate.messages) &&
        candidate.messages.every(
          (m) =>
            m &&
            (m.role === 'user' || m.role === 'assistant') &&
            typeof m.content === 'string'
        )
      );
    }

    // Summaries only - the full message arrays are not needed to render a list
    // and copying them all on every render is wasted work.
    function list() {
      return readAll()
        .sort((a, b) => b.updatedAt - a.updatedAt)
        .map(({ id, title, createdAt, updatedAt, messages }) => ({
          id,
          title,
          createdAt,
          updatedAt,
          messageCount: messages.length,
        }));
    }

    function get(id) {
      return readAll().find((conversation) => conversation.id === id) ?? null;
    }

    // Created on the first message, never on page load, so empty shells cannot
    // accumulate every time someone opens the tab.
    function create(firstUserMessage, messages = []) {
      const timestamp = now();
      const conversation = {
        id: newId(),
        title: titleFrom(firstUserMessage),
        createdAt: timestamp,
        updatedAt: timestamp,
        messages,
      };

      const all = readAll();
      all.push(conversation);
      const trimmed = all
        .sort((a, b) => b.updatedAt - a.updatedAt)
        .slice(0, maxConversations);
      if (trimmed.length < all.length) onEviction(all.length - trimmed.length);

      writeAll(trimmed);
      return conversation;
    }

    function save(id, messages) {
      const all = readAll();
      const existing = all.find((conversation) => conversation.id === id);
      if (!existing) return null;

      existing.messages = messages;
      existing.updatedAt = now();
      writeAll(all);
      return existing;
    }

    function rename(id, title) {
      const all = readAll();
      const existing = all.find((conversation) => conversation.id === id);
      if (!existing) return null;

      const cleaned = (title ?? '').replace(/\s+/g, ' ').trim();
      existing.title = cleaned === '' ? 'Untitled conversation' : cleaned.slice(0, 200);
      existing.updatedAt = now();
      writeAll(all);
      return existing;
    }

    function remove(id) {
      const all = readAll();
      const remaining = all.filter((conversation) => conversation.id !== id);
      if (remaining.length === all.length) return false;
      writeAll(remaining);
      return true;
    }

    function clear() {
      writeAll([]);
    }

    return { list, get, create, save, rename, remove, clear };
  }

  // --- export / import -----------------------------------------------------

  function toMarkdown(conversation, { model = 'unknown', exportedAt = new Date() } = {}) {
    const lines = [
      `# ${conversation.title}`,
      '',
      `_Exported ${exportedAt.toISOString().slice(0, 16).replace('T', ' ')} · model: ${model}_`,
      '',
    ];

    for (const message of conversation.messages) {
      lines.push(message.role === 'user' ? '## You' : '## Claude', '', message.content, '');
    }

    return lines.join('\n').trimEnd() + '\n';
  }

  function toJson(conversation) {
    return JSON.stringify({ version: SCHEMA_VERSION, conversation }, null, 2);
  }

  // Import is untrusted input: it is a file the user picked, and there is no
  // guarantee this app wrote it. Validate the shape before anything is stored,
  // and reject rather than repair - a half-understood record is worse than a
  // clear error.
  const MAX_IMPORT_BYTES = 5 * 1024 * 1024;
  const MAX_IMPORT_MESSAGES = 2000;

  function fromJson(text) {
    if (typeof text !== 'string') return { ok: false, error: 'Not a text file.' };
    if (text.length > MAX_IMPORT_BYTES) {
      return { ok: false, error: 'That file is too large to import.' };
    }

    let parsed;
    try {
      parsed = JSON.parse(text);
    } catch {
      return { ok: false, error: 'That file is not valid JSON.' };
    }

    if (!parsed || parsed.version !== SCHEMA_VERSION) {
      return { ok: false, error: 'That file was exported by a different version of this app.' };
    }

    const conversation = parsed.conversation;
    if (!conversation || typeof conversation !== 'object' || !Array.isArray(conversation.messages)) {
      return { ok: false, error: 'That file does not contain a conversation.' };
    }
    if (conversation.messages.length > MAX_IMPORT_MESSAGES) {
      return { ok: false, error: 'That conversation has too many messages to import.' };
    }

    const messages = [];
    for (const message of conversation.messages) {
      if (
        !message ||
        (message.role !== 'user' && message.role !== 'assistant') ||
        typeof message.content !== 'string'
      ) {
        return { ok: false, error: 'That conversation contains a message in an unexpected format.' };
      }
      // Only role and content are carried over. Anything else in the file is
      // discarded rather than trusted into our store.
      messages.push({ role: message.role, content: message.content });
    }

    return {
      ok: true,
      title: typeof conversation.title === 'string' ? conversation.title : '',
      messages,
    };
  }

  const api = {
    createConversationStore,
    titleFrom,
    toMarkdown,
    toJson,
    fromJson,
    SCHEMA_VERSION,
    STORAGE_KEY,
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.Conversations = api;
})(typeof window !== 'undefined' ? window : null);
