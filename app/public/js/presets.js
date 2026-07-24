// System-prompt presets. Adding one is a single entry here; the dropdown and
// the assistant page both read from this list.
//
// A preset with systemPrompt === null sends no system field at all, which is
// different from sending an empty string.

(function (window) {
  'use strict';

  const PRESETS = [
    {
      id: 'default',
      label: 'Default',
      description: 'No system prompt — the model decides how to answer.',
      systemPrompt: null,
    },
    {
      id: 'concise',
      label: 'Concise',
      description: 'Three sentences maximum, no preamble.',
      systemPrompt:
        'Answer in at most three sentences. No preamble, no caveats, and do not ' +
        'restate the question. Lead with the answer itself.',
    },
    {
      id: 'explainer',
      label: 'Detailed explainer',
      description: 'Thorough, assumes no prior knowledge.',
      systemPrompt:
        'Explain thoroughly for someone new to the topic. Define jargon on first ' +
        'use, give a worked example, and call out the mistake people most often ' +
        'make with this material.',
    },
    {
      id: 'reviewer',
      label: 'Code reviewer',
      description: 'Correctness first, then clarity. Quotes the line.',
      systemPrompt:
        'You are a senior code reviewer. Identify correctness bugs first, then ' +
        'clarity issues. Quote the specific line you are talking about. Do not ' +
        'comment on formatting or naming preferences. If the code is correct, ' +
        'say so plainly rather than inventing findings.',
    },
    {
      id: 'voice',
      label: 'Spoken answer',
      description: 'Written to be heard, not read. Used by the voice assistant.',
      systemPrompt:
        'Your reply will be read aloud by a speech synthesiser. Write for the ear: ' +
        'short sentences, no markdown, no bullet points, no code blocks, no URLs, ' +
        'and no symbols that do not read naturally. Keep it under about six ' +
        'sentences unless asked for more detail.',
    },
    {
      id: 'custom',
      label: 'Custom…',
      description: 'Write your own system prompt.',
      systemPrompt: '',
      custom: true,
    },
  ];

  const MAX_CUSTOM_LENGTH = 4000;
  const STORAGE_KEY = 'nova.preset';

  function byId(id) {
    return PRESETS.find((preset) => preset.id === id);
  }

  function loadSelection() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return { id: 'default', customPrompt: '' };
      const parsed = JSON.parse(raw);
      return {
        id: byId(parsed.id) ? parsed.id : 'default',
        customPrompt: typeof parsed.customPrompt === 'string' ? parsed.customPrompt : '',
      };
    } catch {
      return { id: 'default', customPrompt: '' };
    }
  }

  function saveSelection(selection) {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(selection));
    } catch {
      // Private browsing or a full quota. Not worth interrupting the user.
    }
  }

  // Returns undefined when no system prompt should be sent.
  function resolvePrompt(selection) {
    const preset = byId(selection.id);
    if (!preset) return undefined;
    if (preset.custom) {
      const trimmed = (selection.customPrompt ?? '').trim();
      return trimmed === '' ? undefined : trimmed;
    }
    return preset.systemPrompt ?? undefined;
  }

  window.Presets = {
    PRESETS,
    MAX_CUSTOM_LENGTH,
    byId,
    loadSelection,
    saveSelection,
    resolvePrompt,
  };
})(window);
