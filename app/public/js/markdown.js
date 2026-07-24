// A deliberately small Markdown renderer for assistant replies.
//
// Model output is untrusted as far as the DOM is concerned, so EVERYTHING is
// HTML-escaped first and the markup is generated from the escaped text. No
// model text ever reaches innerHTML unescaped.
//
// Supported: fenced code, inline code, bold, italic, links, headings,
// unordered/ordered lists, blockquotes. That covers what Claude actually emits
// in a chat reply; anything else renders as plain text, which is a safe
// failure mode.

(function (window) {
  'use strict';

  function escapeHtml(text) {
    return text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function renderInline(text) {
    return text
      .replace(/`([^`]+)`/g, (_, code) => `<code>${code}</code>`)
      .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
      .replace(/(^|[^*])\*([^*]+)\*/g, '$1<em>$2</em>')
      // Only http(s) links, so javascript: and data: URLs can never be built.
      .replace(
        /\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g,
        '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>'
      );
  }

  function render(markdown) {
    const escaped = escapeHtml(markdown ?? '');
    const lines = escaped.split('\n');
    const out = [];

    let inCode = false;
    let codeLines = [];
    let listType = null;
    let paragraph = [];

    const closeParagraph = () => {
      if (paragraph.length) {
        out.push(`<p>${renderInline(paragraph.join(' '))}</p>`);
        paragraph = [];
      }
    };
    const closeList = () => {
      if (listType) {
        out.push(`</${listType}>`);
        listType = null;
      }
    };

    for (const line of lines) {
      const fence = line.match(/^\s*```(\w*)\s*$/);
      if (fence) {
        if (inCode) {
          out.push(`<pre><code>${codeLines.join('\n')}</code></pre>`);
          codeLines = [];
          inCode = false;
        } else {
          closeParagraph();
          closeList();
          inCode = true;
        }
        continue;
      }

      if (inCode) {
        codeLines.push(line);
        continue;
      }

      if (line.trim() === '') {
        closeParagraph();
        closeList();
        continue;
      }

      const heading = line.match(/^(#{1,6})\s+(.*)$/);
      if (heading) {
        closeParagraph();
        closeList();
        const level = Math.min(heading[1].length + 2, 6); // h1 belongs to the page
        out.push(`<h${level}>${renderInline(heading[2])}</h${level}>`);
        continue;
      }

      const quote = line.match(/^&gt;\s?(.*)$/);
      if (quote) {
        closeParagraph();
        closeList();
        out.push(`<blockquote>${renderInline(quote[1])}</blockquote>`);
        continue;
      }

      const unordered = line.match(/^\s*[-*+]\s+(.*)$/);
      const ordered = line.match(/^\s*\d+\.\s+(.*)$/);
      if (unordered || ordered) {
        closeParagraph();
        const wanted = unordered ? 'ul' : 'ol';
        if (listType !== wanted) {
          closeList();
          out.push(`<${wanted}>`);
          listType = wanted;
        }
        out.push(`<li>${renderInline((unordered || ordered)[1])}</li>`);
        continue;
      }

      closeList();
      paragraph.push(line.trim());
    }

    if (inCode) out.push(`<pre><code>${codeLines.join('\n')}</code></pre>`);
    closeParagraph();
    closeList();

    return out.join('\n');
  }

  window.Markdown = { render, escapeHtml };
})(window);
