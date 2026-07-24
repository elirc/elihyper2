// Sentence-at-a-time speech playback.
//
// Synthesis requests are fired as soon as each sentence is ready, so they run
// concurrently and playback can start ~1 sentence after the model does. Audio
// still plays in strict submission order: the queue holds promises and is
// awaited in sequence, so a later sentence finishing first cannot jump ahead.

(function (window) {
  'use strict';

  function createSpeaker({ onStateChange = () => {}, onError = () => {} } = {}) {
    let queue = [];
    let playing = false;
    let muted = false;
    let audio = null;
    let controllers = new Set();
    let voiceId = null;
    let engine = null;

    function setVoice(nextVoiceId, nextEngine) {
      voiceId = nextVoiceId;
      engine = nextEngine;
    }

    function setMuted(next) {
      muted = next;
      if (muted) stop();
    }

    async function synthesise(text) {
      const controller = new AbortController();
      controllers.add(controller);
      try {
        const response = await fetch('/speak', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ text, voiceId, engine }),
          signal: controller.signal,
        });
        if (!response.ok) {
          const body = await response.json().catch(() => ({}));
          throw new Error(body.error || `Speech synthesis failed (${response.status})`);
        }
        return URL.createObjectURL(await response.blob());
      } finally {
        controllers.delete(controller);
      }
    }

    function playUrl(url) {
      return new Promise((resolve) => {
        audio = new Audio(url);
        const done = () => {
          URL.revokeObjectURL(url);
          audio = null;
          resolve();
        };
        audio.onended = done;
        audio.onerror = done;
        audio.play().catch(done);
      });
    }

    async function drain() {
      if (playing) return;
      playing = true;
      onStateChange('speaking');

      while (queue.length > 0) {
        const { url, error } = await queue.shift();

        if (error) {
          if (error.name !== 'AbortError') onError(error);
          continue;
        }
        if (muted || !url) {
          if (url) URL.revokeObjectURL(url);
          continue;
        }
        await playUrl(url);
      }

      playing = false;
      onStateChange('idle');
    }

    // Text arrives sentence by sentence from the chat stream.
    function enqueue(text) {
      const trimmed = (text ?? '').trim();
      if (!trimmed || muted) return;
      // Kick synthesis off immediately; ordering is enforced by the queue.
      //
      // The rejection is folded into the resolved value rather than left on a
      // rejected promise: a later sentence can fail while an earlier one is
      // still playing, and an unawaited rejection would surface as an
      // unhandled promise rejection in the console.
      queue.push(
        synthesise(trimmed).then(
          (url) => ({ url }),
          (error) => ({ error })
        )
      );
      drain();
    }

    // Barge-in: stop playback, drop anything queued, and abort synthesis that
    // is already in flight so it cannot start playing a moment later.
    function stop() {
      queue = [];
      for (const controller of controllers) controller.abort();
      controllers.clear();
      if (audio) {
        audio.pause();
        audio.onended = null;
        audio.onerror = null;
        audio = null;
      }
      playing = false;
      onStateChange('idle');
    }

    return {
      enqueue,
      stop,
      setVoice,
      setMuted,
      isMuted: () => muted,
      isSpeaking: () => playing,
    };
  }

  window.Speaker = { createSpeaker };
})(window);
