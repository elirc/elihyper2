const { createHash } = require('node:crypto');

// Bounded LRU for synthesised audio. Polly bills per character, so replaying
// the same sentence during a demo should cost nothing after the first call.
//
// A plain Map is the whole implementation: JS Maps iterate in insertion order,
// so deleting and re-setting a key moves it to the newest position, and
// map.keys().next().value is always the oldest entry.

class AudioCache {
  constructor({ enabled = true, maxEntries = 200, maxBytes = 50 * 1024 * 1024 } = {}) {
    this.enabled = enabled;
    this.maxEntries = maxEntries;
    this.maxBytes = maxBytes;
    this.entries = new Map();
    this.bytes = 0;
    this.hits = 0;
    this.misses = 0;
  }

  static key({ text, voiceId, engine, outputFormat, textType, languageCode }) {
    return createHash('sha256')
      .update(
        JSON.stringify([text, voiceId, engine, outputFormat, textType, languageCode ?? ''])
      )
      .digest('hex');
  }

  get(key) {
    if (!this.enabled) return undefined;
    const hit = this.entries.get(key);
    if (!hit) {
      this.misses += 1;
      return undefined;
    }
    // Re-insert to mark as most recently used.
    this.entries.delete(key);
    this.entries.set(key, hit);
    this.hits += 1;
    return hit;
  }

  set(key, audio, meta = {}) {
    if (!this.enabled) return;
    if (audio.byteLength > this.maxBytes) return; // never evict everything for one entry

    if (this.entries.has(key)) {
      this.bytes -= this.entries.get(key).audio.byteLength;
      this.entries.delete(key);
    }

    this.entries.set(key, { audio, meta, storedAt: Date.now() });
    this.bytes += audio.byteLength;
    this.evict();
  }

  evict() {
    while (this.entries.size > this.maxEntries || this.bytes > this.maxBytes) {
      const oldest = this.entries.keys().next();
      if (oldest.done) break;
      this.bytes -= this.entries.get(oldest.value).audio.byteLength;
      this.entries.delete(oldest.value);
    }
  }

  clear() {
    this.entries.clear();
    this.bytes = 0;
  }

  stats() {
    return {
      enabled: this.enabled,
      entries: this.entries.size,
      bytes: this.bytes,
      hits: this.hits,
      misses: this.misses,
    };
  }
}

module.exports = { AudioCache };
