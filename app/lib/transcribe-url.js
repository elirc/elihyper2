const { randomUUID } = require('node:crypto');
const { SignatureV4 } = require('@aws-sdk/signature-v4');
const { Sha256 } = require('@aws-crypto/sha256-js');
const { HttpRequest } = require('@aws-sdk/protocol-http');
const { formatUrl } = require('@aws-sdk/util-format-url');

// Presigns a WebSocket URL for Transcribe streaming so the browser can connect
// to AWS directly without ever holding our credentials. The signature lives in
// the query string and authorises exactly this one request until it expires.
//
// Two things here are easy to get wrong:
//   - the signing service is "transcribe", not "transcribestreaming", even
//     though the hostname says otherwise;
//   - a browser WebSocket cannot send custom headers, so the x-amzn-transcribe-*
//     headers must be excluded from the signature. The equivalent query-string
//     parameters carry the real configuration.

const UNSIGNABLE_HEADERS = new Set([
  'x-amzn-transcribe-language-code',
  'x-amzn-transcribe-media-encoding',
  'x-amzn-transcribe-sample-rate',
  'x-amzn-transcribe-session-id',
]);

function createSignedUrlBuilder({ credentials, region }) {
  const signer = new SignatureV4({
    credentials,
    region,
    service: 'transcribe',
    sha256: Sha256,
    applyChecksum: false,
  });

  return async function buildSignedUrl({
    languageCode = 'en-US',
    sampleRate = 16000,
    expiresIn = 60,
    identifyPii = false,
  } = {}) {
    const sessionId = randomUUID();
    const hostname = `transcribestreaming.${region}.amazonaws.com`;

    const query = {
      'language-code': languageCode,
      'media-encoding': 'pcm',
      'sample-rate': String(sampleRate),
      'media-sample-rate-hertz': String(sampleRate),
      'session-id': sessionId,
      'enable-channel-identification': 'false',
      'enable-partial-results-stabilization': 'true',
      'partial-results-stability': 'high',
      'show-speaker-labels': 'false',
      'audio-channel': '1',
    };

    // PII identification is not supported for every language, so it is opt-in
    // per request rather than always on.
    if (identifyPii) {
      query['content-identification-type'] = 'PII';
    }

    const request = new HttpRequest({
      protocol: 'wss',
      hostname,
      port: 8443,
      method: 'GET',
      path: '/stream-transcription-websocket',
      query,
      headers: {
        host: `${hostname}:8443`,
        'x-amzn-transcribe-language-code': languageCode,
        'x-amzn-transcribe-media-encoding': 'pcm',
        'x-amzn-transcribe-sample-rate': String(sampleRate),
        'x-amzn-transcribe-session-id': sessionId,
      },
    });

    const signed = await signer.presign(request, {
      expiresIn,
      unsignableHeaders: UNSIGNABLE_HEADERS,
    });

    return {
      url: formatUrl(signed),
      sessionId,
      languageCode,
      sampleRate,
      expiresIn,
      expiresAt: new Date(Date.now() + expiresIn * 1000).toISOString(),
    };
  };
}

module.exports = { createSignedUrlBuilder };
