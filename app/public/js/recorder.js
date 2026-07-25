// Records the assistant's spoken output to a downloadable file.
//
// MediaRecorder records a MediaStream, and <audio> playback is not one, so
// the speaker routes its elements through a MediaStreamAudioDestinationNode
// and this module records that. See speaker.js getRecordingStream().

(function (root) {
  'use strict';

  // Output format is browser-dependent: Chrome gives WebM/Opus, Safari MP4.
  // Probe rather than claiming .mp3 and handing the user a file that will not
  // open.
  const CANDIDATES = [
    { mimeType: 'audio/webm;codecs=opus', extension: 'webm' },
    { mimeType: 'audio/webm', extension: 'webm' },
    { mimeType: 'audio/mp4', extension: 'm4a' },
    { mimeType: 'audio/ogg;codecs=opus', extension: 'ogg' },
  ];

  function pickFormat() {
    if (typeof MediaRecorder === 'undefined') return null;
    return CANDIDATES.find((c) => MediaRecorder.isTypeSupported(c.mimeType)) ?? null;
  }

  const DEFAULT_MAX_BYTES = 100 * 1024 * 1024;

  function createRecorder({
    onStateChange = () => {},
    onWarning = () => {},
    maxBytes = DEFAULT_MAX_BYTES,
  } = {}) {
    let recorder = null;
    let chunks = [];
    let bytes = 0;
    let format = null;
    let warned = false;

    const isSupported = () => pickFormat() !== null;
    const isRecording = () => recorder !== null && recorder.state === 'recording';

    function start(stream) {
      if (isRecording()) return true;

      format = pickFormat();
      if (!format || !stream) {
        onWarning('Recording is not supported in this browser.');
        return false;
      }

      chunks = [];
      bytes = 0;
      warned = false;

      recorder = new MediaRecorder(stream, { mimeType: format.mimeType });
      recorder.ondataavailable = (event) => {
        if (!event.data || event.data.size === 0) return;

        // Bounded so a long session cannot grow until the tab dies.
        if (bytes + event.data.size > maxBytes) {
          if (!warned) {
            warned = true;
            onWarning('Recording has reached its size limit and has been stopped.');
            stop();
          }
          return;
        }
        chunks.push(event.data);
        bytes += event.data.size;
      };

      // A timeslice means chunks arrive continuously rather than only at
      // stop, so the size cap can be enforced as it goes.
      recorder.start(1000);
      onStateChange('recording');
      return true;
    }

    function stop() {
      return new Promise((resolve) => {
        if (!recorder || recorder.state === 'inactive') {
          onStateChange('idle');
          resolve(null);
          return;
        }
        recorder.onstop = () => {
          const blob = chunks.length ? new Blob(chunks, { type: format.mimeType }) : null;
          recorder = null;
          onStateChange('idle');
          resolve(blob);
        };
        recorder.stop();
      });
    }

    function download(blob, baseName) {
      if (!blob) {
        onWarning('There is nothing recorded to save yet.');
        return;
      }
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `${baseName}.${format.extension}`;
      link.click();
      URL.revokeObjectURL(url);
    }

    return { start, stop, download, isRecording, isSupported, size: () => bytes };
  }

  const api = { createRecorder, pickFormat };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.Recorder = api;
})(typeof window !== 'undefined' ? window : null);
