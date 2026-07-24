// Pure helpers for the AWS Transcribe streaming wire format.
//
// Kept free of DOM and browser APIs so they can be unit tested under Node.
// Loaded in the browser with a plain <script src> (they attach to window) and
// required directly by test/audio-utils.test.js.
//
// The frame layout AWS uses in both directions:
//
//   ┌──────────────┬────────────────┬─────────────┬─────────┬─────────┬────────────┐
//   │ total length │ headers length │ prelude CRC │ headers │ payload │ message CRC│
//   │  4 bytes BE  │   4 bytes BE   │  4 bytes    │ N bytes │ M bytes │  4 bytes   │
//   └──────────────┴────────────────┴─────────────┴─────────┴─────────┴────────────┘
//
// Each header is [nameLen:u8][name][valueType:u8][valueLen:u16 BE][value].
// Everything is big-endian EXCEPT the PCM samples in the payload, which are
// little-endian. Mixing those up is the classic bug in this code path.

(function (root) {
  'use strict';

  const CRC32_TABLE = (() => {
    const table = new Int32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) {
        c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      }
      table[n] = c;
    }
    return table;
  })();

  function crc32(bytes) {
    let crc = ~0;
    for (let i = 0; i < bytes.length; i++) {
      crc = (crc >>> 8) ^ CRC32_TABLE[(crc ^ bytes[i]) & 0xff];
    }
    return ~crc >>> 0;
  }

  // Web Audio hands out Float32 in [-1, 1]; Transcribe wants signed 16-bit
  // little-endian. The scale is asymmetric because Int16 holds -32768..32767.
  function floatTo16BitPCM(float32Array) {
    const buffer = new ArrayBuffer(float32Array.length * 2);
    const view = new DataView(buffer);
    for (let i = 0; i < float32Array.length; i++) {
      const clamped = Math.max(-1, Math.min(1, float32Array[i]));
      view.setInt16(i * 2, clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff, true);
    }
    return buffer;
  }

  const AUDIO_EVENT_HEADERS = [
    { name: ':content-type', value: 'application/octet-stream' },
    { name: ':event-type', value: 'AudioEvent' },
    { name: ':message-type', value: 'event' },
  ];

  // An empty payload is a valid frame and is how a client signals end-of-stream,
  // which makes Transcribe finalise the last utterance instead of dropping it.
  function buildEventStreamMessage(pcmBuffer) {
    const payload = new Uint8Array(pcmBuffer ?? new ArrayBuffer(0));

    let headersLength = 0;
    for (const header of AUDIO_EVENT_HEADERS) {
      headersLength += 1 + header.name.length + 1 + 2 + header.value.length;
    }

    const totalLength = 4 + 4 + 4 + headersLength + payload.byteLength + 4;
    const buffer = new ArrayBuffer(totalLength);
    const view = new DataView(buffer);
    let offset = 0;

    view.setUint32(offset, totalLength, false); offset += 4;
    view.setUint32(offset, headersLength, false); offset += 4;

    view.setUint32(offset, crc32(new Uint8Array(buffer, 0, 8)), false); offset += 4;

    for (const header of AUDIO_EVENT_HEADERS) {
      view.setUint8(offset++, header.name.length);
      for (let i = 0; i < header.name.length; i++) {
        view.setUint8(offset++, header.name.charCodeAt(i));
      }
      view.setUint8(offset++, 7); // 7 = string
      view.setUint16(offset, header.value.length, false); offset += 2;
      for (let i = 0; i < header.value.length; i++) {
        view.setUint8(offset++, header.value.charCodeAt(i));
      }
    }

    new Uint8Array(buffer, offset, payload.byteLength).set(payload);
    offset += payload.byteLength;

    view.setUint32(offset, crc32(new Uint8Array(buffer, 0, offset)), false);

    return buffer;
  }

  // Header value types defined by the event-stream spec. v1 only handled
  // strings and threw on anything else, which crashed the page whenever AWS
  // sent an exception frame (those carry non-string headers).
  function readHeaderValue(view, offset, type) {
    switch (type) {
      case 0: return { value: true, offset };
      case 1: return { value: false, offset };
      case 2: return { value: view.getInt8(offset), offset: offset + 1 };
      case 3: return { value: view.getInt16(offset, false), offset: offset + 2 };
      case 4: return { value: view.getInt32(offset, false), offset: offset + 4 };
      case 5: return { value: view.getBigInt64(offset, false), offset: offset + 8 };
      case 6:
      case 7: {
        const length = view.getUint16(offset, false);
        let cursor = offset + 2;
        let value = '';
        for (let i = 0; i < length; i++) value += String.fromCharCode(view.getUint8(cursor++));
        return { value, offset: cursor };
      }
      case 8: return { value: view.getBigInt64(offset, false), offset: offset + 8 };
      case 9: return { value: null, offset: offset + 16 };
      default: throw new Error(`Unsupported event stream header type ${type}`);
    }
  }

  function parseEventStreamMessage(arrayBuffer) {
    const view = new DataView(arrayBuffer);
    let offset = 0;

    const totalLength = view.getUint32(offset, false); offset += 4;
    const headersLength = view.getUint32(offset, false); offset += 4;
    offset += 4; // prelude CRC

    const headers = {};
    const headersEnd = offset + headersLength;
    while (offset < headersEnd) {
      const nameLength = view.getUint8(offset++);
      let name = '';
      for (let i = 0; i < nameLength; i++) name += String.fromCharCode(view.getUint8(offset++));
      const type = view.getUint8(offset++);
      const read = readHeaderValue(view, offset, type);
      headers[name] = read.value;
      offset = read.offset;
    }

    const payloadLength = totalLength - headersLength - 16;
    const payload = new Uint8Array(arrayBuffer, 12 + headersLength, payloadLength);

    return { headers, payload };
  }

  function decodePayload(payload) {
    return JSON.parse(new TextDecoder('utf-8').decode(payload));
  }

  const api = {
    crc32,
    floatTo16BitPCM,
    buildEventStreamMessage,
    parseEventStreamMessage,
    decodePayload,
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
  if (root) {
    root.AudioUtils = api;
  }
})(typeof window !== 'undefined' ? window : null);
