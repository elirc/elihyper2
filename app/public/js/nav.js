// The navigation is defined once here and injected into every page. Adding a
// page means adding one entry to this array.

(function (window, document) {
  'use strict';

  const PAGES = [
    { href: '/assistant.html', label: 'Voice Assistant' },
    { href: '/claude.html', label: 'Ask Claude' },
    { href: '/text-to-speech.html', label: 'Text to Speech' },
    { href: '/transcribe.html', label: 'Live Transcription' },
  ];

  function render() {
    const mount = document.querySelector('[data-nav]');
    if (!mount) return;

    const here = window.location.pathname === '/' ? '/assistant.html' : window.location.pathname;

    // The only innerHTML in this codebase that is not escaped first, because
    // every value in it is a hardcoded constant above - never user or model
    // input.
    mount.innerHTML = `<ul>${PAGES.map(
      ({ href, label }) =>
        `<li><a href="${href}"${href === here ? ' aria-current="page"' : ''}>${label}</a></li>`
    ).join('')}</ul>`;
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', render);
  } else {
    render();
  }
})(window, document);
