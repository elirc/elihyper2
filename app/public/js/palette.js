// Command palette. Builds its own DOM so no page needs markup for it.
//
// The focus handling is the part that is easy to get wrong and the part that
// decides whether this is usable without a mouse: focus moves in on open,
// is trapped while open, and returns to wherever it came from on close.

(function (window, document) {
  'use strict';

  const { register, all, display } = window.Commands;

  let overlay;
  let input;
  let list;
  let previouslyFocused = null;
  let filtered = [];
  let highlighted = 0;

  function build() {
    overlay = document.createElement('div');
    overlay.className = 'palette-overlay';
    overlay.hidden = true;

    const dialog = document.createElement('div');
    dialog.className = 'palette';
    dialog.setAttribute('role', 'dialog');
    dialog.setAttribute('aria-modal', 'true');
    dialog.setAttribute('aria-label', 'Command palette');

    input = document.createElement('input');
    input.type = 'text';
    input.className = 'palette-input';
    input.setAttribute('aria-label', 'Search commands');
    input.setAttribute('aria-controls', 'palette-list');
    input.placeholder = 'Type a command…';
    input.autocomplete = 'off';

    list = document.createElement('ul');
    list.className = 'palette-list';
    list.id = 'palette-list';
    list.setAttribute('role', 'listbox');

    dialog.append(input, list);
    overlay.appendChild(dialog);
    document.body.appendChild(overlay);

    input.addEventListener('input', render);
    input.addEventListener('keydown', onKeyDown);
    overlay.addEventListener('mousedown', (event) => {
      if (event.target === overlay) close();
    });
  }

  function score(command, query) {
    if (!query) return 0;
    const haystack = `${command.label} ${command.hint ?? ''}`.toLowerCase();
    return haystack.includes(query) ? haystack.indexOf(query) : -1;
  }

  function render() {
    const query = input.value.trim().toLowerCase();
    filtered = all()
      .map((command) => ({ command, rank: score(command, query) }))
      .filter((entry) => entry.rank >= 0)
      .sort((a, b) => a.rank - b.rank)
      .map((entry) => entry.command);

    highlighted = 0;
    list.replaceChildren();

    if (filtered.length === 0) {
      const empty = document.createElement('li');
      empty.className = 'palette-empty';
      empty.textContent = 'No matching commands';
      list.appendChild(empty);
      return;
    }

    filtered.forEach((command, index) => {
      const item = document.createElement('li');
      item.className = 'palette-item';
      item.id = `palette-item-${index}`;
      item.setAttribute('role', 'option');
      item.setAttribute('aria-selected', String(index === highlighted));

      const label = document.createElement('span');
      // textContent: command labels are ours, but this list is also where a
      // user-named prompt will appear once STORY-29 lands.
      label.textContent = command.label;
      item.appendChild(label);

      if (command.shortcut) {
        const keys = document.createElement('kbd');
        keys.textContent = display(command.shortcut);
        item.appendChild(keys);
      }

      item.addEventListener('mouseenter', () => highlight(index));
      item.addEventListener('click', () => choose(index));
      list.appendChild(item);
    });

    highlight(0);
  }

  function highlight(index) {
    highlighted = index;
    [...list.children].forEach((child, i) => {
      if (child.classList.contains('palette-item')) {
        child.setAttribute('aria-selected', String(i === index));
        child.classList.toggle('is-highlighted', i === index);
      }
    });
    input.setAttribute('aria-activedescendant', `palette-item-${index}`);
    list.children[index]?.scrollIntoView?.({ block: 'nearest' });
  }

  function choose(index) {
    const command = filtered[index];
    close();
    // After close, so the command sees focus already restored.
    if (command) command.run();
  }

  function onKeyDown(event) {
    if (event.key === 'Escape') {
      event.preventDefault();
      close();
    } else if (event.key === 'ArrowDown') {
      event.preventDefault();
      if (filtered.length) highlight((highlighted + 1) % filtered.length);
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      if (filtered.length) highlight((highlighted - 1 + filtered.length) % filtered.length);
    } else if (event.key === 'Enter') {
      event.preventDefault();
      if (filtered.length) choose(highlighted);
    } else if (event.key === 'Tab') {
      // Only the input is focusable inside the dialog, so trapping Tab is a
      // matter of refusing to let it leave.
      event.preventDefault();
    }
  }

  function open() {
    if (!overlay) build();
    previouslyFocused = document.activeElement;
    overlay.hidden = false;
    input.value = '';
    render();
    input.focus();
  }

  function close() {
    if (!overlay || overlay.hidden) return;
    overlay.hidden = true;
    // Returning focus is what makes this usable with a keyboard. Without it
    // focus lands on <body> and the next Tab starts from the top of the page.
    previouslyFocused?.focus?.();
    previouslyFocused = null;
  }

  const isOpen = () => Boolean(overlay) && !overlay.hidden;

  register({
    id: 'palette.open',
    label: 'Open command palette',
    shortcut: 'mod+k',
    worksWhileTyping: true,
    run: () => (isOpen() ? close() : open()),
  });

  register({
    id: 'palette.shortcuts',
    label: 'Show keyboard shortcuts',
    shortcut: 'mod+/',
    worksWhileTyping: true,
    run() {
      const lines = all()
        .filter((c) => c.shortcut)
        .map((c) => `${display(c.shortcut)}  —  ${c.label}`)
        .join('\n');
      window.alert(`Keyboard shortcuts\n\n${lines}`);
    },
  });

  for (const page of [
    { id: 'go.assistant', label: 'Go to Voice Assistant', href: '/assistant.html' },
    { id: 'go.claude', label: 'Go to Ask Claude', href: '/claude.html' },
    { id: 'go.tts', label: 'Go to Text to Speech', href: '/text-to-speech.html' },
    { id: 'go.transcribe', label: 'Go to Live Transcription', href: '/transcribe.html' },
  ]) {
    register({
      id: page.id,
      label: page.label,
      available: () => window.location.pathname !== page.href,
      run: () => { window.location.href = page.href; },
    });
  }

  window.Palette = { open, close, isOpen };
})(window, document);
