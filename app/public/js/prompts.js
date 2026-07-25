// Saved, reusable prompts with {{variable}} placeholders.
//
// Distinct from presets.js: a preset is the assistant's persona (the system
// prompt), a prompt is the user's reusable question. Presets are fixed in
// source; these are the user's own and are editable at runtime.
//
// Storage is injected for the same reason as conversations.js - so the whole
// module tests under Node.

(function (root) {
  'use strict';

  const SCHEMA_VERSION = 1;
  const STORAGE_KEY = 'nova.prompts';
  const VARIABLE = /\{\{(\w+)\}\}/g;

  // Deliberately dumb. A template language here would be scope creep, and
  // \w+ cannot express anything that needs escaping later.
  function variablesIn(body) {
    const names = new Set();
    for (const match of String(body ?? '').matchAll(VARIABLE)) names.add(match[1]);
    return [...names];
  }

  function fill(body, values = {}) {
    return String(body ?? '').replace(VARIABLE, (whole, name) =>
      Object.prototype.hasOwnProperty.call(values, name) ? values[name] : whole
    );
  }

  const DEFAULTS = [
    {
      id: 'builtin-explain',
      name: 'Explain this code',
      body: 'Explain what this code does, then point out anything that looks wrong:\n\n{{code}}',
    },
    {
      id: 'builtin-commit',
      name: 'Write a commit message',
      body:
        'Write a Conventional Commits message for this diff. Subject in the ' +
        'imperative under 72 characters; body explaining why rather than what.\n\n{{diff}}',
    },
    {
      id: 'builtin-summarise',
      name: 'Summarise for a teammate',
      body:
        'Summarise the following for a colleague who has not seen it. Lead with ' +
        'the outcome, then the detail that changes what they would do next.\n\n{{text}}',
    },
  ];

  function createPromptStore({ storage, key = STORAGE_KEY, newId } = {}) {
    if (!storage) throw new Error('createPromptStore requires a storage backend');
    const nextId = newId ?? (() => globalThis.crypto.randomUUID());

    function read() {
      let raw;
      try { raw = storage.getItem(key); } catch { return null; }
      if (!raw) return null;

      let parsed;
      try { parsed = JSON.parse(raw); } catch { return null; }
      if (!parsed || parsed.version !== SCHEMA_VERSION || !Array.isArray(parsed.prompts)) {
        return null;
      }
      return parsed.prompts.filter(
        (p) => p && typeof p.id === 'string' && typeof p.name === 'string' && typeof p.body === 'string'
      );
    }

    function write(prompts) {
      try {
        storage.setItem(key, JSON.stringify({ version: SCHEMA_VERSION, prompts }));
        return true;
      } catch {
        return false;
      }
    }

    // Seeded on first read rather than on construction, so an empty box is
    // never the first thing a user sees.
    function list() {
      const stored = read();
      if (stored === null) {
        write(DEFAULTS);
        return DEFAULTS.slice();
      }
      return stored;
    }

    function get(id) {
      return list().find((prompt) => prompt.id === id) ?? null;
    }

    function save({ id, name, body }) {
      const prompts = list();
      const cleanName = (name ?? '').trim() || 'Untitled prompt';
      const existing = id ? prompts.find((p) => p.id === id) : null;

      if (existing) {
        existing.name = cleanName;
        existing.body = body ?? '';
      } else {
        prompts.push({ id: nextId(), name: cleanName, body: body ?? '' });
      }
      write(prompts);
      return prompts;
    }

    function remove(id) {
      const prompts = list();
      const remaining = prompts.filter((prompt) => prompt.id !== id);
      if (remaining.length === prompts.length) return false;
      write(remaining);
      return true;
    }

    function toJson() {
      return JSON.stringify({ version: SCHEMA_VERSION, prompts: list() }, null, 2);
    }

    // Same posture as conversation import: validate, take only the fields we
    // understand, reject rather than repair.
    function fromJson(text) {
      let parsed;
      try { parsed = JSON.parse(String(text ?? '')); } catch {
        return { ok: false, error: 'That file is not valid JSON.' };
      }
      if (!parsed || parsed.version !== SCHEMA_VERSION || !Array.isArray(parsed.prompts)) {
        return { ok: false, error: 'That file does not contain a prompt library.' };
      }

      const incoming = [];
      for (const prompt of parsed.prompts) {
        if (!prompt || typeof prompt.name !== 'string' || typeof prompt.body !== 'string') {
          return { ok: false, error: 'That file contains a prompt in an unexpected format.' };
        }
        incoming.push({ id: nextId(), name: prompt.name, body: prompt.body });
      }

      write(list().concat(incoming));
      return { ok: true, imported: incoming.length };
    }

    return { list, get, save, remove, toJson, fromJson };
  }

  const api = { createPromptStore, variablesIn, fill, DEFAULTS, SCHEMA_VERSION, STORAGE_KEY };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.Prompts = api;
})(typeof window !== 'undefined' ? window : null);
