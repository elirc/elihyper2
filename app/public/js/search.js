// Transcript search.
//
// The obvious implementation - html.replace(query, '<mark>' + query + '</mark>')
// assigned to innerHTML - is an injection. Transcript text is speech and the
// query is user input, so highlighting is done by splitting text nodes and
// inserting real <mark> elements instead.

(function (root) {
  'use strict';

  // A query is a literal string, not a pattern. Without escaping, typing "("
  // throws instead of returning results.
  function escapeRegExp(text) {
    return String(text).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  // Returns [start, end) offsets rather than strings, so the caller can
  // highlight in place without re-deriving positions.
  function findMatches(text, query, { caseSensitive = false } = {}) {
    const haystack = String(text ?? '');
    const needle = String(query ?? '');
    if (needle === '') return [];

    const flags = caseSensitive ? 'g' : 'gi';
    const pattern = new RegExp(escapeRegExp(needle), flags);
    const matches = [];

    for (const match of haystack.matchAll(pattern)) {
      matches.push({ start: match.index, end: match.index + match[0].length });
      // A zero-length match cannot happen with an escaped literal, but guard
      // anyway: matchAll would loop forever if it did.
      if (match[0].length === 0) break;
    }
    return matches;
  }

  function searchLines(lines, query, options = {}) {
    const results = [];
    lines.forEach((line, lineIndex) => {
      for (const match of findMatches(line.text, query, options)) {
        results.push({ lineIndex, ...match });
      }
    });
    return results;
  }

  // Builds a fragment of text nodes and <mark> elements. Nothing here is
  // parsed as HTML, so the transcript and the query are both inert.
  function highlight(doc, text, matches, activeIndex = -1, offset = 0) {
    const fragment = doc.createDocumentFragment();
    let cursor = 0;

    matches.forEach((match, index) => {
      if (match.start > cursor) {
        fragment.appendChild(doc.createTextNode(text.slice(cursor, match.start)));
      }
      const mark = doc.createElement('mark');
      mark.textContent = text.slice(match.start, match.end);
      if (offset + index === activeIndex) mark.className = 'is-active';
      fragment.appendChild(mark);
      cursor = match.end;
    });

    if (cursor < text.length) {
      fragment.appendChild(doc.createTextNode(text.slice(cursor)));
    }
    return fragment;
  }

  function debounce(fn, ms) {
    let timer = null;
    return (...args) => {
      clearTimeout(timer);
      timer = setTimeout(() => fn(...args), ms);
    };
  }

  const api = { escapeRegExp, findMatches, searchLines, highlight, debounce };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.Search = api;
})(typeof window !== 'undefined' ? window : null);
