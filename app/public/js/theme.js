// Theme preference: system, light, or dark.
//
// The stored preference is applied by a tiny blocking script in each page's
// <head>, not here - by the time this module runs the first paint has already
// happened and you would see a flash of the wrong theme. This file owns
// everything after that: cycling, persistence, and following the OS while the
// preference is "system".

(function (window, document) {
  'use strict';

  const STORAGE_KEY = 'nova.theme';
  const ORDER = ['system', 'light', 'dark'];
  const LABELS = { system: 'Theme: system', light: 'Theme: light', dark: 'Theme: dark' };
  const ICONS = { system: '◐', light: '☀', dark: '☾' };

  const query = window.matchMedia('(prefers-color-scheme: dark)');

  function read() {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      return ORDER.includes(stored) ? stored : 'system';
    } catch {
      return 'system';
    }
  }

  function effective(preference) {
    if (preference === 'system') return query.matches ? 'dark' : 'light';
    return preference;
  }

  function apply(preference) {
    if (preference === 'system') {
      delete document.documentElement.dataset.theme;
    } else {
      document.documentElement.dataset.theme = preference;
    }

    // Keeps mobile browser chrome in step with the page.
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) {
      meta.setAttribute('content', effective(preference) === 'dark' ? '#16161a' : '#f7f7f8');
    }

    for (const button of document.querySelectorAll('[data-theme-toggle]')) {
      button.textContent = ICONS[preference];
      button.setAttribute('aria-label', LABELS[preference]);
      button.title = LABELS[preference];
    }
  }

  function set(preference) {
    try { localStorage.setItem(STORAGE_KEY, preference); } catch { /* private mode */ }
    apply(preference);
  }

  function cycle() {
    const next = ORDER[(ORDER.indexOf(read()) + 1) % ORDER.length];
    set(next);
    return next;
  }

  // Only react to the OS while the user has not made a choice of their own.
  query.addEventListener('change', () => {
    if (read() === 'system') apply('system');
  });

  function mount() {
    apply(read());
    for (const button of document.querySelectorAll('[data-theme-toggle]')) {
      button.addEventListener('click', cycle);
    }
    window.Commands?.register({
      id: 'theme.cycle',
      label: 'Toggle theme (system / light / dark)',
      shortcut: 'mod+shift+d',
      worksWhileTyping: true,
      run: cycle,
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', mount);
  } else {
    mount();
  }

  window.Theme = { read, set, cycle, effective };
})(window, document);
