// Turns arbitrary text into a safe download filename.
//
// This lived in three places - routes/speak.js, text-to-speech.html, and a
// third copy was about to be written for conversation export. Three copies of
// one function is how they drift, and a filename sanitiser that drifts is a
// path-traversal bug waiting to happen.
//
// Dual-exported like audio-utils.js so the server can require it directly
// rather than keeping a parallel implementation in sync by hand.

(function (root) {
  'use strict';

  const MAX_LENGTH = 40;

  // Strips markup, lowercases, and reduces to [a-z0-9-]. Everything else -
  // path separators, dots, control characters, non-ASCII - is collapsed to a
  // hyphen, so the result can never escape a directory or hide an extension.
  function slugify(text, { maxLength = MAX_LENGTH } = {}) {
    return String(text ?? '')
      .replace(/<[^>]*>/g, ' ')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, maxLength)
      .replace(/-+$/, '');
  }

  function filenameFrom(text, extension, options = {}) {
    const slug = slugify(text, options);
    const fallback = options.fallback ?? 'download';
    return `${slug || fallback}.${extension}`;
  }

  // YYYY-MM-DD-HHmm in local time, for filenames that sort chronologically.
  function timestamp(date = new Date()) {
    const pad = (n) => String(n).padStart(2, '0');
    return (
      `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}` +
      `-${pad(date.getHours())}${pad(date.getMinutes())}`
    );
  }

  const api = { slugify, filenameFrom, timestamp, MAX_LENGTH };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.Filename = api;
})(typeof window !== 'undefined' ? window : null);
