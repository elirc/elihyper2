// A single registry that both the command palette and the keyboard handler
// read from. Two separate lists would drift, and a shortcut that does not
// appear in the palette is a shortcut nobody discovers.

(function (window, document) {
  'use strict';

  const commands = [];

  const isMac = /mac/i.test(navigator.platform || navigator.userAgent);

  // Normalises a spec like 'mod+k' into something comparable against a real
  // KeyboardEvent. 'mod' is Cmd on macOS and Ctrl everywhere else.
  function parse(shortcut) {
    const parts = shortcut.toLowerCase().split('+').map((p) => p.trim());
    return {
      key: parts[parts.length - 1],
      mod: parts.includes('mod'),
      shift: parts.includes('shift'),
      alt: parts.includes('alt'),
    };
  }

  function matches(event, spec) {
    const parsed = parse(spec);
    const mod = isMac ? event.metaKey : event.ctrlKey;
    return (
      event.key.toLowerCase() === parsed.key &&
      mod === parsed.mod &&
      event.shiftKey === parsed.shift &&
      event.altKey === parsed.alt
    );
  }

  function display(shortcut) {
    return shortcut
      .split('+')
      .map((part) => {
        const p = part.trim().toLowerCase();
        if (p === 'mod') return isMac ? '⌘' : 'Ctrl';
        if (p === 'shift') return 'Shift';
        if (p === 'alt') return isMac ? '⌥' : 'Alt';
        if (p === 'escape') return 'Esc';
        if (p === 'enter') return 'Enter';
        return p.toUpperCase();
      })
      .join(isMac ? '' : '+');
  }

  function register(command) {
    if (!command || !command.id || typeof command.run !== 'function') {
      throw new Error('A command needs an id and a run function');
    }
    const existing = commands.findIndex((c) => c.id === command.id);
    if (existing >= 0) commands.splice(existing, 1);
    commands.push({ available: () => true, ...command });
  }

  const all = () => commands.filter((c) => c.available());

  function run(id) {
    const command = commands.find((c) => c.id === id && c.available());
    if (command) command.run();
    return Boolean(command);
  }

  // A shortcut must not fire while the user is typing, unless it explicitly
  // opts in - otherwise "n" for new conversation eats every letter n.
  function isTyping(target) {
    if (!target) return false;
    const tag = target.tagName;
    return (
      tag === 'INPUT' ||
      tag === 'TEXTAREA' ||
      tag === 'SELECT' ||
      target.isContentEditable === true
    );
  }

  document.addEventListener('keydown', (event) => {
    for (const command of all()) {
      if (!command.shortcut || !matches(event, command.shortcut)) continue;
      if (isTyping(event.target) && !command.worksWhileTyping) continue;
      event.preventDefault();
      command.run();
      return;
    }
  });

  window.Commands = { register, all, run, matches, display, isMac };
})(window, document);
