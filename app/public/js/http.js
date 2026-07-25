// One retry policy for every fetch in the app.
//
// Scattering ad-hoc retry loops through each caller is how you end up
// retrying a 400 three times, or hammering a server that just told you to
// back off. This module is the only place that decides what is worth
// retrying and how long to wait.

(function (root) {
  'use strict';

  // Transient by definition: the same request may well succeed shortly.
  // 400 and 413 are absent on purpose - the request itself is wrong and will
  // stay wrong, so retrying only multiplies the error.
  const RETRYABLE_STATUS = new Set([429, 502, 503, 504]);

  const DEFAULTS = { attempts: 3, baseDelayMs: 1000, maxDelayMs: 15000, jitterMs: 250 };

  function backoffFor(attempt, response, options) {
    const { baseDelayMs, maxDelayMs, jitterMs } = options;

    // A 429 tells us how long to wait. Guessing over the top of that is how
    // you get rate limited for longer.
    const retryAfter = Number(response?.headers?.get?.('Retry-After'));
    if (Number.isFinite(retryAfter) && retryAfter > 0) {
      return Math.min(retryAfter * 1000, maxDelayMs);
    }

    const exponential = baseDelayMs * 2 ** (attempt - 1);
    // Jitter matters: without it every client that failed at the same instant
    // retries at the same instant and knocks the server over again.
    return Math.min(exponential, maxDelayMs) + Math.random() * jitterMs;
  }

  function createHttp(options = {}) {
    const settings = { ...DEFAULTS, ...options };
    const fetchImpl = settings.fetch ?? ((...args) => root.fetch(...args));
    const wait = settings.wait ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
    const onRetry = settings.onRetry ?? (() => {});

    async function request(url, init = {}, perCall = {}) {
      const config = { ...settings, ...perCall };
      let lastError = null;

      for (let attempt = 1; attempt <= config.attempts; attempt++) {
        let response;
        try {
          response = await fetchImpl(url, init);
        } catch (err) {
          // An aborted request is the user's decision, never a failure to
          // retry around.
          if (err.name === 'AbortError') throw err;
          lastError = err;

          if (attempt >= config.attempts) break;
          const delay = backoffFor(attempt, null, config);
          onRetry({ attempt, of: config.attempts, delay, reason: 'network' });
          await wait(delay);
          continue;
        }

        if (response.ok || !RETRYABLE_STATUS.has(response.status)) return response;
        if (attempt >= config.attempts) return response;

        const delay = backoffFor(attempt, response, config);
        onRetry({ attempt, of: config.attempts, delay, reason: response.status });
        await wait(delay);
      }

      throw lastError ?? new Error('Request failed');
    }

    return { request, RETRYABLE_STATUS };
  }

  // navigator.onLine is only trustworthy when it says false. True means "an
  // interface is up", not "the internet works" - so a failed request is the
  // real signal and these events are only a hint.
  function watchConnection({ onOffline = () => {}, onOnline = () => {} } = {}) {
    root.addEventListener('offline', onOffline);
    root.addEventListener('online', onOnline);
    if (root.navigator && root.navigator.onLine === false) onOffline();
    return () => {
      root.removeEventListener('offline', onOffline);
      root.removeEventListener('online', onOnline);
    };
  }

  // Mounts the offline banner itself so every page gets it from the script
  // tag alone. Kept here rather than in each page because the banner is a
  // direct expression of connection state, which is this module's subject.
  function mountOfflineBanner(doc) {
    const banner = doc.createElement('div');
    banner.className = 'offline-banner';
    banner.setAttribute('role', 'status');
    banner.hidden = true;
    banner.textContent = 'You appear to be offline. Requests will fail until the connection returns.';
    doc.body.appendChild(banner);

    watchConnection({
      onOffline: () => { banner.hidden = false; },
      onOnline: () => { banner.hidden = true; },
    });
  }

  if (root.document) {
    if (root.document.readyState === 'loading') {
      root.document.addEventListener('DOMContentLoaded', () => mountOfflineBanner(root.document));
    } else {
      mountOfflineBanner(root.document);
    }
  }

  const api = { createHttp, watchConnection, RETRYABLE_STATUS, backoffFor, DEFAULTS };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root && root.document) root.Http = api;
})(typeof window !== 'undefined' ? window : globalThis);
