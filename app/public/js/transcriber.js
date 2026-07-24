// Microphone -> AudioWorklet -> presigned WebSocket -> AWS Transcribe.
//
// Extracted from the page so both transcribe.html and assistant.html can use
// it without copy-pasting five hundred lines.

(function (window) {
  'use strict';

  const { buildEventStreamMessage, parseEventStreamMessage, decodePayload } = window.AudioUtils;

  const MAX_RECONNECT_ATTEMPTS = 4;
  // WebSocket close codes that mean "this will never work", not "try again".
  const FATAL_CLOSE_CODES = new Set([1008, 1011]);

  async function listMicrophones() {
    let stream;
    try {
      // Labels are hidden until the user has granted permission once.
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch (err) {
      return { granted: false, devices: [], error: err.message };
    }
    const devices = await navigator.mediaDevices.enumerateDevices();
    stream.getTracks().forEach((track) => track.stop());
    return {
      granted: true,
      devices: devices
        .filter((d) => d.kind === 'audioinput')
        .map((d, i) => ({ id: d.deviceId, label: d.label || `Microphone ${i + 1}` })),
    };
  }

  function createTranscriber(handlers = {}) {
    const {
      onPartial = () => {},
      onFinal = () => {},
      onStateChange = () => {},
      onDebug = () => {},
      onError = () => {},
    } = handlers;

    let socket = null;
    let audioContext = null;
    let workletNode = null;
    let mediaStream = null;
    let source = null;

    let state = 'idle';
    let stoppedByUser = false;
    let reconnectAttempt = 0;
    let reconnectTimer = null;
    let options = {};
    let workletLoaded = false;

    function setState(next, detail) {
      state = next;
      onStateChange(next, detail);
    }

    function debug(message) {
      onDebug(`[${new Date().toISOString().slice(11, 19)}] ${message}`);
    }

    async function fetchSignedUrl(sampleRate) {
      const params = new URLSearchParams({
        languageCode: options.languageCode ?? 'en-US',
        sampleRate: String(sampleRate),
      });
      if (options.identifyPii) params.set('identifyPii', 'true');

      const response = await fetch(`/get-signed-url?${params}`);
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        throw new Error(body.error || `Could not get a signed URL (${response.status})`);
      }
      return response.json();
    }

    async function openAudio() {
      if (audioContext) return audioContext.sampleRate;

      mediaStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          deviceId: options.deviceId ? { exact: options.deviceId } : undefined,
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: true,
        },
      });

      // Ask for 16 kHz. If the hardware refuses, we do NOT resample in an audio
      // callback (that was v1's ordering bug) - we tell Transcribe the real
      // rate instead and let AWS handle it.
      audioContext = new AudioContext({ sampleRate: 16000, latencyHint: 'interactive' });
      if (audioContext.sampleRate !== 16000) {
        debug(`Hardware refused 16 kHz; using ${audioContext.sampleRate} Hz and telling AWS.`);
      }

      if (!workletLoaded) {
        await audioContext.audioWorklet.addModule('/js/pcm-worklet.js');
        workletLoaded = true;
      }

      source = audioContext.createMediaStreamSource(mediaStream);
      workletNode = new AudioWorkletNode(audioContext, 'pcm-processor');
      workletNode.port.onmessage = ({ data }) => {
        if (socket && socket.readyState === WebSocket.OPEN) {
          socket.send(buildEventStreamMessage(data));
        }
      };
      source.connect(workletNode);
      // Deliberately not connected to destination: that would echo the
      // microphone to the speakers, and AudioWorklet does not need it.

      return audioContext.sampleRate;
    }

    function handleMessage(event) {
      if (!(event.data instanceof ArrayBuffer)) return;

      let frame;
      try {
        frame = parseEventStreamMessage(event.data);
      } catch (err) {
        debug(`Could not parse frame: ${err.message}`);
        return;
      }

      const type = frame.headers[':event-type'];
      const messageType = frame.headers[':message-type'];

      if (messageType === 'exception' || frame.headers[':exception-type']) {
        const detail = frame.headers[':exception-type'] || 'unknown';
        debug(`Transcribe exception: ${detail}`);
        onError(new Error(`AWS Transcribe rejected the stream (${detail})`));
        return;
      }

      if (type !== 'TranscriptEvent') return;

      let data;
      try {
        data = decodePayload(frame.payload);
      } catch (err) {
        debug(`Could not decode transcript payload: ${err.message}`);
        return;
      }

      const results = data?.Transcript?.Results ?? [];
      for (const result of results) {
        const alternative = result.Alternatives?.[0];
        if (!alternative?.Transcript) continue;
        // Each partial is the FULL current utterance, not a delta. Appending
        // instead of replacing duplicates text.
        if (result.IsPartial) onPartial(alternative.Transcript);
        else onFinal(alternative.Transcript, result);
      }
    }

    async function connect() {
      const sampleRate = await openAudio();
      const signed = await fetchSignedUrl(sampleRate);
      debug(`Signed URL issued (session ${signed.sessionId}, ${signed.sampleRate} Hz)`);

      await new Promise((resolve, reject) => {
        socket = new WebSocket(signed.url);
        socket.binaryType = 'arraybuffer';

        const timeout = setTimeout(() => {
          reject(new Error('Timed out connecting to AWS Transcribe'));
          socket?.close();
        }, 10_000);

        socket.onopen = () => {
          clearTimeout(timeout);
          resolve();
        };
        socket.onerror = () => {
          clearTimeout(timeout);
          reject(new Error('Could not open the transcription socket'));
        };
      });

      socket.onmessage = handleMessage;
      socket.onclose = (event) => {
        debug(`Socket closed: ${event.code} ${event.reason || ''}`);
        if (stoppedByUser) return;
        if (FATAL_CLOSE_CODES.has(event.code)) {
          onError(new Error(`Transcription rejected: ${event.reason || event.code}`));
          setState('error', event.reason);
          teardownAudio();
          return;
        }
        scheduleReconnect();
      };

      reconnectAttempt = 0;
      setState('listening');
    }

    function scheduleReconnect() {
      if (reconnectAttempt >= MAX_RECONNECT_ATTEMPTS) {
        setState('error', 'Connection lost');
        onError(new Error('Lost the connection to AWS Transcribe and could not reconnect.'));
        teardownAudio();
        return;
      }

      reconnectAttempt += 1;
      const delay = 1000 * 2 ** (reconnectAttempt - 1);
      setState('reconnecting', { attempt: reconnectAttempt, of: MAX_RECONNECT_ATTEMPTS });
      debug(`Reconnecting in ${delay} ms (attempt ${reconnectAttempt})`);

      reconnectTimer = setTimeout(async () => {
        try {
          // A signed URL is bound to one session and cannot be reused, so this
          // always fetches a fresh one.
          await connect();
          onFinal('— reconnected —', { synthetic: true });
        } catch (err) {
          debug(`Reconnect failed: ${err.message}`);
          scheduleReconnect();
        }
      }, delay);
    }

    function sendEndOfStream() {
      if (socket && socket.readyState === WebSocket.OPEN) {
        // An empty audio frame tells Transcribe to finalise the last utterance
        // rather than discarding it.
        socket.send(buildEventStreamMessage(new ArrayBuffer(0)));
      }
    }

    function teardownAudio() {
      clearTimeout(reconnectTimer);
      if (workletNode) {
        try {
          workletNode.port.postMessage({ type: 'stop' });
          workletNode.disconnect();
        } catch { /* already gone */ }
        workletNode = null;
      }
      if (source) { try { source.disconnect(); } catch { /* already gone */ } source = null; }
      if (mediaStream) {
        mediaStream.getTracks().forEach((track) => track.stop());
        mediaStream = null;
      }
      if (audioContext) {
        audioContext.close().catch(() => {});
        audioContext = null;
        workletLoaded = false;
      }
    }

    async function start(startOptions = {}) {
      if (state === 'listening' || state === 'connecting') return;
      options = startOptions;
      stoppedByUser = false;
      reconnectAttempt = 0;
      setState('connecting');

      if (!window.isSecureContext) {
        throw new Error('Microphone access requires HTTPS or localhost.');
      }
      if (!window.AudioWorkletNode) {
        throw new Error(
          'This browser does not support audio capture. Please use a current version of Chrome, Edge, Firefox, or Safari.'
        );
      }

      try {
        await connect();
      } catch (err) {
        teardownAudio();
        setState('error', err.message);
        throw err;
      }
    }

    function stop() {
      stoppedByUser = true;
      clearTimeout(reconnectTimer);
      sendEndOfStream();
      // Give the last frame a moment to leave before closing.
      setTimeout(() => {
        if (socket) {
          if (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING) {
            socket.close(1000, 'client stopped');
          }
          socket = null;
        }
        teardownAudio();
        setState('idle');
      }, 150);
    }

    return { start, stop, getState: () => state };
  }

  window.Transcriber = { createTranscriber, listMicrophones };
})(window);
