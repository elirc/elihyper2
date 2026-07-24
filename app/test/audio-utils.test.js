const { test } = require('node:test');
const assert = require('node:assert');

const {
  crc32,
  floatTo16BitPCM,
  buildEventStreamMessage,
  parseEventStreamMessage,
  decodePayload,
} = require('../public/js/audio-utils');

test('crc32 matches the published check vector', () => {
  // The standard CRC-32 check value for "123456789" is 0xCBF43926.
  const bytes = new TextEncoder().encode('123456789');
  assert.strictEqual(crc32(bytes), 0xcbf43926);
});

test('floatTo16BitPCM writes little-endian samples with the asymmetric scale', () => {
  const pcm = new DataView(floatTo16BitPCM(new Float32Array([0, 1, -1, 0.5])));

  assert.strictEqual(pcm.getInt16(0, true), 0);
  assert.strictEqual(pcm.getInt16(2, true), 32767); // +1 maps to 0x7FFF
  assert.strictEqual(pcm.getInt16(4, true), -32768); // -1 maps to -0x8000
  assert.strictEqual(pcm.getInt16(6, true), Math.trunc(0.5 * 0x7fff));
});

test('floatTo16BitPCM clamps out-of-range input instead of wrapping', () => {
  const pcm = new DataView(floatTo16BitPCM(new Float32Array([2, -2])));
  assert.strictEqual(pcm.getInt16(0, true), 32767);
  assert.strictEqual(pcm.getInt16(2, true), -32768);
});

test('an event stream frame round-trips through build and parse', () => {
  const payload = floatTo16BitPCM(new Float32Array([0.1, -0.2, 0.3, -0.4]));
  const frame = buildEventStreamMessage(payload);
  const { headers, parsedPayload } = (() => {
    const parsed = parseEventStreamMessage(frame);
    return { headers: parsed.headers, parsedPayload: parsed.payload };
  })();

  assert.strictEqual(headers[':event-type'], 'AudioEvent');
  assert.strictEqual(headers[':message-type'], 'event');
  assert.strictEqual(headers[':content-type'], 'application/octet-stream');
  assert.deepStrictEqual(
    Array.from(parsedPayload),
    Array.from(new Uint8Array(payload))
  );
});

test('the frame prelude and message CRCs are both correct', () => {
  const frame = buildEventStreamMessage(new ArrayBuffer(8));
  const view = new DataView(frame);
  const bytes = new Uint8Array(frame);

  assert.strictEqual(view.getUint32(0, false), frame.byteLength, 'total length');
  assert.strictEqual(view.getUint32(8, false), crc32(bytes.subarray(0, 8)), 'prelude CRC');
  assert.strictEqual(
    view.getUint32(frame.byteLength - 4, false),
    crc32(bytes.subarray(0, frame.byteLength - 4)),
    'message CRC'
  );
});

test('an empty payload builds a valid end-of-stream frame', () => {
  // This is what signals Transcribe to finalise the last utterance.
  const frame = buildEventStreamMessage(new ArrayBuffer(0));
  const { headers, payload } = parseEventStreamMessage(frame);

  assert.strictEqual(headers[':event-type'], 'AudioEvent');
  assert.strictEqual(payload.byteLength, 0);
});

test('parse handles non-string header types instead of throwing', () => {
  // AWS exception frames carry non-string headers. v1 threw on these, which
  // took the whole page down exactly when it needed to report the error.
  const name = ':status-code';
  const headersLength = 1 + name.length + 1 + 4;
  const total = 4 + 4 + 4 + headersLength + 0 + 4;

  const buffer = new ArrayBuffer(total);
  const view = new DataView(buffer);
  let offset = 0;
  view.setUint32(offset, total, false); offset += 4;
  view.setUint32(offset, headersLength, false); offset += 4;
  view.setUint32(offset, crc32(new Uint8Array(buffer, 0, 8)), false); offset += 4;
  view.setUint8(offset++, name.length);
  for (let i = 0; i < name.length; i++) view.setUint8(offset++, name.charCodeAt(i));
  view.setUint8(offset++, 4); // 4 = int32
  view.setInt32(offset, 400, false); offset += 4;
  view.setUint32(offset, crc32(new Uint8Array(buffer, 0, offset)), false);

  const { headers } = parseEventStreamMessage(buffer);
  assert.strictEqual(headers[':status-code'], 400);
});

test('decodePayload turns a transcript payload into JSON', () => {
  const json = { Transcript: { Results: [{ IsPartial: false }] } };
  const payload = new TextEncoder().encode(JSON.stringify(json));
  assert.deepStrictEqual(decodePayload(payload), json);
});
