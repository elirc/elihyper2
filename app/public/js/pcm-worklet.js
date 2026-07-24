// Runs on the dedicated audio thread. v1 used ScriptProcessorNode, which runs
// on the main thread and drops samples whenever the UI is busy.
//
// Converts Float32 to 16-bit PCM here so the main thread only has to frame and
// send. The browser calls process() every 128 frames; we buffer up to a larger
// chunk (~256 ms at 16 kHz) before posting, matching v1's cadence.

const DEFAULT_CHUNK_SAMPLES = 4096;

class PCMProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super();
    const chunk = options?.processorOptions?.chunkSamples ?? DEFAULT_CHUNK_SAMPLES;
    this.buffer = new Int16Array(chunk);
    this.offset = 0;
    this.stopped = false;

    this.port.onmessage = (event) => {
      if (event.data?.type === 'flush') this.flush();
      if (event.data?.type === 'stop') {
        this.flush();
        this.stopped = true;
      }
    };
  }

  flush() {
    if (this.offset === 0) return;
    const chunk = this.buffer.slice(0, this.offset);
    this.port.postMessage(chunk.buffer, [chunk.buffer]);
    this.offset = 0;
  }

  process(inputs) {
    if (this.stopped) return false;

    const channel = inputs[0]?.[0];
    // No input connected yet. Returning true keeps the node alive.
    if (!channel) return true;

    for (let i = 0; i < channel.length; i++) {
      const sample = Math.max(-1, Math.min(1, channel[i]));
      this.buffer[this.offset++] = sample < 0 ? sample * 0x8000 : sample * 0x7fff;

      if (this.offset === this.buffer.length) {
        // Copy before transferring: this.buffer keeps being written into.
        const chunk = this.buffer.slice();
        this.port.postMessage(chunk.buffer, [chunk.buffer]);
        this.offset = 0;
      }
    }

    // Returning false would tear the node down permanently.
    return true;
  }
}

registerProcessor('pcm-processor', PCMProcessor);
