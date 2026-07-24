// Conversation state plus the streaming client for POST /ask-claude.
//
// EventSource only speaks GET, and we need to POST a messages array, so the
// SSE frames are read off the fetch body stream by hand.

(function (window) {
  'use strict';

  function createChat({ onDelta = () => {}, onSentence = () => {}, onDone = () => {}, onError = () => {} } = {}) {
    let messages = [];
    let controller = null;

    function getMessages() {
      return messages.slice();
    }

    function reset() {
      abort();
      messages = [];
    }

    function abort() {
      controller?.abort();
      controller = null;
    }

    // Flush completed sentences so downstream consumers (text-to-speech) can
    // start work before the whole answer has arrived. The length fallback
    // matters: a long bulleted list may never hit terminal punctuation.
    function createSentenceSplitter(emit) {
      let pending = '';
      return {
        push(text) {
          pending += text;
          for (;;) {
            const match = pending.match(/[.!?](?=\s)|[.!?]$|\n{2,}/);
            const overlong = pending.length >= 200 && pending.includes(' ');
            if (!match && !overlong) break;

            let cut;
            if (match) {
              cut = match.index + match[0].length;
            } else {
              cut = pending.lastIndexOf(' ', 200);
              if (cut <= 0) break;
            }
            const sentence = pending.slice(0, cut).trim();
            pending = pending.slice(cut);
            if (sentence) emit(sentence);
          }
        },
        flush() {
          const rest = pending.trim();
          pending = '';
          if (rest) emit(rest);
        },
      };
    }

    async function send(text, { tone } = {}) {
      const trimmed = (text ?? '').trim();
      if (!trimmed) throw new Error('Please type a message first.');

      // Only commit the user turn once the request succeeds, so a failed send
      // can be retried without duplicating it.
      const outgoing = messages.concat({ role: 'user', content: trimmed });

      controller = new AbortController();
      const splitter = createSentenceSplitter(onSentence);
      let answer = '';

      let response;
      try {
        response = await fetch('/ask-claude?stream=1', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream' },
          body: JSON.stringify({ messages: outgoing, tone }),
          signal: controller.signal,
        });
      } catch (err) {
        controller = null;
        if (err.name === 'AbortError') return { aborted: true, text: '' };
        throw new Error('Could not reach the server.');
      }

      if (!response.ok) {
        controller = null;
        const body = await response.json().catch(() => ({}));
        throw new Error(body.error || `Request failed (${response.status})`);
      }

      const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
      let buffer = '';
      let stopReason = null;
      let failure = null;

      try {
        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          buffer += value;

          // A chunk boundary can land mid-frame, so keep the incomplete tail.
          const frames = buffer.split('\n\n');
          buffer = frames.pop();

          for (const frame of frames) {
            const line = frame.split('\n').find((l) => l.startsWith('data:'));
            if (!line) continue;

            let payload;
            try {
              payload = JSON.parse(line.slice(5).trim());
            } catch {
              continue;
            }

            if (payload.type === 'delta') {
              answer += payload.text;
              onDelta(payload.text, answer);
              splitter.push(payload.text);
            } else if (payload.type === 'done') {
              stopReason = payload.stopReason;
            } else if (payload.type === 'error') {
              failure = new Error(payload.message);
            }
          }
        }
      } catch (err) {
        if (err.name !== 'AbortError') failure = err;
      } finally {
        controller = null;
        splitter.flush();
      }

      // Whatever arrived before an abort or failure is still a real answer.
      if (answer) {
        messages = outgoing.concat({ role: 'assistant', content: answer });
      }

      if (failure) {
        onError(failure);
        throw failure;
      }

      onDone(answer, stopReason);
      return { text: answer, stopReason };
    }

    return { send, abort, reset, getMessages, isBusy: () => controller !== null };
  }

  window.Chat = { createChat };
})(window);
